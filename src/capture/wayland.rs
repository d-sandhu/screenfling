//! Consent-based, memory-only capture. The Screenshot portal is intentionally not used:
//! it returns a file URI and would persist unreviewed desktop contents.
use super::Captured;
use crate::{
    frame::packed_rgba,
    model::{Pixels, Result},
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
    io::Cursor,
    os::fd::OwnedFd,
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
    let _listener = stream
        .add_local_listener_with_user_data(VideoInfoRaw::default())
        .param_changed(|_, format, id, param| {
            if id == ParamType::Format.as_raw()
                && let Some(param) = param
            {
                let _ = format.parse(param);
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
            let offset = data.chunk().offset() as usize;
            let stride = data.chunk().stride();
            let chunk_size = data.chunk().size() as usize;
            if chunk_size == 0 {
                return;
            }
            let Some(bytes) = data.data() else {
                return;
            };
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
            let value = if stride <= 0
                || offset
                    .checked_add(chunk_size)
                    .is_none_or(|end| end > bytes.len())
            {
                Err("PipeWire returned an invalid image plane.".into())
            } else {
                packed_rgba(
                    &bytes[..offset + chunk_size],
                    size.width,
                    size.height,
                    offset,
                    stride as usize,
                    order,
                )
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
            StreamFlags::AUTOCONNECT | StreamFlags::MAP_BUFFERS,
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
