#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
mod app;
mod cli;
mod clipboard;
mod desktop;
#[cfg(target_os = "linux")]
mod portal_shortcut;
mod send;
mod settings;
use egui_sdl3::{egui, egui_glow::glow};
use sdl3::event::{Event, WindowEvent};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

fn main() -> std::process::ExitCode {
    let capture_on_start = match cli::parse(std::env::args_os().skip(1)) {
        Ok(cli::Startup::Open) => false,
        Ok(cli::Startup::Capture) => true,
        Ok(cli::Startup::Version) => {
            println!("ScreenFling {}", env!("CARGO_PKG_VERSION"));
            return std::process::ExitCode::SUCCESS;
        }
        Ok(cli::Startup::Help) => {
            println!("{}", cli::HELP);
            return std::process::ExitCode::SUCCESS;
        }
        Err(error) => {
            eprintln!("ScreenFling: {error}\nRun screenfling --help for usage.");
            return std::process::ExitCode::from(2);
        }
    };
    if let Err(error) = run(capture_on_start) {
        eprintln!("ScreenFling: {error}");
        let _ = sdl3::messagebox::show_simple_message_box(
            sdl3::messagebox::MessageBoxFlag::ERROR,
            "ScreenFling",
            &error,
            None,
        );
        return std::process::ExitCode::FAILURE;
    }
    std::process::ExitCode::SUCCESS
}
fn run(capture_on_start: bool) -> Result<(), String> {
    // A screenshot utility must not keep an idle desktop awake.
    sdl3::hint::set("SDL_VIDEO_ALLOW_SCREENSAVER", "1");
    sdl3::hint::set("SDL_APP_NAME", "ScreenFling");
    sdl3::hint::set("SDL_APP_ID", "dev.screenfling.ScreenFling");
    sdl3::hint::set("SDL_WINDOWS_DPI_AWARENESS", "permonitorv2");
    let sdl = sdl3::init().map_err(|e| e.to_string())?;
    let video = sdl.video().map_err(|e| e.to_string())?;
    if !unsafe { sdl3_sys::video::SDL_EnableScreenSaver() } {
        return Err("Could not allow the desktop's normal screensaver behavior.".into());
    }
    let wayland = video.current_video_driver() == "wayland";
    screenfling::capture::initialize_session(video.current_video_driver());
    let receiver = desktop::install(&sdl)?;
    video
        .gl_attr()
        .set_context_profile(sdl3::video::GLProfile::Core);
    video.gl_attr().set_context_version(3, 2);
    let mut window = video
        .window("ScreenFling", 1000, 740)
        .opengl()
        .high_pixel_density()
        .resizable()
        .position_centered()
        .hidden()
        .build()
        .map_err(|e| e.to_string())?;
    unsafe {
        sdl3_sys::video::SDL_SetWindowMinimumSize(window.raw(), 640, 480);
    }
    let gl_context = window.gl_create_context().map_err(|e| e.to_string())?;
    let glow = Arc::new(unsafe {
        glow::Context::from_loader_function(|name| {
            video
                .gl_get_proc_address(name)
                .map_or(std::ptr::null(), |p| p as *const _)
        })
    });
    let mut gui = egui_sdl3::EguiGlow::new(&window, glow, None, false);
    app::configure(&gui.ctx);
    gui.ctx.set_request_repaint_callback(|info| {
        if info.delay.is_zero() {
            desktop::wake();
        }
    });
    let (settings, status) = settings::Settings::load();
    let (shortcut, shortcut_status) = desktop::Shortcut::new(&settings.shortcut);
    let tray = desktop::Tray::new();
    let mut app = app::App::new(settings, status, shortcut, shortcut_status);
    app.tray_available = tray.is_some();
    let mut events = sdl.event_pump().map_err(|e| e.to_string())?;
    let mut deadline = Instant::now();
    let mut first_frame = true;
    let mut title_phase = None;
    while !app.quit {
        let scheduled = app
            .next_deadline()
            .map_or(deadline, |capture| deadline.min(capture));
        let mut pending = Vec::new();
        if let Some(event) =
            events.wait_event_timeout(scheduled.saturating_duration_since(Instant::now()))
        {
            pending.push(event);
        }
        pending.extend(events.poll_iter());
        for event in pending {
            match &event {
                Event::Quit { .. } => app.action(app::Action::Quit, &gui.ctx, &mut window),
                Event::Window {
                    win_event: WindowEvent::CloseRequested,
                    ..
                } => app.action(app::Action::Hide, &gui.ctx, &mut window),
                Event::Display { .. } if !first_frame => app.topology_changed(&mut window),
                _ => {}
            }
            let _ = gui.state.on_event(&window, &event);
        }
        for message in receiver.try_iter() {
            app.message(message, &gui.ctx, &mut window);
        }
        app.tick();
        if app.quit {
            break;
        }
        if wayland {
            // A mapped EGL drawable is required for painting. Flush the pending
            // show before drawing on Wayland, not afterwards as on X11/macOS.
            if first_frame && capture_on_start {
                first_frame = false;
                app.action(app::Action::Capture, &gui.ctx, &mut window);
            }
            if first_frame {
                window.show();
            }
            app.after_paint(&mut window);
            if window.window_flags().0 & sdl3_sys::video::SDL_WINDOW_HIDDEN.0 != 0 {
                // Do not consume egui's texture changes until they can be painted.
                // Capture deadlines and worker events still wake the event loop.
                deadline = Instant::now() + Duration::from_secs(86400);
                continue;
            }
            // SDL can recreate the EGL surface across hide/show transitions.
            window
                .gl_make_current(&gl_context)
                .map_err(|e| e.to_string())?;
        }
        if title_phase != Some(app.flow.phase()) {
            use screenfling::model::Phase;
            let title = match app.flow.phase() {
                Phase::Capturing => "ScreenFling — Capturing",
                Phase::Selecting => "ScreenFling — Select region",
                Phase::Review => "ScreenFling — Review crop",
                Phase::Delivering => "ScreenFling — Sending",
                Phase::Result => "ScreenFling — Result",
                Phase::Idle => "ScreenFling",
            };
            window.set_title(title).map_err(|e| e.to_string())?;
            title_phase = Some(app.flow.phase());
        }
        gui.state.sync_window_size(&window);
        let mut input = gui.state.take_egui_input();
        // egui-sdl3 0.4 lays out in drawable pixels / pixels-per-point, but
        // divides window-coordinate mouse/touch positions by that same factor
        // without first applying pixel density. Correct only its position events;
        // screen_rect and wheel deltas are already in their intended units.
        // Keep this boundary covered by the fractional-scale desktop fixture
        // when updating the backend; do not apply the conversion twice upstream.
        let (w, h) = gui.state.get_window_size();
        let (pw, ph) = gui.state.get_drawable_size();
        for event in &mut input.events {
            match event {
                egui::Event::PointerMoved(pos)
                | egui::Event::PointerButton { pos, .. }
                | egui::Event::Touch { pos, .. } => {
                    pos.x *= pw as f32 / w.max(1) as f32;
                    pos.y *= ph as f32 / h.max(1) as f32;
                }
                _ => {}
            }
        }
        let mut action = app::Action::None;
        let output = gui.ctx.run_ui(input, |ui| {
            dismiss_menu_escape(ui);
            action = app.ui(ui);
        });
        let repaint = output
            .viewport_output
            .get(&egui::ViewportId::ROOT)
            .map(|v| v.repaint_delay)
            .unwrap_or(Duration::MAX);
        sync_text_input(&window, output.platform_output.ime.is_some())?;
        gui.state.handle_platform_output(output.platform_output);
        let primitives = gui.ctx.tessellate(output.shapes, output.pixels_per_point);
        gui.clear([12.0 / 255.0, 17.0 / 255.0, 27.0 / 255.0, 1.0]);
        gui.painter.paint_and_update_textures(
            gui.state.get_drawable_size().into(),
            output.pixels_per_point,
            &primitives,
            &output.textures_delta,
        );
        window.gl_swap_window();
        app.after_paint(&mut window);
        if first_frame {
            first_frame = false;
            if capture_on_start {
                app.action(app::Action::Capture, &gui.ctx, &mut window);
            } else {
                window.show();
            }
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

fn sync_text_input(window: &sdl3::video::Window, wanted: bool) -> Result<(), String> {
    // SDL3 does not enable Unicode text events by default. Follow egui's focused
    // text editor, not all keyboard focus, and leave non-editing shortcuts alone.
    use sdl3_sys::keyboard::{SDL_StartTextInput, SDL_StopTextInput, SDL_TextInputActive};
    let current = unsafe { SDL_TextInputActive(window.raw()) };
    if current != wanted {
        let changed = unsafe {
            if wanted {
                SDL_StartTextInput(window.raw())
            } else {
                SDL_StopTextInput(window.raw())
            }
        };
        if !changed {
            return Err("Could not update native text input for the focused field.".into());
        }
    }
    Ok(())
}

fn dismiss_menu_escape(ui: &mut egui::Ui) {
    // A popup owns Escape before the underlying page can cancel or hide.
    if egui::Popup::is_any_open(ui.ctx())
        && ui.input_mut(|input| input.consume_key(egui::Modifiers::NONE, egui::Key::Escape))
    {
        egui::Popup::close_all(ui.ctx());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_dismisses_only_the_open_menu() {
        let ctx = egui::Context::default();
        let input = egui::RawInput {
            events: vec![egui::Event::Key {
                key: egui::Key::Escape,
                physical_key: None,
                pressed: true,
                repeat: false,
                modifiers: egui::Modifiers::NONE,
            }],
            ..Default::default()
        };
        let _ = ctx.run_ui(input.clone(), |ui| {
            egui::Popup::open_id(ui.ctx(), egui::Id::new("menu-test"));
            dismiss_menu_escape(ui);
            assert!(!egui::Popup::is_any_open(ui.ctx()));
            assert!(!ui.input(|input| input.key_pressed(egui::Key::Escape)));
        });
        let _ = ctx.run_ui(input, |ui| {
            dismiss_menu_escape(ui);
            assert!(ui.input(|input| input.key_pressed(egui::Key::Escape)));
        });
    }
}
