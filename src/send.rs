//! Send: return to the window that was active before capture and press its
//! paste key once. The clipboard carries the image; Enter is never pressed.
use screenfling::model::Result;
use std::time::{Duration, Instant};

#[cfg(target_os = "linux")]
#[path = "send/linux.rs"]
mod linux;
#[cfg(target_os = "macos")]
#[path = "send/macos.rs"]
mod macos;
#[cfg(target_os = "windows")]
#[path = "send/windows.rs"]
mod windows;
#[cfg(target_os = "linux")]
use linux as native;
#[cfg(target_os = "macos")]
use macos as native;
#[cfg(target_os = "windows")]
use windows as native;

/// The modifier held with V. Applications choose their own image-paste chord,
/// so the adapter picks one from the kind of window it remembered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Modifier {
    Control,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Command,
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    Alt,
}

#[derive(Clone, Debug)]
pub struct Target {
    pub application: String,
    pub modifier: Modifier,
    native: native::Target,
}

impl Target {
    pub fn chord(&self) -> &'static str {
        match self.modifier {
            Modifier::Control => "Ctrl+V",
            Modifier::Command => "Cmd+V",
            Modifier::Alt => "Alt+V",
        }
    }
}

/// The active window of another application, if the desktop allows returning to it.
pub fn remember() -> Option<Target> {
    native::remember()
}

/// Give focus back to the window capture started from, without pasting.
pub fn return_to(target: &Target) {
    // Best effort: if it closed, focus is wherever the desktop put it.
    let _ = native::activate(&target.native);
}

/// Activation is asynchronous: wait for the target to own focus, then paste once.
pub struct Pending {
    target: Target,
    deadline: Instant,
}
impl Pending {
    pub fn start(target: Target) -> Result<Self> {
        native::authorize()?;
        native::activate(&target.native)?;
        Ok(Self {
            target,
            deadline: Instant::now() + Duration::from_secs(2),
        })
    }
    pub fn into_target(self) -> Target {
        self.target
    }
    pub fn poll(&self, clipboard_matches: impl FnOnce() -> bool) -> Option<Result<String>> {
        if !native::focused(&self.target.native) {
            return (Instant::now() >= self.deadline).then(|| {
                Err(format!(
                    "Could not return to {}. The image is copied; paste it with {}.",
                    self.target.application,
                    self.target.chord()
                ))
            });
        }
        Some(
            checked_paste(
                clipboard_matches(),
                || native::focused(&self.target.native),
                || paste(&self.target),
            )
            .map(|()| format!("Pasted into {}.", self.target.application)),
        )
    }
}

#[cfg(target_os = "windows")]
fn paste(target: &Target) -> Result<()> {
    native::paste(target.modifier)
}
#[cfg(not(target_os = "windows"))]
fn paste(target: &Target) -> Result<()> {
    native::paste(&target.native, target.modifier)
}

fn checked_paste(
    clipboard_matches: bool,
    focused: impl FnOnce() -> bool,
    paste: impl FnOnce() -> Result<()>,
) -> Result<()> {
    if !clipboard_matches || !focused() {
        return Err("The window or clipboard changed. Nothing was pasted.".into());
    }
    // One request only. An OS acknowledgment is not an attachment receipt,
    // and a repeated chord could paste twice.
    paste()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn paste_requires_the_same_clipboard_and_focus_and_never_retries() {
        let calls = Cell::new(0);
        let paste = || {
            calls.set(calls.get() + 1);
            Ok(())
        };
        assert!(checked_paste(false, || true, paste).is_err());
        assert!(checked_paste(true, || false, paste).is_err());
        assert_eq!(calls.get(), 0);
        let failing = || {
            calls.set(calls.get() + 1);
            Err("OS rejected paste".into())
        };
        assert!(checked_paste(true, || true, failing).is_err());
        assert_eq!(calls.get(), 1);
    }
}
