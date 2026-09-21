//! Consent-based, memory-only capture. The Screenshot portal is intentionally not used:
//! it returns a file URI and would persist unreviewed desktop contents.
use super::Captured;
use crate::{
    frame::packed_rgba,
    model::{MAX_IMAGE_BYTES, Pixels, Result},
};
use ashpd::desktop::{
    PersistMode,
    screencast::{CursorMode, Screencast, SelectSourcesOptions, SourceType},
};
use pipewire::{
    context::ContextRc,
    main_loop::MainLoopRc,
    properties,
    spa::{
        self,
        param::{
            ParamType,
            format::{FormatProperties, MediaSubtype, MediaType},
            video::{VideoFormat, VideoInfoRaw},
        },
        pod::{self, Pod, serialize::PodSerializer},
        utils::{Direction, Rectangle, SpaTypes},
    },
    stream::{StreamFlags, StreamRc},
};
use std::{
    cell::RefCell,
    fs::File,
    io::Cursor,
    os::{
        fd::{BorrowedFd, OwnedFd},
        unix::fs::FileExt,
    },
    rc::Rc,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

pub fn capture(cancelled: &AtomicBool) -> Result<Captured> {
    futures_lite::future::block_on(async {
        let proxy = bounded(Screencast::new(), cancelled).await?;
        let session = bounded(proxy.create_session(Default::default()), cancelled).await?;
        let result = async {
            bounded(
                proxy.select_sources(
                    &session,
                    SelectSourcesOptions::default()
                        .set_sources(Some(SourceType::Monitor.into()))
                        .set_multiple(false)
                        .set_cursor_mode(CursorMode::Hidden)
                        .set_persist_mode(PersistMode::DoNot),
                ),
                cancelled,
            )
            .await?
            .response()
            .map_err(portal_error)?;
            let response = bounded(proxy.start(&session, None, Default::default()), cancelled)
                .await?
                .response()
                .map_err(portal_error)?;
            if response.streams().len() != 1 {
                return Err("Select exactly one display in the desktop sharing dialog.".into());
            }
            let node = response.streams()[0].pipe_wire_node_id();
            let fd = bounded(
                proxy.open_pipe_wire_remote(&session, Default::default()),
                cancelled,
            )
            .await?;
            let pixels = first_frame(fd, node, cancelled)?;
            Ok(Captured {
                pixels,
                bounds: None,
            })
        }
        .await;
        // Explicitly terminate permission/stream ownership on success, failure, and cancellation.
        let _ = futures_lite::future::race(
            async {
                let _ = session.close().await;
            },
            async {
                async_io::Timer::after(Duration::from_secs(2)).await;
            },
        )
        .await;
        result
    })
}

async fn bounded<T>(
    future: impl std::future::Future<Output = ashpd::Result<T>>,
    cancelled: &AtomicBool,
) -> Result<T> {
    futures_lite::future::race(async { future.await.map_err(portal_error) }, async {
        let deadline = Instant::now() + Duration::from_secs(120);
        loop {
            if cancelled.load(Ordering::Acquire) {
                return Err("Capture cancelled.".into());
            }
            if Instant::now() >= deadline {
                return Err("The desktop sharing dialog timed out.".into());
            }
            async_io::Timer::after(Duration::from_millis(100)).await;
        }
    })
    .await
}
fn portal_error(_: impl std::fmt::Display) -> String {
    "Screen sharing was cancelled or is unavailable. Check that the desktop's xdg-desktop-portal backend and PipeWire are running, then choose one display.".into()
}

fn first_frame(fd: OwnedFd, node: u32, cancelled: &AtomicBool) -> Result<Pixels> {
    pipewire::init();
    let main_loop = MainLoopRc::new(None).map_err(portal_error)?;
    let context = ContextRc::new(&main_loop, None).map_err(portal_error)?;
    // Only use the portal-granted remote. Never connect to an unrelated PipeWire instance.
    let core = context.connect_fd_rc(fd, None).map_err(portal_error)?;
    let stream = StreamRc::new(
        core,
        "ScreenFling still capture",
        properties::properties! {
            "media.type" => "Video", "media.category" => "Capture", "media.role" => "Screen"
        },
    )
    .map_err(portal_error)?;
    let result: Rc<RefCell<Option<Result<Pixels>>>> = Rc::new(RefCell::new(None));
    let output = result.clone();
    let negotiation = result.clone();
    let _listener = stream
        .add_local_listener_with_user_data(VideoInfoRaw::default())
        .param_changed(move |stream, format, id, param| {
            if id != ParamType::Format.as_raw() {
                return;
            }
            let Some(param) = param else {
                return;
            };
            let negotiated = (|| -> Result<()> {
                format.parse(param).map_err(portal_error)?;
                // This still-image consumer needs CPU-readable shared memory,
                // not a GPU-only DMA buffer or a borrowed mapped image pointer.
                let buffers = pod::Object {
                    type_: spa::sys::SPA_TYPE_OBJECT_ParamBuffers,
                    id: ParamType::Buffers.as_raw(),
                    properties: vec![pod::Property {
                        key: spa::sys::SPA_PARAM_BUFFERS_dataType,
                        flags: pod::PropertyFlags::empty(),
                        value: pod::Value::Int(1 << spa::sys::SPA_DATA_MemFd),
                    }],
                };
                let value = pod::Value::Object(buffers);
                let bytes = PodSerializer::serialize(Cursor::new(Vec::new()), &value)
                    .map_err(portal_error)?
                    .0
                    .into_inner();
                let param =
                    Pod::from_bytes(&bytes).ok_or("Could not negotiate shared screen memory.")?;
                stream.update_params(&mut [param]).map_err(portal_error)
            })();
            if let Err(error) = negotiated {
                *negotiation.borrow_mut() = Some(Err(error));
            }
        })
        .process(move |stream, format| {
            if output.borrow().is_some() {
                return;
            }
            let Some(mut buffer) = stream.dequeue_buffer() else {
                return;
            };
            let datas = buffer.datas_mut();
            let Some(data) = datas.first_mut() else {
                return;
            };
            if data.as_raw().chunk.is_null() {
                *output.borrow_mut() = Some(Err("PipeWire returned no image plane.".into()));
                return;
            }
            let chunk = data.chunk().as_raw();
            if chunk.size == 0 || chunk.flags & 1 != 0 {
                return;
            }
            let stride = chunk.stride;
            let size = format.size();
            let order = match format.format() {
                VideoFormat::BGRA | VideoFormat::BGRx => true,
                VideoFormat::RGBA | VideoFormat::RGBx => false,
                _ => {
                    *output.borrow_mut() = Some(Err(
                        "The desktop returned an unsupported color format.".into(),
                    ));
                    return;
                }
            };
            let value = if stride <= 0 {
                Err("PipeWire returned an invalid image stride.".into())
            } else {
                read_plane(data.as_raw(), chunk).and_then(|bytes| {
                    packed_rgba(&bytes, size.width, size.height, 0, stride as usize, order)
                })
            };
            *output.borrow_mut() = Some(value);
        })
        .register()
        .map_err(portal_error)?;
    let object = pod::object!(
        SpaTypes::ObjectParamFormat,
        ParamType::EnumFormat,
        pod::property!(FormatProperties::MediaType, Id, MediaType::Video),
        pod::property!(FormatProperties::MediaSubtype, Id, MediaSubtype::Raw),
        pod::property!(
            FormatProperties::VideoFormat,
            Choice,
            Enum,
            Id,
            VideoFormat::BGRx,
            VideoFormat::BGRx,
            VideoFormat::BGRA,
            VideoFormat::RGBx,
            VideoFormat::RGBA
        ),
        pod::property!(
            FormatProperties::VideoSize,
            Choice,
            Range,
            Rectangle,
            Rectangle {
                width: 1920,
                height: 1080
            },
            Rectangle {
                width: 1,
                height: 1
            },
            Rectangle {
                width: 16384,
                height: 16384
            }
        )
    );
    let values = PodSerializer::serialize(Cursor::new(Vec::new()), &pod::Value::Object(object))
        .map_err(portal_error)?
        .0
        .into_inner();
    let mut params =
        [Pod::from_bytes(&values).ok_or("Could not negotiate the screen image format.")?];
    stream
        .connect(
            Direction::Input,
            Some(node),
            StreamFlags::AUTOCONNECT,
            &mut params,
        )
        .map_err(portal_error)?;
    let deadline = Instant::now() + Duration::from_secs(8);
    let value = loop {
        if let Some(value) = result.borrow_mut().take() {
            break value;
        }
        if cancelled.load(Ordering::Acquire) {
            break Err("Capture cancelled.".into());
        }
        if Instant::now() >= deadline {
            break Err("The desktop did not provide a screen image in time.".into());
        }
        main_loop
            .loop_()
            .iterate(pipewire::loop_::Timeout::Finite(Duration::from_millis(50)));
    };
    let _ = stream.disconnect();
    value
}

/// Copy the held buffer through its shared-memory descriptor. Do not dereference
/// PipeWire's optional mapped data pointer. pread also bounds truncated buffers
/// without turning an invalid mapping into a process-wide memory fault.
fn read_plane(data: &spa::sys::spa_data, chunk: &spa::sys::spa_chunk) -> Result<Vec<u8>> {
    // SPA chunk offsets are modulo maxsize and sizes are clamped to it. A valid
    // producer may advance its offset beyond maxsize without moving the pixels.
    let offset = chunk
        .offset
        .checked_rem(data.maxsize)
        .ok_or("The desktop returned empty screen memory.")?;
    let size = chunk.size.min(data.maxsize);
    let length = size as usize;
    // Some portal versions omit SPA_DATA_FLAG_READABLE even for a readable
    // MemFd. The granted descriptor and pread enforce read access; do not infer
    // memory protection from that optional producer flag or map with PROT_NONE.
    if data.type_ != spa::sys::SPA_DATA_MemFd
        || length == 0
        || length > MAX_IMAGE_BYTES
        || offset
            .checked_add(size)
            .is_none_or(|end| end > data.maxsize)
    {
        return Err("The desktop did not provide a valid shared-memory image plane.".into());
    }
    let fd = i32::try_from(data.fd).map_err(|_| "Invalid screen-memory descriptor.")?;
    if fd < 0 {
        return Err("The screen-memory descriptor is unavailable.".into());
    }
    // SAFETY: PipeWire owns this descriptor for the lifetime of the dequeued
    // buffer. Duplicate it before reading; this function never closes its owner.
    let owned = unsafe { BorrowedFd::borrow_raw(fd) }
        .try_clone_to_owned()
        .map_err(|_| "Could not retain the screen-memory descriptor.")?;
    let file = File::from(owned);
    let start = u64::from(data.mapoffset) + u64::from(offset);
    let mut bytes = vec![0; length];
    file.read_exact_at(&mut bytes, start)
        .map_err(|_| "The desktop returned incomplete screen memory.")?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::Write,
        os::fd::{AsRawFd, FromRawFd},
    };

    #[test]
    fn shared_memory_copy_respects_plane_offset_padding_and_truncation() {
        // An actual anonymous shared-memory descriptor; no screenshot file.
        let fd =
            unsafe { libc::memfd_create(c"screenfling-frame-test".as_ptr(), libc::MFD_CLOEXEC) };
        assert!(fd >= 0);
        let mut file = unsafe { File::from_raw_fd(fd) };
        file.write_all(&[0; 4096]).unwrap();
        file.write_all(&[99, 3, 2, 1, 0, 88, 77, 6, 5, 4, 0])
            .unwrap();
        let mut data = spa::sys::spa_data {
            type_: spa::sys::SPA_DATA_MemFd,
            flags: 1 << 3, // MAPPABLE only, as supplied by the wlroots portal.
            fd: i64::from(file.as_raw_fd()),
            mapoffset: 4096,
            maxsize: 11,
            data: std::ptr::null_mut(),
            chunk: std::ptr::null_mut(),
        };
        let mut chunk = spa::sys::spa_chunk {
            offset: 1,
            size: 10,
            stride: 6,
            flags: 0,
        };
        let bytes = read_plane(&data, &chunk).unwrap();
        assert_eq!(
            packed_rgba(&bytes, 1, 2, 0, 6, true).unwrap().rgba,
            [1, 2, 3, 255, 4, 5, 6, 255]
        );
        chunk.offset = 12;
        assert_eq!(read_plane(&data, &chunk).unwrap(), bytes);
        chunk.offset = 0;
        chunk.size = u32::MAX;
        assert_eq!(
            read_plane(&data, &chunk).unwrap(),
            [99, 3, 2, 1, 0, 88, 77, 6, 5, 4, 0]
        );
        chunk.size = 10;
        chunk.offset = 2;
        assert!(read_plane(&data, &chunk).is_err());
        chunk.offset = 1;
        file.set_len(4098).unwrap();
        assert!(read_plane(&data, &chunk).is_err());
        data.maxsize = 0;
        assert!(read_plane(&data, &chunk).is_err());
    }
}
