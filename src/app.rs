//! The capture workflow as one state machine. Each stage owns exactly the data
//! it needs, so a stale, missing or replaced image cannot be delivered.
use crate::{clipboard::Clipboard, desktop, send, settings::Settings};
use egui_sdl3::egui::{self, Pos2, Rect, TextureHandle};
use screenfling::{
    capture::{self, Captured},
    model::{Crop, Pixels, Result},
};
use sdl3::video::Window;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
#[path = "app_view.rs"]
mod view;
pub use view::configure;

pub enum Message {
    Capture,
    Open,
    Quit,
    Shortcut(u32),
    Captured(u64, Result<Captured>),
    #[cfg(target_os = "linux")]
    ShortcutStatus(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Delivery {
    Copy,
    Send,
}

#[derive(Debug, Default)]
pub enum Action {
    #[default]
    None,
    Capture,
    Cancel,
    Deliver(Delivery, Crop),
    ApplyShortcut,
    Hide,
    Quit,
}

pub enum Stage {
    Idle,
    /// Our window is hidden; a worker reads the display once it is gone.
    Capturing {
        id: u64,
        due: Option<(Instant, [i32; 2])>,
        cancelled: Arc<AtomicBool>,
        target: Option<send::Target>,
    },
    /// The frozen display fills the overlay while a region is chosen.
    Selecting(Selection),
    /// The image is on the clipboard; waiting for the target to take focus.
    Sending {
        pending: send::Pending,
        image: Pixels,
    },
}

#[derive(Clone, Copy)]
enum Present {
    Focused,
    /// Visible but without taking focus from the window the user is in.
    Behind,
}

pub struct Selection {
    pixels: Pixels,
    texture: TextureHandle,
    target: Option<send::Target>,
    /// Pointer position where the current drag began.
    anchor: Option<Pos2>,
    /// Chosen region in overlay points.
    region: Option<Rect>,
    /// A keyboard action waiting for every key to be released, so no held or
    /// repeating key can reach the window that receives focus next.
    armed: Option<Intent>,
}

/// What a key asked for in the overlay, carried out once the key is up.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Intent {
    Deliver(Delivery),
    Cancel,
}

pub struct App {
    pub stage: Stage,
    generation: u64,
    pub settings: Settings,
    pub status: String,
    pub shortcut_status: String,
    pub shortcut: desktop::Shortcut,
    clipboard: Option<Clipboard>,
    worker: Option<JoinHandle<()>>,
    /// Normal window geometry, restored after the overlay.
    restore: [i32; 4],
    /// Capture began in our own window, so finishing returns to it.
    reopen: bool,
    /// How to show the window once the next frame is painted.
    present: Option<Present>,
    /// The window to give focus back to once ours has stepped aside.
    origin: Option<send::Target>,
    pub tray_available: bool,
    pub quit: bool,
}

impl App {
    pub fn new(
        settings: Settings,
        status: String,
        shortcut: desktop::Shortcut,
        shortcut_status: String,
    ) -> Self {
        Self {
            stage: Stage::Idle,
            generation: 0,
            settings,
            status,
            shortcut_status,
            shortcut,
            clipboard: None,
            worker: None,
            restore: [100, 100, desktop::SIZE[0] as i32, desktop::SIZE[1] as i32],
            reopen: true,
            present: None,
            origin: None,
            tray_available: false,
            quit: false,
        }
    }

    pub fn title(&self) -> &'static str {
        match self.stage {
            Stage::Idle => "ScreenFling",
            Stage::Capturing { .. } => "ScreenFling — Capturing",
            Stage::Selecting(_) => "ScreenFling — Select region",
            Stage::Sending { .. } => "ScreenFling — Sending",
        }
    }

    pub fn next_deadline(&self) -> Option<Instant> {
        match &self.stage {
            Stage::Sending { .. } => Some(Instant::now() + Duration::from_millis(25)),
            Stage::Capturing { due, .. } => due.map(|(when, _)| when),
            _ => None,
        }
    }

    fn reap(&mut self) -> bool {
        if self.worker.as_ref().is_some_and(JoinHandle::is_finished)
            && let Some(worker) = self.worker.take()
        {
            let _ = worker.join();
        }
        self.worker.is_none()
    }

    fn clipboard(&mut self) -> Result<&mut Clipboard> {
        match &mut self.clipboard {
            Some(clipboard) => Ok(clipboard),
            slot => Ok(slot.insert(Clipboard::new()?)),
        }
    }

    pub fn tick(&mut self, window: &mut Window) {
        match &mut self.stage {
            Stage::Sending { pending, image } => {
                let clipboard = &mut self.clipboard;
                if let Some(result) =
                    pending.poll(|| clipboard.as_mut().is_some_and(|c| c.matches(image)))
                {
                    let Stage::Sending { pending, .. } =
                        std::mem::replace(&mut self.stage, Stage::Idle)
                    else {
                        unreachable!()
                    };
                    match result {
                        Ok(status) => self.finish(window, status, Some(pending.into_target())),
                        Err(error) => self.fail(error),
                    }
                }
            }
            Stage::Capturing {
                id, due, cancelled, ..
            } => {
                if let Some((when, pointer)) = *due
                    && Instant::now() >= when
                {
                    *due = None;
                    // capture() reaped the previous worker before entering this stage.
                    let (id, cancelled) = (*id, cancelled.clone());
                    match std::thread::Builder::new()
                        .name("screenfling-capture".into())
                        .spawn(move || {
                            let result = capture::capture(pointer, &cancelled);
                            desktop::post(Message::Captured(id, result));
                        }) {
                        Ok(worker) => self.worker = Some(worker),
                        Err(_) => desktop::post(Message::Captured(
                            id,
                            Err("Could not start the capture.".into()),
                        )),
                    }
                }
            }
            _ => {}
        }
        self.reap();
    }

    pub fn after_paint(&mut self, window: &mut Window) {
        match self.present.take() {
            Some(Present::Focused) => {
                window.show();
                window.raise();
            }
            Some(Present::Behind) => {
                sdl3::hint::set("SDL_WINDOW_ACTIVATE_WHEN_SHOWN", "0");
                window.show();
                sdl3::hint::set("SDL_WINDOW_ACTIVATE_WHEN_SHOWN", "1");
                // Some window managers focus any newly mapped window regardless.
                self.return_focus();
            }
            None => {}
        }
    }

    fn return_focus(&mut self) {
        if let Some(origin) = self.origin.take() {
            send::return_to(&origin);
        }
    }

    /// End a capture and return to where the user was. A capture begun in
    /// our own window shows it again. Otherwise focus goes back to the window
    /// capture started from, and ours hides to the tray; without a tray, where
    /// a hidden window could not be reopened or quit, it reappears behind.
    fn finish(&mut self, window: &mut Window, status: String, origin: Option<send::Target>) {
        self.status = status;
        if self.reopen {
            self.present = Some(Present::Focused);
            return;
        }
        self.origin = origin;
        if self.tray_available {
            window.hide();
            self.return_focus();
        } else {
            self.present = Some(Present::Behind);
        }
    }

    /// Show the window so an error is seen.
    fn fail(&mut self, error: String) {
        self.status = error;
        self.present = Some(Present::Focused);
    }

    /// Leave the in-progress capture, if any, without delivering anything.
    fn stop(&mut self, window: &mut Window, status: &str, ok: bool) {
        let origin = match std::mem::replace(&mut self.stage, Stage::Idle) {
            Stage::Capturing {
                cancelled, target, ..
            } => {
                cancelled.store(true, Ordering::Release);
                target
            }
            Stage::Selecting(selection) => {
                close_overlay(window, self.restore);
                selection.target
            }
            other => {
                self.stage = other;
                return;
            }
        };
        if ok {
            self.finish(window, status.into(), origin);
        } else {
            self.fail(status.into());
        }
    }

    pub fn topology_changed(&mut self, window: &mut Window) {
        self.stop(
            window,
            "The display layout changed, so the capture was cancelled.",
            false,
        );
    }

    pub fn message(&mut self, message: Message, ctx: &egui::Context, window: &mut Window) {
        match message {
            Message::Capture => self.action(Action::Capture, ctx, window),
            Message::Shortcut(id) if self.shortcut.accepts(id) => {
                self.action(Action::Capture, ctx, window)
            }
            Message::Shortcut(_) => {}
            Message::Open => {
                // Never show the window over a display being read or a pending paste.
                if matches!(self.stage, Stage::Idle | Stage::Selecting(_)) {
                    window.show();
                    window.raise();
                }
            }
            Message::Quit => self.action(Action::Quit, ctx, window),
            Message::Captured(id, result) => self.captured(id, result, ctx, window),
            #[cfg(target_os = "linux")]
            Message::ShortcutStatus(status) => self.shortcut_status = status,
        }
        ctx.request_repaint();
    }

    fn captured(
        &mut self,
        id: u64,
        result: Result<Captured>,
        ctx: &egui::Context,
        window: &mut Window,
    ) {
        // A result for a cancelled or superseded capture is discarded.
        if !matches!(self.stage, Stage::Capturing { id: current, .. } if current == id) {
            return;
        }
        let Stage::Capturing { target, .. } = std::mem::replace(&mut self.stage, Stage::Idle)
        else {
            unreachable!()
        };
        let captured = match result {
            Ok(captured) => captured,
            Err(error) => return self.fail(error),
        };
        if let Err(error) = desktop::overlay(window, captured.bounds) {
            close_overlay(window, self.restore);
            return self.fail(error);
        }
        let texture = ctx.load_texture(
            "capture",
            egui::ColorImage::from_rgba_unmultiplied(
                [
                    captured.pixels.width as usize,
                    captured.pixels.height as usize,
                ],
                &captured.pixels.rgba,
            ),
            egui::TextureOptions::LINEAR,
        );
        self.status.clear();
        self.stage = Stage::Selecting(Selection {
            pixels: captured.pixels,
            texture,
            target,
            anchor: None,
            region: None,
            armed: None,
        });
        self.present = Some(Present::Focused);
    }

    pub fn action(&mut self, action: Action, ctx: &egui::Context, window: &mut Window) {
        if matches!(action, Action::None) {
            return;
        }
        if let Err(error) = self.try_action(action, window) {
            self.status = error;
        }
        ctx.request_repaint();
    }

    fn try_action(&mut self, action: Action, window: &mut Window) -> Result<()> {
        match action {
            Action::None => {}
            Action::Capture => self.capture(window)?,
            Action::Cancel => self.stop(window, "Capture cancelled.", true),
            Action::Deliver(delivery, crop) => self.deliver(delivery, crop, window)?,
            Action::ApplyShortcut => {
                let old = self.shortcut.current().to_owned();
                self.shortcut.set(&self.settings.shortcut)?;
                if let Err(error) = self.settings.save() {
                    if let Err(rollback) = self.shortcut.restore(&old) {
                        self.shortcut_status =
                            format!("Active shortcut: {} (not saved)", self.shortcut.current());
                        return Err(format!("{error} {rollback}"));
                    }
                    return Err(error);
                }
                self.shortcut_status = format!("Capture shortcut: {}", self.shortcut.current());
                self.status = "Capture shortcut saved.".into();
            }
            Action::Hide => match self.stage {
                Stage::Sending { .. } => return Err("Wait for the paste to finish.".into()),
                Stage::Capturing { .. } | Stage::Selecting(_) => {
                    self.stop(window, "Capture cancelled.", true)
                }
                Stage::Idle if self.tray_available => {
                    window.hide();
                }
                Stage::Idle => self.quit = true,
            },
            Action::Quit => {
                if matches!(self.stage, Stage::Sending { .. }) {
                    return Err("Wait for the paste to finish before quitting.".into());
                }
                if let Stage::Capturing { cancelled, .. } = &self.stage {
                    cancelled.store(true, Ordering::Release);
                }
                self.quit = true;
            }
        }
        Ok(())
    }

    fn capture(&mut self, window: &mut Window) -> Result<()> {
        match self.stage {
            Stage::Idle => {}
            Stage::Selecting(_) => {
                window.show();
                window.raise();
                return Ok(());
            }
            _ => return Ok(()),
        }
        if !self.reap() {
            return Err("The previous capture is still ending. Try again.".into());
        }
        // The window that is active now is where Send returns.
        let target = send::remember();
        let hidden = window.window_flags().0
            & (sdl3_sys::video::SDL_WINDOW_HIDDEN.0 | sdl3_sys::video::SDL_WINDOW_MINIMIZED.0)
            != 0;
        self.reopen = target.is_none() && !hidden;
        self.restore = desktop::geometry(window);
        self.generation = self.generation.wrapping_add(1);
        let pointer = desktop::pointer();
        window.hide();
        self.status = if capture::is_wayland() {
            "Choose one display in the desktop sharing dialog.".into()
        } else {
            "Capturing…".into()
        };
        // Give the compositor time to remove our window before the display is read.
        self.stage = Stage::Capturing {
            id: self.generation,
            due: Some((Instant::now() + Duration::from_millis(100), pointer)),
            cancelled: Arc::new(AtomicBool::new(false)),
            target,
        };
        Ok(())
    }

    fn deliver(&mut self, delivery: Delivery, crop: Crop, window: &mut Window) -> Result<()> {
        let Stage::Selecting(selection) = &self.stage else {
            return Ok(());
        };
        if delivery == Delivery::Send && selection.target.is_none() {
            return Err("Send needs a window to return to. Use Copy.".into());
        }
        let image = selection.pixels.crop(crop)?;
        // A failed copy keeps the selection, so the user can simply try again.
        self.clipboard()?.copy(&image)?;
        let Stage::Selecting(selection) = std::mem::replace(&mut self.stage, Stage::Idle) else {
            unreachable!()
        };
        let summary = format!("{} × {}", image.width, image.height);
        match (delivery, selection.target) {
            (Delivery::Send, Some(target)) => {
                // Activate while we still own the foreground, then step aside.
                let started = send::Pending::start(target);
                close_overlay(window, self.restore);
                match started {
                    Ok(pending) => self.stage = Stage::Sending { pending, image },
                    Err(error) => self.fail(error),
                }
            }
            (_, target) => {
                close_overlay(window, self.restore);
                let hint = match &target {
                    Some(target) => {
                        format!("Paste into {} with {}.", target.application, target.chord())
                    }
                    None => PASTE.to_owned(),
                };
                self.finish(window, format!("Copied {summary}. {hint}"), target);
            }
        }
        Ok(())
    }

    pub fn ui(&mut self, ui: &mut egui::Ui) -> Action {
        view::show(self, ui)
    }
}

/// Terminal agents read image paste from their own key, since terminals keep
/// the usual paste chord for text.
const PASTE: &str = if cfg!(target_os = "macos") {
    "Paste with Cmd+V, or Ctrl+V in a terminal agent."
} else if cfg!(windows) {
    "Paste with Ctrl+V, or Alt+V in a terminal agent."
} else {
    "Paste with Ctrl+V."
};

fn close_overlay(window: &mut Window, restore: [i32; 4]) {
    window.hide();
    desktop::restore(window, restore);
}
