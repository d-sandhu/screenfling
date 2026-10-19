use super::*;
use windows_sys::Win32::{
    Foundation::{CloseHandle, FILETIME, HWND, LPARAM},
    Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute},
    Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW},
    System::Threading::{
        GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
    },
    UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Target {
    window: usize,
    pid: u32,
    started: u64,
    /// A Windows Terminal tab: its position and name when listed.
    tab: Option<(usize, String)>,
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
    let size = unsafe { GetFileVersionInfoSizeW(path.as_ptr(), std::ptr::null_mut()) };
    if size == 0 {
        return None;
    }
    // u32 storage keeps the block, and the UTF-16 values inside it, aligned.
    let mut data = vec![0u32; (size as usize).div_ceil(4)];
    if unsafe { GetFileVersionInfoW(path.as_ptr(), 0, size, data.as_mut_ptr().cast()) } == 0 {
        return None;
    }
    // Translation is an array of (language, code page) u16 pairs; its length is
    // in bytes. String values report their length in UTF-16 units.
    let translation = query(&data, r"\VarFileInfo\Translation", 1)?;
    let [language, codepage] = [*translation.first()?, *translation.get(1)?];
    let key = format!(r"\StringFileInfo\{language:04x}{codepage:04x}\FileDescription");
    let text = String::from_utf16_lossy(query(&data, &key, 2)?);
    let text = text.trim_end_matches('\0').trim();
    (!text.is_empty() && text.chars().count() <= 40).then(|| text.to_owned())
}

/// A value inside a version-info block, as UTF-16 units. `unit` is the size
/// in bytes of one unit of the reported length.
fn query<'a>(data: &'a [u32], key: &str, unit: usize) -> Option<&'a [u16]> {
    let key: Vec<u16> = key.encode_utf16().chain([0]).collect();
    let mut value = std::ptr::null_mut();
    let mut length = 0u32;
    let found =
        unsafe { VerQueryValueW(data.as_ptr().cast(), key.as_ptr(), &mut value, &mut length) };
    let units = length as usize * unit / 2;
    let start = data.as_ptr() as usize;
    let end = start + std::mem::size_of_val(data);
    // VerQueryValueW points into `data`; check that before borrowing from it.
    let inside = (value as usize) >= start && (value as usize) + units * 2 <= end;
    (found != 0 && units > 0 && inside)
        .then(|| unsafe { std::slice::from_raw_parts(value.cast::<u16>(), units) })
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
/// Coding agents with windows of their own, by executable name.
const AGENT_APPS: &[&str] = &[
    "claude",
    "chatgpt",
    "codex",
    "cursor",
    "code",
    "code - insiders",
    "windsurf",
    "zed",
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

fn title(window: HWND) -> String {
    let mut text = [0u16; 256];
    let length = unsafe { GetWindowTextW(window, text.as_mut_ptr(), text.len() as i32) };
    String::from_utf16_lossy(&text[..length.max(0) as usize])
}

/// A window as a destination, and whether it hosts a coding agent. `None`
/// for the desktop, the taskbar and ScreenFling itself.
fn describe(window: HWND) -> Option<(super::Target, bool)> {
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
    let name = stem.to_lowercase();
    let terminal =
        TERMINAL_CLASSES.contains(&class.as_str()) || TERMINAL_APPS.contains(&name.as_str());
    let agent = terminal || AGENT_APPS.contains(&name.as_str());
    Some((
        super::Target {
            application: description(&path).unwrap_or(stem),
            title: title(window),
            modifier: if terminal {
                Modifier::Alt
            } else {
                Modifier::Control
            },
            native: Target {
                window: window as usize,
                pid,
                started,
                tab: None,
            },
        },
        agent,
    ))
}

pub fn remember() -> Option<super::Target> {
    describe(unsafe { GetForegroundWindow() }).map(|(target, _)| target)
}

/// Agent windows, front to back. Z-order is the desktop's own record of
/// which windows were used most recently.
pub fn agents() -> Vec<super::Target> {
    unsafe extern "system" fn collect(window: HWND, list: LPARAM) -> windows_sys::core::BOOL {
        // SAFETY: `list` is the Vec passed to EnumWindows below, alive for the call.
        unsafe { (*(list as *mut Vec<HWND>)).push(window) };
        1
    }
    let mut windows: Vec<HWND> = Vec::new();
    unsafe { EnumWindows(Some(collect), &mut windows as *mut Vec<HWND> as LPARAM) };
    windows
        .into_iter()
        .filter(|&window| switchable(window))
        .filter_map(describe)
        .filter_map(|(target, agent)| agent.then_some(target))
        .flat_map(with_tabs)
        .collect()
}

/// A Windows Terminal window with several tabs becomes one destination per
/// tab: the selected tab first, as the most recently used, then the rest.
fn with_tabs(window: super::Target) -> Vec<super::Target> {
    let tabs = if class(window.native.window as HWND) == "CASCADIA_HOSTING_WINDOW_CLASS" {
        tabs::list(window.native.window)
    } else {
        Vec::new()
    };
    if tabs.len() < 2 {
        return vec![window];
    }
    let mut targets: Vec<(bool, super::Target)> = tabs
        .into_iter()
        .enumerate()
        .map(|(index, (name, selected))| {
            let mut target = window.clone();
            target.title = name.clone();
            target.native.tab = Some((index, name));
            (selected, target)
        })
        .collect();
    targets.sort_by_key(|(selected, _)| !selected);
    targets.into_iter().map(|(_, target)| target).collect()
}

/// A window Alt+Tab would offer: visible, unowned, and not cloaked on another
/// virtual desktop or suspended.
fn switchable(window: HWND) -> bool {
    let mut cloaked = 0u32;
    unsafe {
        IsWindowVisible(window) != 0
            && GetWindow(window, GW_OWNER).is_null()
            && (DwmGetWindowAttribute(
                window,
                DWMWA_CLOAKED as u32,
                (&mut cloaked as *mut u32).cast(),
                4,
            ) != 0
                || cloaked == 0)
    }
}
fn valid(target: &Target) -> bool {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(target.window as HWND, &mut pid) };
    pid == target.pid && process(pid).is_some_and(|(_, started)| started == target.started)
}
pub fn authorize() -> Result<()> {
    Ok(())
}
pub fn activate(target: &Target) -> Result<()> {
    if !valid(target) {
        return Err("That window closed. The image is copied; paste it manually.".into());
    }
    if let Some((index, name)) = &target.tab
        && !tabs::select(target.window, *index, name)
    {
        return Err("That tab closed or moved. The image is copied; paste it manually.".into());
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
pub fn paste(modifier: Modifier) -> Result<()> {
    // A held key would combine with the chord or repeat into the target.
    // Virtual keys below 0x08 are mouse buttons.
    if (0x08..=0xFE).any(|key| unsafe { GetAsyncKeyState(key) } < 0) {
        return Err(
            "Release all keys before sending. The image is copied; paste it manually.".into(),
        );
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

/// Windows Terminal tabs through UI Automation, the interface screen readers
/// use. No terminal setting or plugin is involved.
mod tabs {
    use windows::Win32::{
        Foundation::HWND,
        System::Com::{
            CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
        },
        UI::Accessibility::{
            CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationSelectionItemPattern,
            TreeScope_Descendants, UIA_SelectionItemPatternId, UIA_TabItemControlTypeId,
        },
    };

    fn items(window: usize) -> Option<Vec<IUIAutomationElement>> {
        unsafe {
            // SDL may already have initialized COM on this thread; either way
            // the thread can create the in-process automation client.
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
            let root = automation.ElementFromHandle(HWND(window as *mut _)).ok()?;
            let all = root
                .FindAll(
                    TreeScope_Descendants,
                    &automation.CreateTrueCondition().ok()?,
                )
                .ok()?;
            let mut tabs = Vec::new();
            for index in 0..all.Length().ok()? {
                let element = all.GetElement(index).ok()?;
                if element.CurrentControlType().ok()? == UIA_TabItemControlTypeId {
                    tabs.push(element);
                }
            }
            Some(tabs)
        }
    }

    fn selection(tab: &IUIAutomationElement) -> Option<IUIAutomationSelectionItemPattern> {
        unsafe { tab.GetCurrentPatternAs(UIA_SelectionItemPatternId).ok() }
    }

    /// Each tab's name, in order, and whether it is the selected one.
    pub fn list(window: usize) -> Vec<(String, bool)> {
        items(window)
            .unwrap_or_default()
            .iter()
            .filter_map(|tab| {
                let name = unsafe { tab.CurrentName() }.ok()?.to_string();
                let selected = selection(tab)
                    .and_then(|pattern| unsafe { pattern.CurrentIsSelected() }.ok())
                    .is_some_and(|selected| selected.as_bool());
                Some((name, selected))
            })
            .collect()
    }

    /// Select the tab at `index`, only if it still has the listed name.
    pub fn select(window: usize, index: usize, name: &str) -> bool {
        let Some(tab) = items(window).and_then(|tabs| tabs.into_iter().nth(index)) else {
            return false;
        };
        unsafe { tab.CurrentName() }.is_ok_and(|current| current == name)
            && selection(&tab).is_some_and(|pattern| unsafe { pattern.Select() }.is_ok())
    }
}
