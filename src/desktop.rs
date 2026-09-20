//! Native event/lifecycle glue. No polling loop or secondary application process.
use crate::app::Message;
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState, hotkey::HotKey};
use screenfling::{capture, model::Result};
use sdl3::{event::EventSender, video::Window};
use std::{
    ffi::c_void,
    sync::{
        OnceLock,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
};

#[derive(Debug)]
pub struct Wake;
struct Bus {
    sender: mpsc::Sender<Message>,
    events: EventSender,
}
static BUS: OnceLock<Bus> = OnceLock::new();
static ACTIVE: AtomicBool = AtomicBool::new(true);

pub fn install(sdl: &sdl3::Sdl) -> Result<mpsc::Receiver<Message>> {
    let events = sdl.event().map_err(|e| e.to_string())?;
    events
        .register_custom_event::<Wake>()
        .map_err(|e| e.to_string())?;
    let (sender, receiver) = mpsc::channel();
    BUS.set(Bus {
        sender,
        events: events.event_sender(),
    })
    .map_err(|_| "The desktop event loop was already initialized.")?;
    Ok(receiver)
}
pub fn wake() {
    if ACTIVE.load(Ordering::Acquire) {
        if let Some(bus) = BUS.get() {
            let _ = bus.events.push_custom_event(Wake);
        }
    }
}
pub fn post(message: Message) {
    if ACTIVE.load(Ordering::Acquire) {
        if let Some(bus) = BUS.get() {
            if bus.sender.send(message).is_ok() {
                wake();
            }
        }
    }
}
pub fn shutdown() {
    ACTIVE.store(false, Ordering::Release);
}
pub fn pointer() -> [i32; 2] {
    let (mut x, mut y) = (0.0f32, 0.0f32);
    unsafe {
        sdl3_sys::mouse::SDL_GetGlobalMouseState(&mut x, &mut y);
    }
    [x.floor() as i32, y.floor() as i32]
}
pub fn geometry(window: &Window) -> [i32; 4] {
    let (x, y) = window.position();
    let (w, h) = window.size();
    [x, y, w as i32, h as i32]
}
pub fn overlay(window: &mut Window, bounds: Option<[i32; 4]>) -> Result<()> {
    use sdl3_sys::video::*;
    unsafe {
        SDL_SetWindowMinimumSize(window.raw(), 1, 1);
        SDL_SetWindowResizable(window.raw(), false);
        SDL_SetWindowBordered(window.raw(), false);
        SDL_SetWindowAlwaysOnTop(window.raw(), true);
        if let Some([x, y, width, height]) = bounds {
            if width <= 0
                || height <= 0
                || !SDL_SetWindowPosition(window.raw(), x, y)
                || !SDL_SetWindowSize(window.raw(), width, height)
            {
                return Err(
                    "Could not place the frozen capture on its display. Nothing was copied.".into(),
                );
            }
        } else if !SDL_SetWindowFullscreen(window.raw(), true) {
            return Err(
                "The Wayland compositor could not present the frozen selection surface.".into(),
            );
        }
    }
    Ok(())
}
pub fn restore(window: &mut Window, [x, y, width, height]: [i32; 4]) {
    use sdl3_sys::video::*;
    unsafe {
        SDL_SetWindowFullscreen(window.raw(), false);
        SDL_SetWindowAlwaysOnTop(window.raw(), false);
        SDL_SetWindowBordered(window.raw(), true);
        SDL_SetWindowResizable(window.raw(), true);
        SDL_SetWindowMinimumSize(window.raw(), 640, 480);
        SDL_SetWindowSize(window.raw(), width.max(640), height.max(480));
        SDL_SetWindowPosition(window.raw(), x, y);
    }
}

pub struct Shortcut {
    manager: Option<GlobalHotKeyManager>,
    key: Option<HotKey>,
    current: String,
    #[cfg(target_os = "linux")]
    portal: Option<crate::portal_shortcut::PortalShortcut>,
}
impl Shortcut {
    pub fn new(value: &str) -> (Self, String) {
        let mut shortcut = Self {
            manager: None,
            key: None,
            current: String::new(),
            #[cfg(target_os = "linux")]
            portal: None,
        };
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
            Err(error) => format!("{error} The Capture button remains available."),
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
        if let Some(previous) = self.key {
            if manager.unregister(previous).is_err() {
                let _ = manager.unregister(next);
                return Err("The old shortcut could not be replaced; it was kept.".into());
            }
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

pub struct Tray(*mut sdl3_sys::tray::SDL_Tray);
impl Tray {
    pub fn new() -> Option<Self> {
        use sdl3_sys::{pixels::SDL_PIXELFORMAT_RGBA32, surface::*, tray::*};
        let mut icon = vec![0u8; 24 * 24 * 4];
        for y in 4usize..20 {
            for x in 4usize..20 {
                if ((x < 7 || x >= 17) && (y < 10 || y >= 14))
                    || ((y < 7 || y >= 17) && (x < 10 || x >= 14))
                {
                    let i = (y * 24 + x) * 4;
                    icon[i..i + 4].copy_from_slice(&[78, 170, 245, 255]);
                }
            }
        }
        unsafe {
            let surface = SDL_CreateSurfaceFrom(
                24,
                24,
                SDL_PIXELFORMAT_RGBA32,
                icon.as_mut_ptr().cast(),
                24 * 4,
            );
            if surface.is_null() {
                return None;
            }
            let tray = SDL_CreateTray(surface, c"ScreenFling".as_ptr());
            SDL_DestroySurface(surface);
            if tray.is_null() {
                return None;
            }
            let menu = SDL_CreateTrayMenu(tray);
            if menu.is_null() {
                SDL_DestroyTray(tray);
                return None;
            }
            for (label, code) in [(c"Capture", 1usize), (c"Open ScreenFling", 2), (c"Quit", 3)] {
                let entry = SDL_InsertTrayEntryAt(menu, -1, label.as_ptr(), SDL_TRAYENTRY_BUTTON);
                if entry.is_null() {
                    SDL_DestroyTray(tray);
                    return None;
                }
                SDL_SetTrayEntryCallback(entry, Some(tray_action), code as *mut c_void);
            }
            Some(Self(tray))
        }
    }
}
unsafe extern "C" fn tray_action(data: *mut c_void, _: *mut sdl3_sys::tray::SDL_TrayEntry) {
    match data as usize {
        1 => post(Message::Capture),
        2 => post(Message::Open),
        3 => post(Message::Quit),
        _ => {}
    }
}
impl Drop for Tray {
    fn drop(&mut self) {
        unsafe {
            sdl3_sys::tray::SDL_DestroyTray(self.0);
        }
    }
}
