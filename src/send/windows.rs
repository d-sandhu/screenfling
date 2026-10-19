use super::*;
use windows_sys::Win32::{
    Foundation::{CloseHandle, FILETIME, HWND},
    Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW},
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

/// Executable path (NUL-terminated UTF-16) and start time. The start time
/// distinguishes a live process from a later one that reuses its id.
fn process(pid: u32) -> Option<(Vec<u16>, u64)> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }
        let mut path = vec![0u16; 32768];
        let mut length = path.len() as u32;
        let mut created: FILETIME = std::mem::zeroed();
        let mut exited: FILETIME = std::mem::zeroed();
        let mut kernel: FILETIME = std::mem::zeroed();
        let mut user: FILETIME = std::mem::zeroed();
        let timing = GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user);
        let named = QueryFullProcessImageNameW(handle, 0, path.as_mut_ptr(), &mut length);
        CloseHandle(handle);
        if timing == 0 || named == 0 {
            return None;
        }
        path.truncate(length as usize + 1);
        Some((
            path,
            ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64,
        ))
    }
}

fn stem(path: &[u16]) -> String {
    let path = String::from_utf16_lossy(&path[..path.len() - 1]);
    std::path::Path::new(&path)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The executable's FileDescription, the name Task Manager shows.
fn description(path: &[u16]) -> Option<String> {
    let query = |data: &[u8], key: &str| -> Option<&[u16]> {
        let key: Vec<u16> = key.encode_utf16().chain([0]).collect();
        let mut value = std::ptr::null_mut();
        let mut length = 0u32;
        // The returned pointer lies inside `data`, so it lives as long as it.
        let found =
            unsafe { VerQueryValueW(data.as_ptr().cast(), key.as_ptr(), &mut value, &mut length) };
        (found != 0 && !value.is_null() && length > 0)
            .then(|| unsafe { std::slice::from_raw_parts(value.cast::<u16>(), length as usize) })
    };
    let size = unsafe { GetFileVersionInfoSizeW(path.as_ptr(), std::ptr::null_mut()) };
    if size == 0 {
        return None;
    }
    let mut data = vec![0u8; size as usize];
    if unsafe { GetFileVersionInfoW(path.as_ptr(), 0, size, data.as_mut_ptr().cast()) } == 0 {
        return None;
    }
    let translation = query(&data, r"\VarFileInfo\Translation")?;
    let [language, codepage] = [*translation.first()?, *translation.get(1)?];
    let text = query(
        &data,
        &format!(r"\StringFileInfo\{language:04x}{codepage:04x}\FileDescription"),
    )?;
    let text = String::from_utf16_lossy(text);
    let text = text.trim_end_matches('\0').trim();
    (!text.is_empty() && text.chars().count() <= 40).then(|| text.to_owned())
}

/// Terminal windows bind Ctrl+V to text paste and never forward it, so console
/// programs such as Claude Code and Codex bind image paste to Alt+V. A window's
/// class identifies the built-in hosts; a process name could also own GUI windows.
const TERMINAL_CLASSES: &[&str] = &["ConsoleWindowClass", "CASCADIA_HOSTING_WINDOW_CLASS"];
/// Third-party terminal applications, by executable name.
const TERMINAL_APPS: &[&str] = &[
    "wezterm-gui",
    "alacritty",
    "mintty",
    "conemu64",
    "conemu",
    "tabby",
    "hyper",
    "warp",
];
/// The desktop and taskbar are not paste destinations.
const SHELL: &[&str] = &[
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
];

fn class(window: HWND) -> String {
    let mut name = [0u16; 64];
    let length = unsafe { GetClassNameW(window, name.as_mut_ptr(), name.len() as i32) };
    String::from_utf16_lossy(&name[..length.max(0) as usize])
}

pub fn remember() -> Option<super::Target> {
    let window = unsafe { GetForegroundWindow() };
    let class = class(window);
    if window.is_null() || SHELL.contains(&class.as_str()) {
        return None;
    }
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(window, &mut pid) };
    if pid == 0 || pid == std::process::id() {
        return None;
    }
    let (path, started) = process(pid)?;
    let stem = stem(&path);
    let terminal = TERMINAL_CLASSES.contains(&class.as_str())
        || TERMINAL_APPS.contains(&stem.to_lowercase().as_str());
    Some(super::Target {
        application: description(&path).unwrap_or(stem),
        modifier: if terminal {
            Modifier::Alt
        } else {
            Modifier::Control
        },
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
        return Err("That window closed. The image is copied; paste it manually.".into());
    }
    unsafe {
        if IsIconic(target.window as HWND) != 0 {
            ShowWindow(target.window as HWND, SW_RESTORE);
        }
        if SetForegroundWindow(target.window as HWND) == 0 {
            return Err(
                "Windows could not return to that window. The image is copied; paste it manually."
                    .into(),
            );
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
pub fn paste(target: &Target, modifier: Modifier) -> Result<()> {
    if !focused(target) {
        return Err("The selected window lost focus. Nothing was pasted.".into());
    }
    for modifier in [VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN] {
        if unsafe { GetAsyncKeyState(modifier as i32) } < 0 {
            return Err(
                "Release modifier keys before sending. The image is copied; paste it manually."
                    .into(),
            );
        }
    }
    let held = match modifier {
        Modifier::Alt => VK_MENU,
        _ => VK_CONTROL,
    };
    let inputs = [
        key(held, false),
        key(VK_V, false),
        key(VK_V, true),
        key(held, true),
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
        let release = [key(VK_V, true), key(held, true)];
        unsafe { SendInput(2, release.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
        return Err("Windows did not confirm the paste request. Check the destination before retrying; elevated windows may reject input.".into());
    }
    Ok(())
}
