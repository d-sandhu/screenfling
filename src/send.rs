//! Paste the clipboard image into a detected foreground coding agent.
//! No terminal plugins, socket configuration, guessed focus, or Enter key.
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

#[derive(Clone, Debug)]
pub struct Target {
    pub application: String,
    pub title: String,
    guard: screenfling::agents::Guard,
    native: native::Target,
}

pub fn discover() -> Result<Vec<Target>> {
    native::discover()
}

pub struct Pending {
    target: Target,
    deadline: Instant,
}
impl Pending {
    pub fn start(target: Target, clipboard_matches: bool) -> Result<Self> {
        if !clipboard_matches {
            return Err("The clipboard changed. Nothing was pasted.".into());
        }
        if !target.guard.current() {
            return Err(
                "The agent session changed. Refresh sessions, or paste the copied image manually."
                    .into(),
            );
        }
        native::activate(&target.native)?;
        Ok(Self {
            target,
            deadline: Instant::now() + Duration::from_secs(2),
        })
    }
    pub fn poll(&self, clipboard_matches: impl FnOnce() -> bool) -> Option<Result<String>> {
        if !native::focused(&self.target.native) {
            return if Instant::now() >= self.deadline {
                Some(Err("Could not focus the agent terminal. The image is copied; switch to your agent and press Ctrl+V.".into()))
            } else {
                None
            };
        }
        Some(
            checked_paste(
                clipboard_matches(),
                || self.target.guard.current() && native::focused(&self.target.native),
                || native::paste(&self.target.native),
            )
            .map(|()| {
                format!(
                    "Image paste requested in {} — {}. Check the attachment before submitting.",
                    self.target.application, self.target.title
                )
            }),
        )
    }
}

fn checked_paste(
    clipboard_matches: bool,
    focused: impl FnOnce() -> bool,
    paste: impl FnOnce() -> Result<()>,
) -> Result<()> {
    if !clipboard_matches || !focused() {
        return Err("The selected window or clipboard changed. Nothing was pasted.".into());
    }
    // One request only. An OS acknowledgment is not an agent attachment receipt.
    paste()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    #[test]
    fn changed_clipboard_or_focus_prevents_paste_without_retry() {
        let calls = Cell::new(0);
        let paste = || {
            calls.set(calls.get() + 1);
            Ok(())
        };
        assert!(checked_paste(false, || true, paste).is_err());
        assert!(checked_paste(true, || false, paste).is_err());
        assert_eq!(calls.get(), 0);
        assert!(
            checked_paste(
                true,
                || true,
                || {
                    calls.set(calls.get() + 1);
                    Err("OS rejected paste".into())
                }
            )
            .is_err()
        );
        assert_eq!(calls.get(), 1);
    }
}
