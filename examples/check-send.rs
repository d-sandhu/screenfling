//! Opt-in X11 paste check, launched only by scripts/check-send.py on private Xvfb.
#[cfg(target_os = "linux")]
#[allow(dead_code)]
#[path = "../src/clipboard.rs"]
mod clipboard;
#[cfg(target_os = "linux")]
#[path = "../src/send.rs"]
mod send;

#[cfg(target_os = "linux")]
fn main() -> Result<(), String> {
    use std::time::{Duration, Instant};
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 4
        || args[1] != "--isolated-xvfb"
        || !args[2].starts_with("screenfling-paste-fixture-")
    {
        return Err("Use the documented isolated fixture only.".into());
    }
    let display = std::env::var("DISPLAY").map_err(|_| "No fixture display")?;
    let private = std::fs::read_dir("/proc")
        .map_err(|_| "No process inventory")?
        .filter_map(|e| e.ok())
        .any(|entry| {
            std::fs::read(entry.path().join("cmdline")).is_ok_and(|bytes| {
                let args: Vec<_> = bytes.split(|b| *b == 0).collect();
                args.first().is_some_and(|p| p.ends_with(b"Xvfb"))
                    && args.contains(&display.as_bytes())
            })
        });
    if !private {
        return Err("Refusing to paste outside a private Xvfb display.".into());
    }
    let sdl = sdl3::init().map_err(|e| e.to_string())?;
    let video = sdl.video().map_err(|e| e.to_string())?;
    screenfling::capture::initialize_session(video.current_video_driver());
    let _window = video
        .window("screenfling-paste-sender", 100, 100)
        .hidden()
        .build()
        .map_err(|e| e.to_string())?;
    let mut events = sdl.event_pump().map_err(|e| e.to_string())?;
    let crop = screenfling::model::Pixels::new(
        3,
        2,
        vec![
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 17, 31, 49, 255, 61, 83, 97, 255, 111,
            129, 147, 255,
        ],
    )?;
    std::fs::write(&args[3], crop.png()?).map_err(|e| e.to_string())?;
    let mut clipboard = clipboard::Clipboard::new()?;
    clipboard.copy(&crop)?;
    let targets = send::discover()?;
    if targets.len() != 2
        || targets
            .iter()
            .any(|target| !target.application.starts_with("Codex"))
    {
        return Err(format!(
            "Expected only the two synthetic agent terminals: {targets:?}"
        ));
    }
    let target = targets
        .into_iter()
        .find(|target| target.title == args[2])
        .ok_or("Fixture window not found")?;
    let pending = send::Pending::start(target, true)?;
    loop {
        for _ in events.poll_iter() {}
        if let Some(result) = pending.poll(|| clipboard.matches(&crop)) {
            println!("{}", result?);
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    // X11 clipboard data is served by its owner after the terminal requests it.
    let deadline = Instant::now() + Duration::from_secs(1);
    while Instant::now() < deadline {
        for _ in events.poll_iter() {}
        std::thread::sleep(Duration::from_millis(10));
    }
    Ok(())
}
#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("Run this opt-in fixture on Linux Xvfb.");
}
