#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
mod clipboard;
use egui_sdl3::{egui, egui_glow::glow};
use sdl3::event::Event;
use std::{sync::Arc, time::{Duration, Instant}};
fn main() {
    if let Err(error) = run() {
        eprintln!("ScreenFling: {error}");
        let _ = sdl3::messagebox::show_simple_message_box(sdl3::messagebox::MessageBoxFlag::ERROR, "ScreenFling", &error, None);
        std::process::exit(1);
    }
}
fn run() -> Result<(), String> {
    let sdl = sdl3::init().map_err(|e| e.to_string())?;
    let video = sdl.video().map_err(|e| e.to_string())?;
    video.gl_attr().set_context_profile(sdl3::video::GLProfile::Core);
    video.gl_attr().set_context_version(3, 2);
    let window = video.window("ScreenFling", 780, 580).opengl().high_pixel_density().resizable().position_centered().build().map_err(|e| e.to_string())?;
    let _gl = window.gl_create_context().map_err(|e| e.to_string())?;
    let glow = Arc::new(unsafe { glow::Context::from_loader_function(|name| video.gl_get_proc_address(name).map_or(std::ptr::null(), |p| p as *const _)) });
    let mut gui = egui_sdl3::EguiGlow::new(&window, glow, None, false);
    let mut events = sdl.event_pump().map_err(|e| e.to_string())?;
    let mut deadline = Instant::now();
    'app: loop {
        let wait = deadline.saturating_duration_since(Instant::now());
        if let Some(event) = events.wait_event_timeout(wait) {
            if matches!(event, Event::Quit { .. }) { break; }
            gui.state.on_event(&window, &event);
        }
        for event in events.poll_iter() {
            if matches!(event, Event::Quit { .. }) { break 'app; }
            gui.state.on_event(&window, &event);
        }
        gui.state.sync_window_size(&window);
        gui.run(|ctx| { egui::Window::new("ScreenFling").resizable(false).show(ctx, |ui| {
            ui.heading("Capture. Review. Stage.");
            ui.label("Native Rust + egui desktop host");
        }); });
        gui.clear([0.08, 0.08, 0.09, 1.0]);
        gui.paint();
        window.gl_swap_window();
        deadline = Instant::now() + gui.repaint_delay().min(Duration::from_secs(86400));
    }
    gui.destroy();
    Ok(())
}
