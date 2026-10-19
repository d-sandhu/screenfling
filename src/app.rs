//! The capture workflow as one state machine on winit's event loop. Each stage
//! owns exactly the data it needs, so a stale, missing or replaced image cannot
//! be delivered. All drawing is on the CPU: no GPU, no GUI toolkit.
use crate::{
    autostart,
    canvas::{Canvas, Text},
    clipboard::Clipboard,
    desktop,
    overlay::{Delivery, Intent, Selection},
    panel::{self, Control, Mode},
    send,
    settings::Settings,
    tray::Tray,
};
use screenfling::{
    capture::{self, Captured},
    model::{Crop, Pixels, Result},
};
use std::{
    collections::HashSet,
    num::NonZeroU32,
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use winit::{
    application::ApplicationHandler,
    dpi::PhysicalPosition,
    event::{ElementState, KeyEvent, MouseButton, StartCause, WindowEvent},
    event_loop::{ActiveEventLoop, ControlFlow},
    keyboard::{Key, KeyCode, ModifiersState, NamedKey, PhysicalKey},
    window::{CursorIcon, Fullscreen, Window, WindowId, WindowLevel},
};

pub enum Message {
    Capture,
    Shortcut(u32),
    Captured(u64, Result<Captured>),
    Control(Control),
    #[cfg(target_os = "linux")]
    ShortcutStatus(String),
}

enum Stage {
    Idle,
    /// Our windows are hidden; a worker reads the display once they are gone.
    Capturing {
        id: u64,
        due: Option<(Instant, [i32; 2])>,
        cancelled: Arc<AtomicBool>,
        origin: Option<send::Target>,
        agents: Vec<send::Target>,
    },
    /// The frozen display fills the overlay while a region is chosen.
    Selecting(Box<Selection>),
    /// The image is on the clipboard; waiting for the agent to take focus.
    Sending {
        pending: send::Pending,
        image: Pixels,
    },
}

/// A window drawn by the CPU through softbuffer.
struct Surface {
    window: Rc<Window>,
    buffer: softbuffer::Surface<Rc<Window>, Rc<Window>>,
}

impl Surface {
    fn new(
        event_loop: &ActiveEventLoop,
        attributes: winit::window::WindowAttributes,
    ) -> Option<Self> {
        let window = Rc::new(event_loop.create_window(attributes).ok()?);
        let context = softbuffer::Context::new(window.clone()).ok()?;
        let buffer = softbuffer::Surface::new(&context, window.clone()).ok()?;
        Some(Self { window, buffer })
    }

    fn id(&self) -> WindowId {
        self.window.id()
    }

    /// Fill the window's pixels with `draw` and show them.
    fn present(&mut self, draw: impl FnOnce(&mut Canvas)) {
        let size = self.window.inner_size();
        let (Some(w), Some(h)) = (NonZeroU32::new(size.width), NonZeroU32::new(size.height)) else {
            return;
        };
        if self.buffer.resize(w, h).is_err() {
            return;
        }
        let Ok(mut buffer) = self.buffer.buffer_mut() else {
            return;
        };
        let mut canvas = Canvas {
            pixels: &mut buffer,
            width: size.width as usize,
            height: size.height as usize,
        };
        draw(&mut canvas);
        let _ = buffer.present();
    }
}

pub struct App {
    stage: Stage,
    generation: u64,
    settings: Settings,
    shortcut: desktop::Shortcut,
    shortcut_status: String,
    clipboard: Option<Clipboard>,
    worker: Option<JoinHandle<()>>,
    /// The last Send destination; it stays the default while it is open.
    last_sent: Option<send::Target>,
    text: Text,
    overlay: Option<Surface>,
    panel: Option<Surface>,
    mode: Option<Mode>,
    notice: Option<Surface>,
    notice_text: Option<Mode>,
    notice_until: Option<Instant>,
    /// Show the home panel again once a capture finishes, and whether the
    /// capture began from it (so focus belongs back there).
    restore_home: bool,
    home_was_active: bool,
    panel_pointer: [f32; 2],
    tray: Option<Tray>,
    keys: HashSet<PhysicalKey>,
    modifiers: ModifiersState,
    capture_on_start: bool,
    started: bool,
    /// winit is on Wayland, where windows are hidden by dropping them.
    wayland: bool,
}

#[derive(Clone, Copy)]
enum Which {
    Overlay,
    Notice,
    Panel,
}

impl App {
    pub fn new(capture_on_start: bool) -> Self {
        let (settings, status) = Settings::load();
        Self {
            stage: Stage::Idle,
            generation: 0,
            settings,
            shortcut: desktop::Shortcut::default(),
            shortcut_status: status,
            clipboard: None,
            worker: None,
            last_sent: None,
            text: Text::new(),
            overlay: None,
            panel: None,
            mode: None,
            notice: None,
            notice_text: None,
            notice_until: None,
            restore_home: false,
            home_was_active: false,
            panel_pointer: [0.0; 2],
            tray: None,
            keys: HashSet::new(),
            modifiers: ModifiersState::empty(),
            capture_on_start,
            started: false,
            wayland: false,
        }
    }

    fn shortcut_label(&self) -> String {
        if capture::is_wayland() {
            "your desktop's ScreenFling shortcut".into()
        } else if self.shortcut.current().is_empty() {
            "the tray icon".into()
        } else {
            panel::readable(self.shortcut.current())
        }
    }

    fn overlay_attributes() -> winit::window::WindowAttributes {
        let overlay = window_attributes()
            .with_title("ScreenFling — Select region")
            .with_visible(false)
            .with_decorations(false)
            .with_window_level(WindowLevel::AlwaysOnTop);
        #[cfg(windows)]
        let overlay = {
            use winit::platform::windows::WindowAttributesExtWindows;
            overlay.with_skip_taskbar(true)
        };
        overlay
    }

    /// Hide a window. Wayland cannot unmap one (winit's `set_visible` does
    /// nothing there), so the window is dropped and created again when needed.
    fn hide(&mut self, which: Which) {
        let slot = match which {
            Which::Overlay => &mut self.overlay,
            Which::Notice => &mut self.notice,
            Which::Panel => &mut self.panel,
        };
        if self.wayland {
            *slot = None;
        } else if let Some(surface) = slot {
            surface.window.set_visible(false);
        }
    }

    fn start(&mut self, event_loop: &ActiveEventLoop) {
        #[cfg(target_os = "linux")]
        {
            use winit::platform::wayland::ActiveEventLoopExtWayland;
            self.wayland = event_loop.is_wayland();
        }
        self.overlay = Surface::new(event_loop, Self::overlay_attributes());
        let (shortcut, status) = desktop::Shortcut::new(&self.settings.shortcut);
        self.shortcut = shortcut;
        if !status.is_empty() && self.shortcut_status.is_empty() {
            self.shortcut_status = status;
        }
        self.tray = Tray::new(&self.shortcut_label(), autostart::enabled());
        if self.overlay.is_none() {
            eprintln!("ScreenFling: could not create a window.");
            event_loop.exit();
            return;
        }
        if self.tray.is_none() {
            // Without a tray the controls need a home: a small normal window.
            self.show_panel(event_loop, Mode::Home, true);
        } else if !self.capture_on_start {
            let message = format!(
                "ScreenFling is running. Press {} to capture.",
                self.shortcut_label()
            );
            self.notify(event_loop, message);
        }
        if self.capture_on_start {
            self.begin_capture(event_loop);
        }
    }

    fn clipboard(&mut self) -> Result<&mut Clipboard> {
        match &mut self.clipboard {
            Some(clipboard) => Ok(clipboard),
            slot => Ok(slot.insert(Clipboard::new()?)),
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

    // ---- Notices: brief messages that never take focus ----

    fn notify(&mut self, event_loop: &ActiveEventLoop, message: String) {
        // Also on stderr, where a terminal or a test fixture can read it.
        eprintln!("ScreenFling: {message}");
        if self.mode == Some(Mode::Home) {
            // The home panel shows messages itself.
            self.shortcut_status = message;
            self.draw_panel();
            return;
        }
        if self.notice.is_none() {
            let attributes = window_attributes()
                .with_title("ScreenFling notice")
                .with_visible(false)
                .with_resizable(false)
                .with_decorations(false)
                .with_active(false)
                .with_window_level(WindowLevel::AlwaysOnTop);
            #[cfg(windows)]
            let attributes = {
                use winit::platform::windows::WindowAttributesExtWindows;
                attributes.with_skip_taskbar(true)
            };
            #[cfg(target_os = "linux")]
            let attributes = {
                // An override-redirect window is never focused by the window
                // manager, so the notice cannot take focus on X11.
                use winit::platform::x11::WindowAttributesExtX11;
                attributes.with_override_redirect(true)
            };
            self.notice = Surface::new(event_loop, attributes);
        }
        let Some(notice) = &self.notice else {
            return;
        };
        let scale = notice.window.scale_factor() as f32;
        let mode = Mode::Notice(message);
        let layout = panel::Layout::new(&mode, &self.status(), &mut self.text, scale);
        let size = winit::dpi::PhysicalSize::new(layout.size[0] as u32, layout.size[1] as u32);
        let _ = notice.window.request_inner_size(size);
        // Bottom-right of the main display, clear of the taskbar or Dock.
        if let Some(monitor) = event_loop.primary_monitor() {
            let (m, ms) = (monitor.position(), monitor.size());
            let margin = (24.0 * scale) as i32;
            notice.window.set_outer_position(PhysicalPosition::new(
                m.x + ms.width as i32 - size.width as i32 - margin,
                m.y + ms.height as i32 - size.height as i32 - margin * 3,
            ));
        }
        show_without_focus(&notice.window);
        self.notice_text = Some(mode);
        self.notice_until = Some(Instant::now() + Duration::from_secs(4));
        self.draw_notice();
    }

    fn draw_notice(&mut self) {
        let (Some(notice), Some(mode)) = (&mut self.notice, &self.notice_text) else {
            return;
        };
        let scale = notice.window.scale_factor() as f32;
        let status = panel::Status {
            shortcut: String::new(),
            login: false,
            message: String::new(),
        };
        let layout = panel::Layout::new(mode, &status, &mut self.text, scale);
        let text = &mut self.text;
        notice.present(|canvas| layout.draw(canvas, text, [-1.0, -1.0], scale));
    }

    fn hide_notice(&mut self) {
        self.hide(Which::Notice);
        self.notice_text = None;
        self.notice_until = None;
    }

    // ---- Panel: the shortcut prompt, and the controls without a tray ----

    /// Show the panel; `take_focus` only when the user is turning to it.
    fn show_panel(&mut self, event_loop: &ActiveEventLoop, mode: Mode, take_focus: bool) {
        if self.panel.is_none() {
            let attributes = window_attributes()
                .with_title("ScreenFling")
                .with_visible(false)
                .with_resizable(false)
                .with_active(false);
            #[cfg(windows)]
            let attributes = {
                use winit::platform::windows::WindowAttributesExtWindows;
                attributes.with_skip_taskbar(self.tray.is_some())
            };
            self.panel = Surface::new(event_loop, attributes);
        }
        let Some(panel) = &self.panel else {
            return;
        };
        let scale = panel.window.scale_factor() as f32;
        let status = self.status();
        let layout = panel::Layout::new(&mode, &status, &mut self.text, scale);
        let size = winit::dpi::PhysicalSize::new(layout.size[0] as u32, layout.size[1] as u32);
        let _ = panel.window.request_inner_size(size);
        panel.window.set_window_level(if mode == Mode::Prompt {
            WindowLevel::AlwaysOnTop
        } else {
            WindowLevel::Normal
        });
        if let Some(monitor) = event_loop.primary_monitor() {
            let (m, ms) = (monitor.position(), monitor.size());
            panel.window.set_outer_position(PhysicalPosition::new(
                m.x + (ms.width as i32 - size.width as i32) / 2,
                m.y + (ms.height as i32 - size.height as i32) / 3,
            ));
        }
        self.mode = Some(mode);
        if take_focus {
            panel.window.set_visible(true);
            panel.window.focus_window();
        } else {
            show_without_focus(&panel.window);
        }
        self.draw_panel();
    }

    fn draw_panel(&mut self) {
        let Some(mode) = self.mode.clone() else {
            return;
        };
        let status = self.status();
        let Some(surface) = &mut self.panel else {
            return;
        };
        let scale = surface.window.scale_factor() as f32;
        let layout = panel::Layout::new(&mode, &status, &mut self.text, scale);
        let (text, pointer) = (&mut self.text, self.panel_pointer);
        surface.present(|canvas| layout.draw(canvas, text, pointer, scale));
    }

    fn hide_panel(&mut self) {
        self.hide(Which::Panel);
        self.mode = None;
    }

    fn status(&self) -> panel::Status {
        panel::Status {
            shortcut: self.shortcut_label(),
            login: autostart::enabled(),
            message: self.shortcut_status.clone(),
        }
    }

    fn control(&mut self, event_loop: &ActiveEventLoop, control: Control) {
        match control {
            Control::Capture => self.begin_capture(event_loop),
            Control::ChangeShortcut if capture::is_wayland() => self.notify(
                event_loop,
                "On Wayland the desktop's settings assign this shortcut.".into(),
            ),
            Control::ChangeShortcut => self.show_panel(event_loop, Mode::Prompt, true),
            Control::ToggleLogin => {
                let on = !autostart::enabled();
                match autostart::set(on) {
                    Ok(()) => {
                        if let Some(tray) = &self.tray {
                            tray.set_login(on);
                        }
                        let message = if on {
                            "ScreenFling will start when you log in."
                        } else {
                            "ScreenFling will no longer start at login."
                        };
                        self.notify(event_loop, message.into());
                    }
                    Err(error) => {
                        if let Some(tray) = &self.tray {
                            tray.set_login(autostart::enabled());
                        }
                        self.notify(event_loop, error);
                    }
                }
            }
            Control::Quit => {
                if !matches!(self.stage, Stage::Sending { .. }) {
                    self.stop(event_loop, None);
                    event_loop.exit();
                }
            }
        }
    }

    fn apply_shortcut(&mut self, event_loop: &ActiveEventLoop, value: String) {
        let old = self.shortcut.current().to_owned();
        let result = self.shortcut.set(&value).and_then(|()| {
            let mut next = self.settings.clone();
            next.shortcut = value.clone();
            next.save().map(|()| self.settings = next).inspect_err(|_| {
                // Keep the old shortcut working if the new one cannot be saved.
                let _ = self.shortcut.restore(&old);
            })
        });
        let home = self.tray.is_none();
        self.hide_panel();
        let message = match result {
            Ok(()) => {
                if let Some(tray) = &self.tray {
                    tray.set_shortcut(&self.shortcut_label());
                }
                format!("Capture shortcut: {}", self.shortcut_label())
            }
            Err(error) => error,
        };
        if home {
            self.show_panel(event_loop, Mode::Home, true);
        }
        self.notify(event_loop, message);
    }

    // ---- Capture workflow ----

    fn begin_capture(&mut self, event_loop: &ActiveEventLoop) {
        match &self.stage {
            Stage::Idle => {}
            Stage::Selecting(_) => {
                if let Some(overlay) = &self.overlay {
                    overlay.window.focus_window();
                }
                return;
            }
            _ => return,
        }
        if !self.reap() {
            self.notify(
                event_loop,
                "The previous capture is still ending. Try again.".into(),
            );
            return;
        }
        // Read the desktop before our windows hide: the active window is where
        // Copy and Cancel return, and the window order ranks Send destinations.
        let origin = send::remember();
        let agents = send::agents();
        // Without a tray the home panel is the only way back; restore it even
        // if the capture interrupted the shortcut prompt.
        self.restore_home = self.tray.is_none();
        self.home_was_active = self.restore_home && origin.is_none();
        self.hide_panel();
        self.hide_notice();
        self.generation = self.generation.wrapping_add(1);
        // Give the compositor time to remove our windows before the display is read.
        self.stage = Stage::Capturing {
            id: self.generation,
            due: Some((
                Instant::now() + Duration::from_millis(100),
                desktop::pointer(),
            )),
            cancelled: Arc::new(AtomicBool::new(false)),
            origin,
            agents,
        };
    }

    fn captured(&mut self, event_loop: &ActiveEventLoop, id: u64, result: Result<Captured>) {
        // A result for a cancelled or superseded capture is discarded.
        if !matches!(self.stage, Stage::Capturing { id: current, .. } if current == id) {
            return;
        }
        let Stage::Capturing { origin, agents, .. } =
            std::mem::replace(&mut self.stage, Stage::Idle)
        else {
            unreachable!()
        };
        let captured = match result {
            Ok(captured) => captured,
            Err(error) => return self.finish(event_loop, Some(error), origin, false),
        };
        let chosen = self
            .last_sent
            .as_ref()
            .and_then(|last| agents.iter().position(|agent| agent.same(last)))
            .unwrap_or(0);
        if self.overlay.is_none() {
            self.overlay = Surface::new(event_loop, Self::overlay_attributes());
        }
        let Some(overlay) = &self.overlay else {
            return self.finish(
                event_loop,
                Some("Could not open the capture window.".into()),
                origin,
                false,
            );
        };
        place_overlay(event_loop, &overlay.window, captured.bounds);
        overlay.window.set_cursor(CursorIcon::Crosshair);
        overlay.window.set_visible(true);
        overlay.window.focus_window();
        overlay.window.request_redraw();
        self.keys.clear();
        self.modifiers = ModifiersState::empty();
        self.stage = Stage::Selecting(Box::new(Selection::new(
            captured.pixels,
            origin,
            agents,
            chosen,
        )));
    }

    /// End a capture and return to where the user was: the agent after Send,
    /// otherwise the window capture started from. Errors are shown, never lost.
    fn finish(
        &mut self,
        event_loop: &ActiveEventLoop,
        error: Option<String>,
        focus: Option<send::Target>,
        sent: bool,
    ) {
        // Stay fullscreen while hidden: leaving fullscreen restores, and so
        // shows, the window on Windows. The next capture re-places it.
        self.hide(Which::Overlay);
        if std::mem::take(&mut self.restore_home) {
            self.show_panel(event_loop, Mode::Home, false);
        }
        if let Some(target) = &focus {
            // Hiding does not move focus everywhere (macOS keeps the app active).
            send::return_to(target);
        } else if !sent
            && std::mem::take(&mut self.home_was_active)
            && let Some(panel) = &self.panel
        {
            panel.window.focus_window();
        }
        if let Some(error) = error {
            self.notify(event_loop, error);
        }
    }

    /// Leave the capture in progress, if any, without delivering anything.
    fn stop(&mut self, event_loop: &ActiveEventLoop, error: Option<String>) {
        let origin = match std::mem::replace(&mut self.stage, Stage::Idle) {
            Stage::Capturing {
                cancelled, origin, ..
            } => {
                cancelled.store(true, Ordering::Release);
                origin
            }
            Stage::Selecting(selection) => selection.origin,
            other => {
                self.stage = other;
                return;
            }
        };
        self.finish(event_loop, error, origin, false);
    }

    fn deliver(&mut self, event_loop: &ActiveEventLoop, delivery: Delivery, crop: Crop) {
        let Stage::Selecting(selection) = &self.stage else {
            return;
        };
        let destination = selection.destination().cloned();
        let image = match selection.crop_pixels(crop) {
            Ok(image) => image,
            Err(error) => return self.notify(event_loop, error),
        };
        // A failed copy keeps the selection, so the user can simply try again.
        if let Err(error) = self.clipboard().and_then(|c| c.copy(&image)) {
            self.notify(event_loop, error);
            return;
        }
        let Stage::Selecting(selection) = std::mem::replace(&mut self.stage, Stage::Idle) else {
            unreachable!()
        };
        match (delivery, destination) {
            (Delivery::Send, Some(target)) => {
                self.last_sent = Some(target.clone());
                // Activate while we still own the foreground, then step aside.
                let started = send::Pending::start(target);
                self.hide(Which::Overlay);
                match started {
                    Ok(pending) => self.stage = Stage::Sending { pending, image },
                    Err(error) => self.finish(event_loop, Some(error), selection.origin, false),
                }
            }
            (_, agent) => {
                let hint = match &agent {
                    Some(agent) => format!("Paste into {} with {}.", agent.name(), agent.chord()),
                    None => PASTE.to_owned(),
                };
                self.finish(event_loop, None, selection.origin, false);
                self.notify(
                    event_loop,
                    format!("Copied {} × {}. {hint}", image.width, image.height),
                );
            }
        }
    }

    fn tick(&mut self, event_loop: &ActiveEventLoop) {
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
                    let target = pending.into_target();
                    match result {
                        // Focus is already in the agent; leave it there.
                        Ok(_) => self.finish(event_loop, None, None, true),
                        Err(error) => self.finish(event_loop, Some(error), Some(target), false),
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
                    // begin_capture reaped the previous worker before this stage.
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
        if self
            .notice_until
            .is_some_and(|until| Instant::now() >= until)
        {
            self.hide_notice();
        }
        self.reap();
        let next = [
            matches!(self.stage, Stage::Sending { .. })
                .then(|| Instant::now() + Duration::from_millis(25)),
            match &self.stage {
                Stage::Capturing { due, .. } => due.map(|(when, _)| when),
                _ => None,
            },
            self.notice_until,
        ]
        .into_iter()
        .flatten()
        .min();
        event_loop.set_control_flow(next.map_or(ControlFlow::Wait, ControlFlow::WaitUntil));
    }

    // ---- Overlay input ----

    fn overlay_event(&mut self, event_loop: &ActiveEventLoop, event: WindowEvent) {
        let Stage::Selecting(selection) = &mut self.stage else {
            return;
        };
        match event {
            WindowEvent::RedrawRequested => {
                let Some(overlay) = &mut self.overlay else {
                    return;
                };
                let size = overlay.window.inner_size();
                let scale = overlay.window.scale_factor() as f32;
                selection.resize(size.width as usize, size.height as usize, scale);
                let text = &mut self.text;
                overlay.present(|canvas| selection.draw(canvas, text, ""));
            }
            WindowEvent::CursorMoved { position, .. } => {
                if selection.pointer_moved([position.x as f32, position.y as f32], &mut self.text)
                    && let Some(overlay) = &self.overlay
                {
                    overlay.window.request_redraw();
                }
            }
            WindowEvent::MouseInput {
                state,
                button: MouseButton::Left,
                ..
            } => {
                let delivery = match state {
                    ElementState::Pressed => {
                        selection.pressed(&mut self.text);
                        None
                    }
                    ElementState::Released => selection.released(&mut self.text),
                };
                if let Some(overlay) = &self.overlay {
                    overlay.window.request_redraw();
                }
                if let (Some(delivery), Some(crop)) = (delivery, selection.crop()) {
                    self.deliver(event_loop, delivery, crop);
                }
            }
            WindowEvent::Focused(false) => {
                // macOS and Wayland do not report releases for keys held as
                // focus leaves; forget them rather than wait forever.
                self.keys.clear();
                self.modifiers = ModifiersState::empty();
            }
            WindowEvent::KeyboardInput { event, .. } => {
                self.overlay_key(event_loop, event);
            }
            WindowEvent::CloseRequested => self.stop(event_loop, None),
            _ => {}
        }
    }

    fn overlay_key(&mut self, event_loop: &ActiveEventLoop, event: KeyEvent) {
        match event.state {
            ElementState::Pressed => {
                self.keys.insert(event.physical_key);
            }
            ElementState::Released => {
                self.keys.remove(&event.physical_key);
            }
        }
        let Stage::Selecting(selection) = &mut self.stage else {
            return;
        };
        if event.state == ElementState::Pressed && !event.repeat {
            let command = if cfg!(target_os = "macos") {
                self.modifiers.super_key()
            } else {
                self.modifiers.control_key()
            };
            match &event.logical_key {
                Key::Named(NamedKey::Escape) => {
                    if !selection.close_menu() {
                        selection.armed = Some(Intent::Cancel);
                    }
                }
                Key::Named(NamedKey::Space) => selection.select_all(),
                Key::Named(NamedKey::Tab) => selection.next_destination(),
                Key::Named(NamedKey::Enter)
                    if selection.crop().is_some() && !selection.dragging() =>
                {
                    selection.armed = Some(Intent::Deliver(if selection.destination().is_some() {
                        Delivery::Send
                    } else {
                        Delivery::Copy
                    }));
                }
                _ if command
                    && event.physical_key == PhysicalKey::Code(KeyCode::KeyC)
                    && selection.crop().is_some() =>
                {
                    selection.armed = Some(Intent::Deliver(Delivery::Copy));
                }
                _ => {}
            }
            if let Some(overlay) = &self.overlay {
                overlay.window.request_redraw();
            }
        }
        // Act only once every key is up, so nothing held or auto-repeating
        // reaches the window that gets focus next. Modifier keys are physical
        // keys too; their modifier state arrives in a different order per
        // platform, so it is not part of this test.
        if !self.keys.is_empty() {
            return;
        }
        let Stage::Selecting(selection) = &mut self.stage else {
            return;
        };
        match (selection.armed.take(), selection.crop()) {
            (Some(Intent::Cancel), _) => self.stop(event_loop, None),
            (Some(Intent::Deliver(delivery)), Some(crop)) => {
                self.deliver(event_loop, delivery, crop)
            }
            _ => {}
        }
    }

    // ---- Panel input ----

    fn panel_event(&mut self, event_loop: &ActiveEventLoop, event: WindowEvent) {
        let Some(mode) = self.mode.clone() else {
            return;
        };
        match event {
            WindowEvent::RedrawRequested => self.draw_panel(),
            WindowEvent::CursorMoved { position, .. } => {
                self.panel_pointer = [position.x as f32, position.y as f32];
                self.draw_panel();
            }
            WindowEvent::MouseInput {
                state: ElementState::Released,
                button: MouseButton::Left,
                ..
            } if mode == Mode::Home => {
                let Some(panel) = &self.panel else {
                    return;
                };
                let scale = panel.window.scale_factor() as f32;
                let status = self.status();
                let layout = panel::Layout::new(&mode, &status, &mut self.text, scale);
                if let Some(control) = layout.hit(self.panel_pointer) {
                    self.control(event_loop, control);
                }
            }
            WindowEvent::KeyboardInput {
                event:
                    KeyEvent {
                        physical_key: PhysicalKey::Code(code),
                        logical_key,
                        state: ElementState::Pressed,
                        repeat: false,
                        ..
                    },
                ..
            } if mode == Mode::Prompt => {
                if logical_key == Key::Named(NamedKey::Escape) {
                    self.hide_panel();
                    if self.tray.is_none() {
                        self.show_panel(event_loop, Mode::Home, true);
                    }
                    return;
                }
                let m = self.modifiers;
                let held: Vec<&str> = [
                    (m.control_key(), "Control"),
                    (m.alt_key(), "Alt"),
                    (m.shift_key(), "Shift"),
                    (m.super_key(), "Super"),
                ]
                .into_iter()
                .filter_map(|(on, name)| on.then_some(name))
                .collect();
                // winit names physical keys with the W3C codes global-hotkey parses.
                if let Some(value) = panel::shortcut(&held, &format!("{code:?}")) {
                    self.apply_shortcut(event_loop, value);
                }
            }
            WindowEvent::CloseRequested => {
                if mode == Mode::Home {
                    self.control(event_loop, Control::Quit);
                } else {
                    self.hide_panel();
                    if self.tray.is_none() {
                        self.show_panel(event_loop, Mode::Home, true);
                    }
                }
            }
            _ => {}
        }
    }
}

impl ApplicationHandler<Message> for App {
    fn new_events(&mut self, event_loop: &ActiveEventLoop, cause: StartCause) {
        // Tray icons must be created once the event loop is running (macOS).
        if cause == StartCause::Init && !self.started {
            self.started = true;
            self.start(event_loop);
        }
    }

    fn resumed(&mut self, _event_loop: &ActiveEventLoop) {}

    fn user_event(&mut self, event_loop: &ActiveEventLoop, message: Message) {
        match message {
            Message::Capture => self.begin_capture(event_loop),
            Message::Shortcut(id) if self.shortcut.accepts(id) => self.begin_capture(event_loop),
            Message::Shortcut(_) => {}
            Message::Captured(id, result) => self.captured(event_loop, id, result),
            Message::Control(control) => self.control(event_loop, control),
            #[cfg(target_os = "linux")]
            Message::ShortcutStatus(status) => {
                self.shortcut_status = status;
                if let Some(panel) = &self.panel {
                    panel.window.request_redraw();
                }
            }
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, id: WindowId, event: WindowEvent) {
        // Modifier state belongs to the keyboard, not to one window or stage.
        if let WindowEvent::ModifiersChanged(modifiers) = &event {
            self.modifiers = modifiers.state();
        }
        if self.overlay.as_ref().is_some_and(|o| o.id() == id) {
            self.overlay_event(event_loop, event);
        } else if self.panel.as_ref().is_some_and(|p| p.id() == id) {
            self.panel_event(event_loop, event);
        } else if self.notice.as_ref().is_some_and(|n| n.id() == id)
            && event == WindowEvent::RedrawRequested
        {
            self.draw_notice();
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        self.tick(event_loop);
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

/// Cover exactly the captured display. Windows and X11 report bounds in
/// physical pixels, which winit's monitors share; macOS reports points and
/// places the window above the menu bar itself; Wayland chooses the output.
fn place_overlay(event_loop: &ActiveEventLoop, window: &Window, bounds: Option<[i32; 4]>) {
    let Some([x, y, w, h]) = bounds else {
        window.set_fullscreen(Some(Fullscreen::Borderless(None)));
        return;
    };
    #[cfg(target_os = "macos")]
    {
        let _ = event_loop;
        crate::desktop::cover(window, [x, y, w, h]);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let monitor = event_loop.available_monitors().find(|m| {
            let (p, s) = (m.position(), m.size());
            [p.x, p.y, s.width as i32, s.height as i32] == [x, y, w, h]
        });
        match monitor {
            Some(monitor) => window.set_fullscreen(Some(Fullscreen::Borderless(Some(monitor)))),
            None => {
                window.set_outer_position(PhysicalPosition::new(x, y));
                let _ =
                    window.request_inner_size(winit::dpi::PhysicalSize::new(w as u32, h as u32));
            }
        }
    }
}

/// Every window shares the application's identity: the Wayland app ID and the
/// X11 class match the desktop entry, dev.screenfling.ScreenFling.
fn window_attributes() -> winit::window::WindowAttributes {
    let attributes = Window::default_attributes();
    #[cfg(target_os = "linux")]
    let attributes = winit::platform::x11::WindowAttributesExtX11::with_name(
        attributes,
        "dev.screenfling.ScreenFling",
        "screenfling",
    );
    attributes
}

/// Show a window without activating it, so focus stays in the user's app.
/// Windows: the window was created inactive, which winit honours on every
/// show. X11: notices are override-redirect, which the window manager never
/// focuses. Wayland leaves focus to the compositor. macOS needs AppKit.
fn show_without_focus(window: &Window) {
    #[cfg(target_os = "macos")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        if let Ok(handle) = window.window_handle()
            && let RawWindowHandle::AppKit(handle) = handle.as_raw()
        {
            // SAFETY: winit's AppKit handle is a live NSView on the main thread.
            let view: &objc2_app_kit::NSView = unsafe { handle.ns_view.cast().as_ref() };
            if let Some(ns_window) = view.window() {
                ns_window.orderFrontRegardless();
                return;
            }
        }
    }
    window.set_visible(true);
}
