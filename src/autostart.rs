//! Start at login, stored where the desktop itself looks, so the setting is
//! the system's own entry rather than a copy that could drift from it.
use screenfling::model::Result;

pub fn enabled() -> bool {
    native::enabled()
}

pub fn set(on: bool) -> Result<()> {
    let program =
        std::env::current_exe().map_err(|_| "Could not find ScreenFling's own location.")?;
    native::set(on, &program)
}

#[cfg(windows)]
mod native {
    use super::*;
    use std::{os::windows::ffi::OsStrExt, path::Path};
    use windows_sys::Win32::{
        Foundation::ERROR_SUCCESS,
        System::Registry::{
            HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_SZ, RegCloseKey,
            RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
        },
    };

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const NAME: &str = "ScreenFling";

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain([0]).collect()
    }

    fn open(access: u32) -> Option<HKEY> {
        let mut key = std::ptr::null_mut();
        let status =
            unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, wide(RUN).as_ptr(), 0, access, &mut key) };
        (status == ERROR_SUCCESS).then_some(key)
    }

    pub fn enabled() -> bool {
        let Some(key) = open(KEY_QUERY_VALUE) else {
            return false;
        };
        let status = unsafe {
            RegQueryValueExW(
                key,
                wide(NAME).as_ptr(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        unsafe { RegCloseKey(key) };
        status == ERROR_SUCCESS
    }

    pub fn set(on: bool, program: &Path) -> Result<()> {
        let key = open(KEY_SET_VALUE).ok_or("Could not open the Windows startup list.")?;
        let status = if on {
            // Quoted, so a path with spaces stays one program.
            let command: Vec<u16> = std::ffi::OsStr::new("\"")
                .encode_wide()
                .chain(program.as_os_str().encode_wide())
                .chain("\"".encode_utf16())
                .chain([0])
                .collect();
            unsafe {
                RegSetValueExW(
                    key,
                    wide(NAME).as_ptr(),
                    0,
                    REG_SZ,
                    command.as_ptr().cast(),
                    (command.len() * 2) as u32,
                )
            }
        } else {
            match unsafe { RegDeleteValueW(key, wide(NAME).as_ptr()) } {
                2 => ERROR_SUCCESS, // ERROR_FILE_NOT_FOUND: already off
                status => status,
            }
        };
        unsafe { RegCloseKey(key) };
        (status == ERROR_SUCCESS)
            .then_some(())
            .ok_or_else(|| "Could not change the Windows startup list.".into())
    }
}

#[cfg(unix)]
mod native {
    use super::*;
    use std::path::{Path, PathBuf};

    /// macOS LaunchAgent, or an XDG autostart entry on Linux desktops.
    fn entry() -> Option<PathBuf> {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        if cfg!(target_os = "macos") {
            Some(home?.join("Library/LaunchAgents/dev.screenfling.ScreenFling.plist"))
        } else {
            let config = std::env::var_os("XDG_CONFIG_HOME")
                .filter(|p| !p.is_empty())
                .map(PathBuf::from)
                .or_else(|| home.map(|h| h.join(".config")))?;
            Some(config.join("autostart/screenfling.desktop"))
        }
    }

    pub fn enabled() -> bool {
        entry().is_some_and(|path| path.is_file())
    }

    pub fn set(on: bool, program: &Path) -> Result<()> {
        let path = entry().ok_or("Your home directory is unavailable.")?;
        if !on {
            return match std::fs::remove_file(&path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                    Err("Could not remove the login item.".into())
                }
                _ => Ok(()),
            };
        }
        let program = program
            .to_str()
            .ok_or("ScreenFling's path is not valid text.")?;
        let contents = if cfg!(target_os = "macos") {
            launch_agent(program)
        } else {
            desktop_entry(program)
        };
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|_| "Could not create the login items folder.")?;
        }
        std::fs::write(&path, contents).map_err(|_| "Could not save the login item.".into())
    }

    fn launch_agent(program: &str) -> String {
        let escaped = program
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>dev.screenfling.ScreenFling</string>
    <key>ProgramArguments</key>
    <array>
        <string>{escaped}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
"#
        )
    }

    /// Desktop Entry `Exec`: the program as one quoted argument. The spec
    /// escapes `"`, backtick, `$` and backslash with a backslash inside quotes,
    /// and then applies string escaping, which doubles every backslash.
    /// `%` is doubled because it starts field codes.
    pub(super) fn desktop_entry(program: &str) -> String {
        let mut quoted = String::from('"');
        for c in program.chars() {
            match c {
                // Quoting gives `\c`; string escaping then doubles the backslash.
                '"' | '`' | '$' => {
                    quoted.push_str(r"\\");
                    quoted.push(c);
                }
                // Quoting gives `\\`; string escaping doubles both.
                '\\' => quoted.push_str(r"\\\\"),
                '%' => quoted.push_str("%%"),
                _ => quoted.push(c),
            }
        }
        quoted.push('"');
        format!(
            "[Desktop Entry]\nType=Application\nName=ScreenFling\nExec={quoted}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"
        )
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn exec_quotes_reserved_characters() {
            let entry = super::desktop_entry("/opt/My $App/screen\"fling%");
            assert!(entry.contains(r#"Exec="/opt/My \\$App/screen\\"fling%%""#));
            let backslash = super::desktop_entry(r"/opt/a\b");
            assert!(backslash.contains(r#"Exec="/opt/a\\\\b""#));
        }
    }
}

#[cfg(test)]
mod tests {
    /// Changes the real login items, so it runs only when asked for:
    /// `cargo test -- --ignored login_item`. It restores the prior state.
    #[test]
    #[ignore]
    fn login_item_round_trip() {
        let before = super::enabled();
        super::set(true).unwrap();
        assert!(super::enabled());
        super::set(false).unwrap();
        assert!(!super::enabled());
        // Turning it off twice is not an error.
        super::set(false).unwrap();
        super::set(before).unwrap();
        assert_eq!(super::enabled(), before);
    }
}
