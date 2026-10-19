//! Remember the frontmost app without requesting Accessibility access.
use super::*;
use objc2::rc::Retained;
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};
use objc2_core_foundation::{CFBoolean, CFDictionary, CFString};
use objc2_core_graphics::{CGEvent, CGEventFlags, CGEventSource, CGEventSourceStateID};
use std::{
    ffi::c_void,
    sync::atomic::{AtomicBool, Ordering},
};

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
}

#[derive(Clone, Debug)]
pub struct Target(Retained<NSRunningApplication>);

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

pub fn remember() -> Option<super::Target> {
    let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    if app.processIdentifier() == std::process::id() as i32 {
        return None;
    }
    let terminal = app
        .bundleIdentifier()
        .is_some_and(|bundle| TERMINALS.contains(&bundle.to_string().as_str()));
    Some(super::Target {
        application: app
            .localizedName()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "the previous app".into()),
        modifier: if terminal {
            Modifier::Control
        } else {
            Modifier::Command
        },
        native: Target(app),
    })
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
