#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
mod app;
mod autostart;
mod canvas;
mod cli;
mod clipboard;
mod desktop;
mod instance;
mod overlay;
mod panel;
#[cfg(target_os = "linux")]
mod portal_shortcut;
mod send;
mod settings;
mod tray;

use std::process::ExitCode;
use winit::event_loop::EventLoop;

fn main() -> ExitCode {
    let capture_on_start = match cli::parse(std::env::args_os().skip(1)) {
        Ok(cli::Startup::Open) => false,
        Ok(cli::Startup::Capture) => true,
        Ok(cli::Startup::Version) => {
            println!("ScreenFling {}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
        Ok(cli::Startup::Help) => {
            println!("{}", cli::HELP);
            return ExitCode::SUCCESS;
        }
        Err(error) => {
            eprintln!("ScreenFling: {error}\nRun screenfling --help for usage.");
            return ExitCode::from(2);
        }
    };
    match run(capture_on_start) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("ScreenFling: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(capture_on_start: bool) -> Result<(), String> {
    #[allow(unused_mut)]
    let mut builder = EventLoop::<app::Message>::with_user_event();
    #[cfg(target_os = "macos")]
    {
        // A menu-bar utility: no Dock icon and no app menu.
        use winit::platform::macos::{ActivationPolicy, EventLoopBuilderExtMacOS};
        builder.with_activation_policy(ActivationPolicy::Accessory);
    }
    let event_loop = builder
        .build()
        .map_err(|_| "Could not connect to the desktop.")?;
    screenfling::capture::initialize_session(&wayland_session(&event_loop));
    desktop::install(event_loop.create_proxy());
    // One running copy: a later launch, with or without --capture, asks the
    // running copy to capture and exits.
    let _listener = match instance::claim()? {
        instance::Role::Primary(listener) => listener,
        instance::Role::Forwarded => return Ok(()),
    };
    let mut app = app::App::new(capture_on_start);
    event_loop
        .run_app(&mut app)
        .map_err(|_| "The desktop event loop stopped unexpectedly.".into())
}

/// The display server winit connected to, which decides how capture works.
fn wayland_session(event_loop: &EventLoop<app::Message>) -> String {
    #[cfg(target_os = "linux")]
    {
        use winit::platform::wayland::EventLoopExtWayland;
        if event_loop.is_wayland() {
            return "wayland".into();
        }
    }
    let _ = event_loop;
    String::new()
}
