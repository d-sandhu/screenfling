//! ScreenCaptureKit still images; no deprecated CGWindowListCreateImage path.
use super::Captured;
use crate::model::{MAX_IMAGE_BYTES, Pixels, Result};
use block2::RcBlock;
use objc2::AllocAnyThread;
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_graphics::CGImage;
use objc2_foundation::{NSArray, NSError};
use objc2_screen_capture_kit::{
    SCContentFilter, SCScreenshotManager, SCShareableContent, SCStreamConfiguration, SCWindow,
};
use std::{
    ffi::c_void,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
    static kCGColorSpaceSRGB: *const c_void;
    fn CGColorSpaceCreateWithName(name: *const c_void) -> *mut c_void;
    fn CGColorSpaceRelease(space: *mut c_void);
    fn CGBitmapContextCreate(
        data: *mut c_void,
        width: usize,
        height: usize,
        bits: usize,
        stride: usize,
        space: *mut c_void,
        info: u32,
    ) -> *mut c_void;
    fn CGContextDrawImage(context: *mut c_void, rect: CGRect, image: *const CGImage);
    fn CGContextRelease(context: *mut c_void);
}

pub fn capture(pointer: [i32; 2], cancelled: &AtomicBool) -> Result<Captured> {
    // Called only after an explicit Capture action. Do not prompt at startup.
    if !unsafe { CGPreflightScreenCaptureAccess() } && !unsafe { CGRequestScreenCaptureAccess() } {
        return Err("Allow ScreenFling in System Settings > Privacy & Security > Screen & System Audio Recording, then capture again. ScreenFling does not record audio.".into());
    }
    let (tx, rx) = mpsc::sync_channel(1);
    let content_block = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            if content.is_null() || !error.is_null() {
                let _ = tx.try_send(Err(
                    "ScreenCaptureKit could not read the available displays.".into(),
                ));
                return;
            }
            // SAFETY: Apple's completion handler keeps the supplied objects alive for this call.
            unsafe {
                let displays = (&*content).displays();
                let selected = displays.iter().find(|display| {
                    let r = display.frame();
                    f64::from(pointer[0]) >= r.origin.x
                        && f64::from(pointer[1]) >= r.origin.y
                        && f64::from(pointer[0]) < r.origin.x + r.size.width
                        && f64::from(pointer[1]) < r.origin.y + r.size.height
                });
                let Some(display) = selected else {
                    let _ =
                        tx.try_send(Err("The display under the pointer is unavailable.".into()));
                    return;
                };
                let bounds = display.frame();
                let filter = SCContentFilter::initWithDisplay_excludingWindows(
                    SCContentFilter::alloc(),
                    &display,
                    &NSArray::<SCWindow>::new(),
                );
                let rect = filter.contentRect();
                let scale = f64::from(filter.pointPixelScale());
                let width = (rect.size.width * scale).round() as usize;
                let height = (rect.size.height * scale).round() as usize;
                if width == 0
                    || height == 0
                    || width
                        .checked_mul(height)
                        .and_then(|n| n.checked_mul(4))
                        .is_none_or(|n| n > MAX_IMAGE_BYTES)
                {
                    let _ = tx.try_send(Err(
                        "The selected display is too large or has invalid dimensions.".into(),
                    ));
                    return;
                }
                let configuration = SCStreamConfiguration::new();
                configuration.setWidth(width);
                configuration.setHeight(height);
                configuration.setShowsCursor(false);
                configuration.setCapturesAudio(false);
                let tx = tx.clone();
                let image_block = RcBlock::new(move |image: *mut CGImage, error: *mut NSError| {
                    let result = if image.is_null() || !error.is_null() {
                        Err("ScreenCaptureKit could not capture the selected display.".into())
                    } else {
                        copy_image(&*image).map(|pixels| Captured {
                            pixels,
                            bounds: Some([
                                bounds.origin.x as i32,
                                bounds.origin.y as i32,
                                bounds.size.width as i32,
                                bounds.size.height as i32,
                            ]),
                        })
                    };
                    let _ = tx.try_send(result);
                });
                SCScreenshotManager::captureImageWithFilter_configuration_completionHandler(
                    &filter,
                    &configuration,
                    Some(&image_block),
                );
            }
        },
    );
    unsafe {
        SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(false, true, &content_block);
    }
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err("Capture cancelled.".into());
        }
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(result) => return result,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("The capture request ended without an image.".into());
            }
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() >= deadline => return Err(
                "Screen capture timed out. Check screen-recording permission and capture again."
                    .into(),
            ),
            Err(_) => {}
        }
    }
}

unsafe fn copy_image(image: &CGImage) -> Result<Pixels> {
    let width = CGImage::width(Some(image));
    let height = CGImage::height(Some(image));
    let len = width
        .checked_mul(height)
        .and_then(|n| n.checked_mul(4))
        .ok_or("Invalid image dimensions.")?;
    if width == 0 || height == 0 || len > MAX_IMAGE_BYTES {
        return Err("The captured image is too large.".into());
    }
    let mut rgba = vec![0; len];
    // Convert display color profiles/HDR into a defined, opaque sRGB RGBA bitmap.
    // The buffer lives until after CGContextRelease; no CoreGraphics pointer escapes.
    unsafe {
        let space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
        if space.is_null() {
            return Err("Could not create the sRGB color space.".into());
        }
        let context = CGBitmapContextCreate(
            rgba.as_mut_ptr().cast(),
            width,
            height,
            8,
            width * 4,
            space,
            (4 << 12) | 5,
        );
        CGColorSpaceRelease(space);
        if context.is_null() {
            return Err("Could not create the capture bitmap.".into());
        }
        CGContextDrawImage(
            context,
            CGRect {
                origin: CGPoint { x: 0.0, y: 0.0 },
                size: CGSize {
                    width: width as f64,
                    height: height as f64,
                },
            },
            image,
        );
        CGContextRelease(context);
    }
    Ok(Pixels::new(width as u32, height as u32, rgba)?.opaque())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ptr;

    unsafe extern "C" {
        fn CGDataProviderCreateWithData(
            info: *mut c_void,
            data: *const c_void,
            size: usize,
            release: Option<unsafe extern "C" fn(*mut c_void, *const c_void, usize)>,
        ) -> *mut c_void;
        fn CGDataProviderRelease(provider: *mut c_void);
        fn CGImageCreate(
            width: usize,
            height: usize,
            bits_per_component: usize,
            bits_per_pixel: usize,
            bytes_per_row: usize,
            space: *mut c_void,
            bitmap_info: u32,
            provider: *mut c_void,
            decode: *const f64,
            interpolate: bool,
            intent: i32,
        ) -> *mut CGImage;
        fn CGImageRelease(image: *mut CGImage);
    }

    #[test]
    fn native_bitmap_preserves_rows_channels_and_opaque_pixels() {
        // A real CGImage with padded BGRx rows, not a mocked screenshot API.
        // This needs neither a display nor screen-recording permission.
        let expected: Vec<u8> = [
            [50, 80, 200, 255, 170, 90, 30, 255],
            [12, 130, 240, 255, 210, 40, 100, 255],
            [90, 180, 60, 255, 220, 160, 20, 255],
        ]
        .concat();
        let mut source = Vec::new();
        for row in expected.chunks_exact(8) {
            for p in row.chunks_exact(4) {
                source.extend_from_slice(&[p[2], p[1], p[0], 0]);
            }
            source.extend_from_slice(&[99; 4]);
        }
        let converted = unsafe {
            let space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
            assert!(!space.is_null());
            // The vector outlives both the data provider and image. No callback owns it.
            let provider = CGDataProviderCreateWithData(
                ptr::null_mut(),
                source.as_ptr().cast(),
                source.len(),
                None,
            );
            assert!(!provider.is_null());
            let image = CGImageCreate(
                2,
                3,
                8,
                32,
                12,
                space,
                (2 << 12) | 6, // 32-bit little-endian, skip first alpha: BGRx bytes.
                provider,
                ptr::null(),
                false,
                0,
            );
            CGDataProviderRelease(provider);
            CGColorSpaceRelease(space);
            assert!(!image.is_null());
            let converted = copy_image(&*image);
            CGImageRelease(image);
            converted.unwrap()
        };
        assert_eq!((converted.width, converted.height), (2, 3));
        assert_eq!(converted.rgba, expected);
    }
}
