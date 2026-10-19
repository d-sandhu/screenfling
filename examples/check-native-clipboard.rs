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

/// Show the expected pixels in a borderless window drawn the same way the app
/// draws (winit + softbuffer), then capture and crop it through production code.
#[cfg(target_os = "windows")]
fn capture_fixture(
    expected: &screenfling::model::Pixels,
) -> Result<screenfling::model::Pixels, String> {
    use screenfling::{capture, model::map_crop};
    use std::{
        num::NonZeroU32,
        rc::Rc,
        sync::atomic::AtomicBool,
        time::{Duration, Instant},
    };
    use winit::{
        application::ApplicationHandler,
        dpi::{PhysicalPosition, PhysicalSize},
        event::WindowEvent,
        event_loop::{ActiveEventLoop, EventLoop},
        platform::pump_events::EventLoopExtPumpEvents,
        window::{Window, WindowId, WindowLevel},
    };

    struct Fixture {
        pixels: Vec<u32>,
        size: [u32; 2],
        window: Option<Rc<Window>>,
        surface: Option<softbuffer::Surface<Rc<Window>, Rc<Window>>>,
    }
    impl Fixture {
        fn paint(&mut self) {
            let (Some(surface), [w, h]) = (&mut self.surface, self.size) else {
                return;
            };
            let (Some(w), Some(h)) = (NonZeroU32::new(w), NonZeroU32::new(h)) else {
                return;
            };
            if surface.resize(w, h).is_ok()
                && let Ok(mut buffer) = surface.buffer_mut()
            {
                buffer.copy_from_slice(&self.pixels);
                let _ = buffer.present();
            }
        }
    }
    impl ApplicationHandler for Fixture {
        fn resumed(&mut self, event_loop: &ActiveEventLoop) {
            if self.window.is_some() {
                return;
            }
            let attributes = Window::default_attributes()
                .with_title("ScreenFling synthetic capture check")
                .with_decorations(false)
                .with_resizable(false)
                .with_window_level(WindowLevel::AlwaysOnTop)
                .with_position(PhysicalPosition::new(80, 80))
                .with_inner_size(PhysicalSize::new(self.size[0], self.size[1]));
            let Ok(window) = event_loop.create_window(attributes) else {
                return;
            };
            let window = Rc::new(window);
            if let Ok(context) = softbuffer::Context::new(window.clone()) {
                self.surface = softbuffer::Surface::new(&context, window.clone()).ok();
            }
            self.window = Some(window);
            self.paint();
        }
        fn window_event(&mut self, _: &ActiveEventLoop, _: WindowId, event: WindowEvent) {
            if event == WindowEvent::RedrawRequested {
                self.paint();
            }
        }
    }

    let mut event_loop = EventLoop::new().map_err(|error| error.to_string())?;
    let mut fixture = Fixture {
        pixels: expected
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .map(|p| u32::from(p[0]) << 16 | u32::from(p[1]) << 8 | u32::from(p[2]))
            .collect(),
        size: [expected.width, expected.height],
        window: None,
        surface: None,
    };
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let _ = event_loop.pump_app_events(Some(Duration::from_millis(50)), &mut fixture);
        fixture.paint();
        // Wait for the disposable desktop compositor, not an application action.
        std::thread::sleep(Duration::from_millis(100));
        let Some(position) = fixture
            .window
            .as_ref()
            .and_then(|w| w.inner_position().ok())
        else {
            if Instant::now() >= deadline {
                return Err("Could not show the synthetic capture window.".into());
            }
            continue;
        };
        let (x, y) = (position.x, position.y);
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
            println!(
                "Windows capture: production monitor capture and crop preserve every synthetic pixel."
            );
            return Ok(crop);
        }
        if Instant::now() >= deadline {
            return Err(
                "Windows capture did not preserve the synthetic window's exact pixels.".into(),
            );
        }
    }
}
