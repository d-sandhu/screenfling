//! Find agent apps and the frontmost app without requesting Accessibility.
use super::*;
use objc2::rc::Retained;
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};
use objc2_core_foundation::{CFArray, CFBoolean, CFDictionary, CFNumber, CFString, CFType};
use objc2_core_graphics::{
    CGEvent, CGEventFlags, CGEventSource, CGEventSourceStateID, CGWindowListCopyWindowInfo,
    CGWindowListOption, kCGNullWindowID, kCGWindowLayer, kCGWindowName, kCGWindowOwnerPID,
};
use std::{
    ffi::c_void,
    sync::atomic::{AtomicBool, Ordering},
};

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
}

/// macOS activates applications, not single windows, so an app is the target.
#[derive(Clone, Debug)]
pub struct Target(Retained<NSRunningApplication>);

impl PartialEq for Target {
    fn eq(&self, other: &Self) -> bool {
        self.0.processIdentifier() == other.0.processIdentifier()
    }
}

/// Terminal hosts forward Control+V to the program inside; GUI apps paste with Command+V.
const TERMINALS: &[&str] = &[
    "com.mitchellh.ghostty",
    "com.apple.Terminal",
    "com.googlecode.iterm2",
    "com.github.wez.wezterm",
    "net.kovidgoyal.kitty",
    "org.alacritty",
    "dev.warp.Warp-Stable",
];

/// Coding agents with windows of their own, by bundle identifier.
const AGENT_APPS: &[&str] = &[
    "com.anthropic.claudefordesktop",
    "com.openai.chat",
    "com.openai.codex",
    "com.todesktop.230313mzl4w4u92",
    "com.microsoft.VSCode",
    "com.microsoft.VSCodeInsiders",
    "com.exafunction.windsurf",
    "dev.zed.Zed",
];

/// An app as a destination, and whether it hosts a coding agent. `None` for
/// ScreenFling itself.
fn describe(app: Retained<NSRunningApplication>, title: String) -> Option<(super::Target, bool)> {
    if app.processIdentifier() == std::process::id() as i32 {
        return None;
    }
    let bundle = app
        .bundleIdentifier()
        .map(|b| b.to_string())
        .unwrap_or_default();
    let terminal = TERMINALS.contains(&bundle.as_str());
    let agent = terminal || AGENT_APPS.contains(&bundle.as_str());
    Some((
        super::Target {
            application: app
                .localizedName()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "the previous app".into()),
            title,
            modifier: if terminal {
                Modifier::Control
            } else {
                Modifier::Command
            },
            native: Target(app),
        },
        agent,
    ))
}

pub fn remember() -> Option<super::Target> {
    let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    describe(app, String::new()).map(|(target, _)| target)
}

/// Agent apps, front to back by their frontmost on-screen window, one entry
/// per app. The window list is the window server's own stacking order.
pub fn agents() -> Vec<super::Target> {
    let Some(windows) = CGWindowListCopyWindowInfo(
        CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements,
        kCGNullWindowID,
    ) else {
        return Vec::new();
    };
    // SAFETY: CGWindowListCopyWindowInfo returns an array of dictionaries
    // keyed by CFString, and the window-info keys are immutable statics.
    let windows: &CFArray<CFDictionary<CFString, CFType>> = unsafe { windows.cast_unchecked() };
    let (layer_key, pid_key, name_key) =
        unsafe { (kCGWindowLayer, kCGWindowOwnerPID, kCGWindowName) };
    let mut seen = Vec::new();
    let mut agents = Vec::new();
    for window in windows.iter() {
        let number = |key: &CFString| {
            window
                .get(key)
                .and_then(|value| value.downcast::<CFNumber>().ok())
                .and_then(|number| number.as_i64())
        };
        // Layer 0 holds ordinary application windows, not menus or panels.
        let (Some(0), Some(pid)) = (number(layer_key), number(pid_key)) else {
            continue;
        };
        if seen.contains(&pid) {
            continue;
        }
        seen.push(pid);
        let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid as i32)
        else {
            continue;
        };
        let title = window
            .get(name_key)
            .and_then(|value| value.downcast::<CFString>().ok())
            .map(|name| name.to_string())
            .unwrap_or_default();
        if let Some((target, true)) = describe(app, title) {
            agents.push(target);
        }
    }
    agents
}

/// Posting key events needs Accessibility; activating an app does not.
pub fn authorize() -> Result<()> {
    // Ask only after an explicit Send, never on capture or startup.
    static PROMPTED: AtomicBool = AtomicBool::new(false);
    let prompt = CFString::from_str("AXTrustedCheckOptionPrompt");
    let options = CFDictionary::from_slices(
        &[&*prompt],
        &[CFBoolean::new(!PROMPTED.swap(true, Ordering::Relaxed))],
    );
    if !unsafe { AXIsProcessTrustedWithOptions((&*options as *const CFDictionary<_, _>).cast()) } {
        return Err("Send needs Accessibility access. Enable ScreenFling in System Settings > Privacy & Security > Accessibility. The image is already copied; you can paste it manually.".into());
    }
    Ok(())
}

pub fn activate(target: &Target) -> Result<()> {
    if target.0.isTerminated() {
        return Err("That app closed. The image is copied; paste it manually.".into());
    }
    #[allow(deprecated)]
    if !target
        .0
        .activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps)
    {
        return Err("Could not return to that app. The image is copied; paste it manually.".into());
    }
    Ok(())
}
pub fn focused(target: &Target) -> bool {
    !target.0.isTerminated() && target.0.isActive()
}
pub fn paste(target: &Target, modifier: Modifier) -> Result<()> {
    let modifiers = CGEventFlags::MaskShift
        | CGEventFlags::MaskControl
        | CGEventFlags::MaskAlternate
        | CGEventFlags::MaskCommand;
    if CGEventSource::flags_state(CGEventSourceStateID::CombinedSessionState).intersects(modifiers)
    {
        return Err("Release modifier keys before sending. The image is on your clipboard.".into());
    }
    let down =
        CGEvent::new_keyboard_event(None, 9, true).ok_or("Could not create the paste request.")?;
    let up =
        CGEvent::new_keyboard_event(None, 9, false).ok_or("Could not finish the paste request.")?;
    let flags = match modifier {
        Modifier::Command => CGEventFlags::MaskCommand,
        _ => CGEventFlags::MaskControl,
    };
    CGEvent::set_flags(Some(&down), flags);
    CGEvent::set_flags(Some(&up), flags);
    CGEvent::post_to_pid(target.0.processIdentifier(), Some(&down));
    CGEvent::post_to_pid(target.0.processIdentifier(), Some(&up));
    Ok(())
}
