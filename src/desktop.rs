//! Desktop integration: the event bus into the event loop, the pointer
//! position and the global capture shortcut.
use crate::app::Message;
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState, hotkey::HotKey};
use screenfling::{capture, model::Result};
use std::sync::OnceLock;
use winit::event_loop::EventLoopProxy;

static BUS: OnceLock<EventLoopProxy<Message>> = OnceLock::new();

/// Route messages from other threads (capture, shortcut, tray, launches)
/// into the event loop, which wakes to handle each one.
pub fn install(proxy: EventLoopProxy<Message>) {
    let _ = BUS.set(proxy);
}

pub fn post(message: Message) {
    if let Some(bus) = BUS.get() {
        // Fails only after the event loop has exited, when nothing is waiting.
        let _ = bus.send_event(message);
    }
}

/// The pointer in the desktop coordinates the capture adapters use: physical
/// pixels on Windows and X11, points on macOS. Wayland does not expose it.
pub fn pointer() -> [i32; 2] {
    #[cfg(windows)]
    {
        let mut point = windows_sys::Win32::Foundation::POINT { x: 0, y: 0 };
        unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point) };
        [point.x, point.y]
    }
    #[cfg(target_os = "macos")]
    {
        use objc2_core_graphics::CGEvent;
        CGEvent::new(None).map_or([0, 0], |event| {
            let p = CGEvent::location(Some(&event));
            [p.x.floor() as i32, p.y.floor() as i32]
        })
    }
    #[cfg(target_os = "linux")]
    {
        use x11rb::{connection::Connection, protocol::xproto::ConnectionExt};
        if capture::is_wayland() {
            return [0, 0];
        }
        x11rb::connect(None)
            .ok()
            .and_then(|(conn, screen)| {
                let root = conn.setup().roots[screen].root;
                conn.query_pointer(root).ok()?.reply().ok()
            })
            .map_or([0, 0], |reply| {
                [i32::from(reply.root_x), i32::from(reply.root_y)]
            })
    }
}

#[derive(Default)]
pub struct Shortcut {
    manager: Option<GlobalHotKeyManager>,
    key: Option<HotKey>,
    current: String,
    #[cfg(target_os = "linux")]
    portal: Option<crate::portal_shortcut::PortalShortcut>,
}
impl Shortcut {
    pub fn new(value: &str) -> (Self, String) {
        let mut shortcut = Self::default();
        if capture::is_wayland() {
            #[cfg(target_os = "linux")]
            {
                shortcut.portal = Some(crate::portal_shortcut::PortalShortcut::start());
            }
            return (
                shortcut,
                "Requesting a capture shortcut from the desktop portal…".into(),
            );
        }
        GlobalHotKeyEvent::set_event_handler(Some(|event: GlobalHotKeyEvent| {
            if event.state == HotKeyState::Pressed {
                post(Message::Shortcut(event.id));
            }
        }));
        let status = match shortcut.set(value) {
            Ok(()) => format!("Capture shortcut: {value}"),
            Err(error) => format!("{error} Capture remains available from the tray."),
        };
        (shortcut, status)
    }
    pub fn current(&self) -> &str {
        &self.current
    }
    pub fn accepts(&self, id: u32) -> bool {
        if capture::is_wayland() {
            id == u32::MAX
        } else {
            self.key.as_ref().is_some_and(|key| key.id() == id)
        }
    }
    /// Roll back a failed preferences save, including an initially unbound shortcut.
    pub fn restore(&mut self, value: &str) -> Result<()> {
        if !value.is_empty() {
            return self.set(value);
        }
        if let (Some(manager), Some(key)) = (&self.manager, self.key) {
            manager
                .unregister(key)
                .map_err(|_| "The unsaved shortcut could not be removed.")?;
        }
        self.key = None;
        self.current.clear();
        Ok(())
    }
    pub fn set(&mut self, value: &str) -> Result<()> {
        if capture::is_wayland() {
            return Err("Change this shortcut through the desktop portal settings.".into());
        }
        if value.len() > 80 || value.split('+').count() < 2 {
            return Err("Use a modified shortcut, such as Control+Shift+Digit9.".into());
        }
        let next: HotKey = value.parse().map_err(|_| "The shortcut is not valid. Use names such as Control+Shift+Digit9 or Super+Shift+KeyF.")?;
        if self.key.as_ref() == Some(&next) {
            return Ok(());
        }
        if self.manager.is_none() {
            self.manager = Some(
                GlobalHotKeyManager::new()
                    .map_err(|_| "Global shortcuts are unavailable on this desktop.")?,
            );
        }
        let manager = self
            .manager
            .as_ref()
            .ok_or("Global shortcuts are unavailable.")?;
        manager
            .register(next)
            .map_err(|_| "This shortcut is already in use or could not be registered.")?;
        if let Some(previous) = self.key
            && manager.unregister(previous).is_err()
        {
            let _ = manager.unregister(next);
            return Err("The old shortcut could not be replaced; it was kept.".into());
        }
        self.key = Some(next);
        self.current = value.to_owned();
        Ok(())
    }
}
impl Drop for Shortcut {
    fn drop(&mut self) {
        if let (Some(manager), Some(key)) = (&self.manager, self.key) {
            let _ = manager.unregister(key);
        }
    }
}

/// Cover a display with `window` above the menu bar and Dock, on every Space.
/// `bounds` are CoreGraphics points with a top-left origin; Cocoa frames
/// measure from the bottom-left of the primary display.
#[cfg(target_os = "macos")]
pub fn cover(window: &winit::window::Window, [x, y, w, h]: [i32; 4]) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSScreen, NSScreenSaverWindowLevel, NSView, NSWindowCollectionBehavior};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let Ok(handle) = window.window_handle() else {
        return;
    };
    let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
        return;
    };
    // SAFETY: winit's AppKit handle is a live NSView on the main thread.
    let view: &NSView = unsafe { handle.ns_view.cast().as_ref() };
    let Some(ns_window) = view.window() else {
        return;
    };
    let Some(primary) = NSScreen::screens(mtm).firstObject() else {
        return;
    };
    let top = primary.frame().size.height;
    let frame = NSRect::new(
        NSPoint::new(f64::from(x), top - f64::from(y + h)),
        NSSize::new(f64::from(w), f64::from(h)),
    );
    // The level sits above the menu bar; screen savers stay above it.
    ns_window.setLevel(unsafe { NSScreenSaverWindowLevel } - 1);
    ns_window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );
    ns_window.setFrame_display(frame, true);
}
