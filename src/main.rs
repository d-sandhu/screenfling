#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
mod app;
mod clipboard;
mod desktop;
mod settings;
mod wezterm;
mod trusted;
mod relay;
#[cfg(target_os = "linux")]
mod portal_shortcut;
use egui_sdl3::{egui, egui_glow::glow};
use sdl3::event::{Event, WindowEvent};
use std::{sync::Arc, time::{Duration, Instant}};

fn main() {
    if std::env::args().any(|arg| arg == "--version") { println!("ScreenFling {}", env!("CARGO_PKG_VERSION")); return; }
    if let Err(error) = run() {
        eprintln!("ScreenFling: {error}");
        let _ = sdl3::messagebox::show_simple_message_box(sdl3::messagebox::MessageBoxFlag::ERROR, "ScreenFling", &error, None);
        std::process::exit(1);
    }
}
fn run() -> Result<(), String> {
    sdl3::hint::set("SDL_APP_NAME", "ScreenFling");
    sdl3::hint::set("SDL_APP_ID", "dev.screenfling.ScreenFling");
    sdl3::hint::set("SDL_WINDOWS_DPI_AWARENESS", "permonitorv2");
    let sdl = sdl3::init().map_err(|e| e.to_string())?;
    let video = sdl.video().map_err(|e| e.to_string())?;
    let receiver = desktop::install(&sdl)?;
    video.gl_attr().set_context_profile(sdl3::video::GLProfile::Core);
    video.gl_attr().set_context_version(3, 2);
    let mut window = video.window("ScreenFling", 820, 680).opengl().high_pixel_density().resizable().position_centered().hidden().build().map_err(|e| e.to_string())?;
    let _gl = window.gl_create_context().map_err(|e| e.to_string())?;
    let glow = Arc::new(unsafe { glow::Context::from_loader_function(|name| video.gl_get_proc_address(name).map_or(std::ptr::null(), |p| p as *const _)) });
    let mut gui = egui_sdl3::EguiGlow::new(&window, glow, None, false);
    gui.ctx.set_request_repaint_callback(|info| { if info.delay.is_zero() { desktop::wake(); } });
    let (settings, status) = settings::Settings::load();
    let (shortcut, shortcut_status) = desktop::Shortcut::new(&settings.shortcut);
    let tray = desktop::Tray::new();
    let mut app = app::App::new(settings, status, shortcut, shortcut_status);
    app.tray_available = tray.is_some();
    let mut events = sdl.event_pump().map_err(|e| e.to_string())?;
    let mut deadline = Instant::now();
    let mut first_frame = true;
    let capture_on_start = std::env::args().any(|arg| arg == "--capture");
    while !app.quit {
        let scheduled = app.next_deadline().map_or(deadline, |capture| deadline.min(capture));
        let mut pending = Vec::new();
        if let Some(event) = events.wait_event_timeout(scheduled.saturating_duration_since(Instant::now())) { pending.push(event); }
        pending.extend(events.poll_iter());
        for event in pending {
            match &event {
                Event::Quit { .. } => app.action(app::Action::Quit, &gui.ctx, &mut window),
                Event::Window { win_event: WindowEvent::CloseRequested, .. } => app.action(app::Action::Hide, &gui.ctx, &mut window),
                Event::Display { .. } if !first_frame => app.topology_changed(&mut window),
                _ => {}
            }
            gui.state.on_event(&window, &event);
        }
        for message in receiver.try_iter() { app.message(message, &gui.ctx, &mut window); }
        app.tick();
        if app.quit { break; }
        gui.state.sync_window_size(&window);
        let mut action = app::Action::None;
        let output = gui.ctx.run_ui(gui.state.take_egui_input(), |ui| { action = app.ui(ui); });
        let repaint = output.viewport_output.get(&egui::ViewportId::ROOT).map(|v| v.repaint_delay).unwrap_or(Duration::MAX);
        gui.state.handle_platform_output(output.platform_output);
        let primitives = gui.ctx.tessellate(output.shapes, output.pixels_per_point);
        gui.clear([0.08, 0.08, 0.09, 1.0]);
        gui.painter.paint_and_update_textures(gui.state.get_drawable_size().into(), output.pixels_per_point, &primitives, &output.textures_delta);
        window.gl_swap_window();
        app.after_paint(&mut window);
        if first_frame {
            first_frame = false;
            if capture_on_start { app.action(app::Action::Capture, &gui.ctx, &mut window); }
            else { window.show(); }
        }
        app.action(action, &gui.ctx, &mut window);
        deadline = Instant::now() + repaint.min(Duration::from_secs(86400));
    }
    desktop::shutdown();
    drop(app);
    drop(tray);
    gui.destroy();
    Ok(())
}
