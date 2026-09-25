use super::*;
use windows_sys::Win32::{
    Foundation::{CloseHandle, FILETIME, HWND},
    System::Threading::{
        GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
    },
    UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
};

#[derive(Clone, Debug)]
pub struct Target {
    window: usize,
    pid: u32,
    started: u64,
}

fn process(pid: u32) -> Option<(String, u64)> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }
        let mut name = [0u16; 32768];
        let mut length = name.len() as u32;
        let mut created: FILETIME = std::mem::zeroed();
        let mut exited: FILETIME = std::mem::zeroed();
        let mut kernel: FILETIME = std::mem::zeroed();
        let mut user: FILETIME = std::mem::zeroed();
        let timing = GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user);
        let named = QueryFullProcessImageNameW(handle, 0, name.as_mut_ptr(), &mut length);
        CloseHandle(handle);
        if timing == 0 || named == 0 {
            return None;
        }
        let name = String::from_utf16_lossy(&name[..length as usize]);
        let label = std::path::Path::new(&name)
            .file_stem()?
            .to_string_lossy()
            .into_owned();
        Some((
            label,
            ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64,
        ))
    }
}

pub fn remember() -> Option<super::Target> {
    let window = unsafe { GetForegroundWindow() };
    if window.is_null() {
        return None;
    }
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(window, &mut pid) };
    if pid == std::process::id() {
        return None;
    }
    let (application, started) = process(pid)?;
    if !matches!(
        application.to_lowercase().as_str(),
        "windowsterminal"
            | "windowsterminalpreview"
            | "wezterm-gui"
            | "alacritty"
            | "conemu64"
            | "conemu"
            | "conhost"
            | "openconsole"
            | "powershell"
            | "pwsh"
            | "cmd"
            | "ghostty"
    ) {
        return None;
    }
    Some(super::Target {
        application,
        native: Target {
            window: window as usize,
            pid,
            started,
        },
    })
}
fn valid(target: &Target) -> bool {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(target.window as HWND, &mut pid) };
    pid == target.pid && process(pid).is_some_and(|(_, started)| started == target.started)
}
pub fn activate(target: &Target) -> Result<()> {
    if !valid(target) {
        return Err("Your terminal closed. The image is copied; paste it manually.".into());
    }
    unsafe {
        if IsIconic(target.window as HWND) != 0 {
            ShowWindow(target.window as HWND, SW_RESTORE);
        }
        if SetForegroundWindow(target.window as HWND) == 0 {
            return Err("Windows could not activate that window. Select it manually and paste the copied image.".into());
        }
    }
    Ok(())
}
pub fn focused(target: &Target) -> bool {
    valid(target) && unsafe { GetForegroundWindow() == target.window as HWND }
}
fn key(code: u16, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: code,
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}
pub fn paste(target: &Target) -> Result<()> {
    if !focused(target) {
        return Err("The selected window lost focus. Nothing was pasted.".into());
    }
    for modifier in [VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN] {
        if unsafe { GetAsyncKeyState(modifier as i32) } < 0 {
            return Err(
                "Release modifier keys before sending. The image is on your clipboard.".into(),
            );
        }
    }
    let inputs = [
        key(VK_CONTROL, false),
        key(0x56, false),
        key(0x56, true),
        key(VK_CONTROL, true),
    ];
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if sent != inputs.len() as u32 {
        // Release only our keys after a partial insertion; never repeat the paste.
        let release = [key(0x56, true), key(VK_CONTROL, true)];
        unsafe { SendInput(2, release.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
        return Err("Windows did not confirm the paste request. Check the destination before retrying; elevated windows may reject input.".into());
    }
    Ok(())
}
