use crate::model::{Pixels, Result};
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "linux")]
mod x11;
#[cfg(target_os = "linux")]
mod wayland;

pub struct Captured {
    pub pixels: Pixels,
    /// Native desktop coordinates. Wayland does not grant global positioning.
    pub bounds: Option<[i32; 4]>,
}

pub fn is_wayland() -> bool {
    cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_some()
}

pub fn capture(pointer: [i32; 2], cancelled: &AtomicBool) -> Result<Captured> {
    if cancelled.load(Ordering::Acquire) { return Err("Capture cancelled.".into()); }
    #[cfg(target_os = "macos")]
    let result = macos::capture(pointer, cancelled);
    #[cfg(target_os = "windows")]
    let result = windows::capture(pointer);
    #[cfg(target_os = "linux")]
    let result = if is_wayland() { wayland::capture(cancelled) } else { x11::capture(pointer) };
    if cancelled.load(Ordering::Acquire) { return Err("Capture cancelled.".into()); }
    result
}
