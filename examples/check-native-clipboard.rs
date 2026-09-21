//! Opt-in check for disposable Windows/macOS desktops. Never run by cargo test.
#![cfg(not(test))]

#[cfg(any(target_os = "windows", target_os = "macos"))]
#[path = "../src/clipboard.rs"]
mod clipboard;

fn main() -> Result<(), String> {
    let arguments: Vec<_> = std::env::args().skip(1).collect();
    if arguments.first().map(String::as_str) != Some("--allow-clipboard-write")
        || arguments.len() > 2
    {
        return Err("This check captures a synthetic Windows window and replaces the system clipboard with synthetic images. Run only on a disposable desktop, with --allow-clipboard-write.".into());
    }
    let operation = arguments.get(1).map(String::as_str).unwrap_or("check");
    if !matches!(operation, "check" | "read" | "replace") {
        return Err("Unknown clipboard check operation.".into());
    }
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        check(operation)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err("Use the isolated X11/Wayland smoke scripts on Linux instead.".into())
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn check(operation: &str) -> Result<(), String> {
    use screenfling::model::Pixels;
    let mut rgba = Vec::with_capacity(200 * 150 * 4);
    for y in 0..150u32 {
        for x in 0..200u32 {
            rgba.extend_from_slice(&[
                (x * 17 + y * 3) as u8,
                (x * 5 + y * 11) as u8,
                (x ^ y) as u8,
                255,
            ]);
        }
    }
    let first = Pixels::new(200, 150, rgba)?;
    #[cfg(target_os = "windows")]
    let first = if operation == "check" {
        capture_fixture(&first)?
    } else {
        first
    };
    let mut replacement = first.clone();
    let last_pixel = replacement.rgba.len() - 4;
    replacement.rgba[last_pixel] ^= 1;
    let mut clipboard = clipboard::Clipboard::new()?;
    match operation {
        "read" => {
            if !clipboard.matches(&first) {
                return Err("Another process could not read the exact clipboard image.".into());
            }
        }
        "replace" => clipboard.copy(&replacement)?,
        "check" => {
            clipboard.copy(&first)?;
            let executable = std::env::current_exe().map_err(|error| error.to_string())?;
            for operation in ["read", "replace"] {
                let status = std::process::Command::new(&executable)
                    .args(["--allow-clipboard-write", operation])
                    .status()
                    .map_err(|error| error.to_string())?;
                if !status.success() {
                    return Err(format!("The separate-process {operation} check failed."));
                }
            }
            if clipboard.matches(&first) || !clipboard.matches(&replacement) {
                return Err("Clipboard verification missed another process's replacement.".into());
            }
            println!(
                "Native clipboard: all 200 x 150 pixels read by another process; one changed last-row pixel rejected after its writer exited."
            );
        }
        _ => unreachable!(),
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn capture_fixture(
    expected: &screenfling::model::Pixels,
) -> Result<screenfling::model::Pixels, String> {
    use screenfling::{capture, model::map_crop};
    use sdl3_sys::{surface::*, video::*};
    use std::{
        ptr,
        sync::atomic::AtomicBool,
        time::{Duration, Instant},
    };

    sdl3::hint::set("SDL_VIDEO_ALLOW_SCREENSAVER", "1");
    sdl3::hint::set("SDL_WINDOWS_DPI_AWARENESS", "permonitorv2");
    let sdl = sdl3::init().map_err(|error| error.to_string())?;
    let video = sdl.video().map_err(|error| error.to_string())?;
    let window = video
        .window(
            "ScreenFling synthetic capture check",
            expected.width,
            expected.height,
        )
        .position(80, 80)
        .borderless()
        .build()
        .map_err(|error| error.to_string())?;
    let mut events = sdl.event_pump().map_err(|error| error.to_string())?;
    let mut bytes = expected.rgba.clone();
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        for _ in events.poll_iter() {}
        // The source bytes stay alive until the surface is destroyed. The
        // destination surface belongs to SDL and is never freed here.
        let painted = unsafe {
            let source = SDL_CreateSurfaceFrom(
                expected.width as i32,
                expected.height as i32,
                sdl3_sys::pixels::SDL_PIXELFORMAT_RGBA32,
                bytes.as_mut_ptr().cast(),
                expected.width as i32 * 4,
            );
            if source.is_null() {
                return Err("Could not create the synthetic image surface.".into());
            }
            let destination = SDL_GetWindowSurface(window.raw());
            let painted = SDL_SetWindowAlwaysOnTop(window.raw(), true)
                && !destination.is_null()
                && SDL_BlitSurface(source, ptr::null(), destination, ptr::null())
                && SDL_UpdateWindowSurface(window.raw());
            SDL_DestroySurface(source);
            painted
        };
        if !painted {
            return Err("Could not paint the synthetic capture window.".into());
        }
        // Wait for the disposable desktop compositor, not an application action.
        std::thread::sleep(Duration::from_millis(100));
        let (x, y) = window.position();
        let frame = capture::capture([x + 1, y + 1], &AtomicBool::new(false))?;
        let [left, top, width, height] = frame.bounds.ok_or("Missing display geometry.")?;
        let crop = frame.pixels.crop(map_crop(
            [
                f64::from(x - left),
                f64::from(y - top),
                f64::from(expected.width),
                f64::from(expected.height),
            ],
            [f64::from(width), f64::from(height)],
            [frame.pixels.width, frame.pixels.height],
        )?)?;
        if &crop == expected {
            println!("Windows capture: production monitor capture and crop preserve every synthetic pixel.");
            return Ok(crop);
        }
        if Instant::now() >= deadline {
            return Err(
                "Windows capture did not preserve the synthetic window's exact pixels.".into(),
            );
        }
    }
}
