use super::*;
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};
use objc2_core_foundation::{CFArray, CFBoolean, CFDictionary, CFRetained, CFString, CFType};
use objc2_core_graphics::{CGEvent, CGEventFlags, CGEventSource, CGEventSourceStateID};
use std::{ffi::c_void, ptr::NonNull, rc::Rc};

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    fn AXUIElementCreateApplication(pid: i32) -> *mut CFType;
    fn AXUIElementCopyAttributeValue(
        element: *const CFType,
        attribute: &CFString,
        value: *mut *mut CFType,
    ) -> i32;
    fn AXUIElementPerformAction(element: *const CFType, action: &CFString) -> i32;
    fn AXUIElementSetMessagingTimeout(element: *const CFType, timeout: f32) -> i32;
}

#[derive(Debug)]
struct Element(CFRetained<CFType>);
// AX objects stay on the SDL main thread; no unsafe Send/Sync assertion.

#[derive(Clone, Debug)]
pub struct Target {
    pid: i32,
    app: Rc<Element>,
    window: Rc<Element>,
}

fn attribute(element: &CFType, name: &str) -> Option<CFRetained<CFType>> {
    let mut value = std::ptr::null_mut();
    let name = CFString::from_str(name);
    if unsafe { AXUIElementCopyAttributeValue(element, &name, &mut value) } != 0 {
        return None;
    }
    NonNull::new(value).map(|value| unsafe { CFRetained::from_raw(value) })
}

pub fn discover() -> Result<Vec<super::Target>> {
    let inventory = screenfling::agents::Inventory::read()
        .ok_or("Could not inspect local agent sessions. Copy image remains available.")?;
    let applications: Vec<_> = NSWorkspace::sharedWorkspace()
        .runningApplications()
        .iter()
        .filter_map(|app| {
            inventory
                .detect(app.processIdentifier() as u32)
                .map(|guard| (app, guard))
        })
        .collect();
    if applications.is_empty() {
        return Ok(Vec::new());
    }
    static PROMPTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    let prompt = CFString::from_str("AXTrustedCheckOptionPrompt");
    let options = CFDictionary::from_slices(
        &[&*prompt],
        &[CFBoolean::new(
            !PROMPTED.swap(true, std::sync::atomic::Ordering::Relaxed),
        )],
    );
    if !unsafe { AXIsProcessTrustedWithOptions((&*options as *const CFDictionary<_, _>).cast()) } {
        return Err("Automatic paste needs Accessibility access. Enable this copy of ScreenFling in System Settings > Privacy & Security > Accessibility, then refresh. Or use Copy image and Ctrl+V yourself.".into());
    }
    let mut targets = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(2);
    for (application, guard) in applications {
        if Instant::now() >= deadline {
            break;
        }
        let pid = application.processIdentifier();
        if pid <= 0 || pid == std::process::id() as i32 {
            continue;
        }
        let Some(raw) = NonNull::new(unsafe { AXUIElementCreateApplication(pid) }) else {
            continue;
        };
        let app = Rc::new(Element(unsafe { CFRetained::from_raw(raw) }));
        unsafe { AXUIElementSetMessagingTimeout(&*app.0, 0.2) };
        let Some(windows) =
            attribute(&app.0, "AXWindows").and_then(|v| v.downcast::<CFArray>().ok())
        else {
            continue;
        };
        // AXWindows is documented to contain AXUIElement (CFType) objects.
        let windows = unsafe { CFRetained::cast_unchecked::<CFArray<CFType>>(windows) };
        let name = application
            .localizedName()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "Application".into());
        for index in 0..windows.len().min(64) {
            if Instant::now() >= deadline {
                break;
            }
            let Some(window) = windows.get(index) else {
                continue;
            };
            unsafe { AXUIElementSetMessagingTimeout(&*window, 0.2) };
            let title = attribute(&window, "AXTitle")
                .and_then(|v| v.downcast::<CFString>().ok())
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Untitled window".into());
            targets.push(super::Target {
                application: format!("{} · {name}", guard.label),
                title,
                guard: guard.clone(),
                native: Target {
                    pid,
                    app: app.clone(),
                    window: Rc::new(Element(window)),
                },
            });
        }
    }
    Ok(targets)
}

pub fn activate(target: &Target) -> Result<()> {
    // The retained AX window is the identity, never an index or a matching title.
    let running = NSRunningApplication::runningApplicationWithProcessIdentifier(target.pid)
        .ok_or("The selected application closed. Refresh windows.")?;
    if unsafe { AXUIElementPerformAction(&*target.window.0, &CFString::from_str("AXRaise")) } != 0 {
        return Err("The selected window is unavailable. Refresh windows.".into());
    }
    #[allow(deprecated)]
    if !running.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps) {
        return Err("macOS could not activate the selected application.".into());
    }
    Ok(())
}

pub fn focused(target: &Target) -> bool {
    NSRunningApplication::runningApplicationWithProcessIdentifier(target.pid)
        .is_some_and(|app| app.isActive())
        && attribute(&target.app.0, "AXFocusedWindow")
            .is_some_and(|window| *window == *target.window.0)
}

pub fn paste(target: &Target) -> Result<()> {
    if !focused(target) {
        return Err("The selected window lost focus. Nothing was pasted.".into());
    }
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
    CGEvent::set_flags(Some(&down), CGEventFlags::MaskControl);
    CGEvent::set_flags(Some(&up), CGEventFlags::MaskControl);
    // Address events to the selected process instead of the global event stream.
    CGEvent::post_to_pid(target.pid, Some(&down));
    CGEvent::post_to_pid(target.pid, Some(&up));
    Ok(())
}
