use crate::model::{Pixels, Result};
use std::{
    ffi::OsStr,
    sync::{
        OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
mod wayland;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "linux")]
mod x11;

pub struct Captured {
    pub pixels: Pixels,
    /// Native desktop coordinates. Wayland does not grant global positioning.
    pub bounds: Option<[i32; 4]>,
}

static WAYLAND_SESSION: OnceLock<bool> = OnceLock::new();

/// Read the chosen video driver on the main thread, before starting workers.
/// A Wayland session still needs portals when SDL is running through XWayland.
pub fn initialize_session(video_driver: &str) {
    let _ = WAYLAND_SESSION.set(detect_wayland(video_driver));
}

pub fn is_wayland() -> bool {
    WAYLAND_SESSION
        .get()
        .copied()
        .unwrap_or_else(|| detect_wayland(""))
}

fn detect_wayland(video_driver: &str) -> bool {
    cfg!(target_os = "linux")
        && needs_portal(
            video_driver,
            std::env::var_os("WAYLAND_DISPLAY").as_deref(),
            std::env::var_os("WAYLAND_SOCKET").as_deref(),
            std::env::var_os("XDG_SESSION_TYPE").as_deref(),
        )
}

fn needs_portal(
    video_driver: &str,
    display: Option<&OsStr>,
    socket: Option<&OsStr>,
    session: Option<&OsStr>,
) -> bool {
    video_driver == "wayland"
        || display.is_some_and(|value| !value.is_empty())
        || socket.is_some_and(|value| !value.is_empty())
        || session == Some(OsStr::new("wayland"))
}

pub fn capture(pointer: [i32; 2], cancelled: &AtomicBool) -> Result<Captured> {
    if cancelled.load(Ordering::Acquire) {
        return Err("Capture cancelled.".into());
    }
    #[cfg(target_os = "macos")]
    let result = macos::capture(pointer, cancelled);
    #[cfg(target_os = "windows")]
    let result = windows::capture(pointer);
    #[cfg(target_os = "linux")]
    let result = if is_wayland() {
        wayland::capture(cancelled)
    } else {
        x11::capture(pointer)
    };
    if cancelled.load(Ordering::Acquire) {
        return Err("Capture cancelled.".into());
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wayland_detection_does_not_require_a_named_display() {
        assert!(needs_portal("wayland", None, None, None));
        assert!(needs_portal(
            "x11",
            Some(OsStr::new("wayland-1")),
            None,
            None
        ));
        assert!(needs_portal("", None, Some(OsStr::new("3")), None));
        assert!(needs_portal("x11", None, None, Some(OsStr::new("wayland"))));
        assert!(!needs_portal("x11", None, None, Some(OsStr::new("x11"))));
        assert!(!needs_portal(
            "x11",
            Some(OsStr::new("")),
            Some(OsStr::new("")),
            None
        ));
    }
}
