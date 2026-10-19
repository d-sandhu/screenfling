//! One running copy per user. A later launch asks the running copy to
//! capture, then exits, so any launcher, script or key can start a capture.
use crate::{app::Message, desktop};
use std::time::{Duration, Instant};

/// What a later launch asks the running copy to do.
const CAPTURE: &[u8] = b"capture\n";

pub enum Role {
    /// This process is the running copy; keep `Listener` alive.
    Primary(Listener),
    /// Another copy received the request.
    Forwarded,
}

#[cfg(unix)]
pub use unix::{Listener, claim};
#[cfg(windows)]
pub use windows::{Listener, claim};

#[cfg(unix)]
mod unix {
    use super::*;
    use std::{
        fs::{File, OpenOptions},
        io::{Read, Write},
        os::{
            fd::AsRawFd,
            unix::{
                fs::OpenOptionsExt,
                net::{UnixListener, UnixStream},
            },
        },
        path::PathBuf,
    };

    pub struct Listener {
        socket: Option<PathBuf>,
        /// Held for the life of the process: whoever holds it owns the socket.
        _lock: Option<File>,
    }
    impl Drop for Listener {
        fn drop(&mut self) {
            if let Some(socket) = &self.socket {
                let _ = std::fs::remove_file(socket);
            }
        }
    }

    /// A directory only this user can use.
    fn directory() -> Option<PathBuf> {
        if cfg!(target_os = "macos") {
            std::env::var_os("TMPDIR")
        } else {
            std::env::var_os("XDG_RUNTIME_DIR")
        }
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
    }

    fn forward(socket: &PathBuf) -> std::io::Result<Role> {
        UnixStream::connect(socket)?.write_all(CAPTURE)?;
        Ok(Role::Forwarded)
    }

    pub fn claim() -> Result<Role, String> {
        let Some(dir) = directory() else {
            // Without a private runtime directory, run without single-instance.
            return Ok(Role::Primary(Listener {
                socket: None,
                _lock: None,
            }));
        };
        let socket = dir.join("screenfling.sock");
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .mode(0o600)
            .open(dir.join("screenfling.lock"))
            .map_err(|_| "Could not open ScreenFling's lock file.")?;
        // The kernel lets exactly one process hold this lock and releases it
        // when that process exits, so the running copy is never ambiguous.
        // SAFETY: flock on a file descriptor this function owns.
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            // Another copy runs or is starting: give it a moment to listen.
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                if let Ok(role) = forward(&socket) {
                    return Ok(role);
                }
                if Instant::now() >= deadline {
                    return Err("ScreenFling is already running but did not answer.".into());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        // Holding the lock, any socket file here was left by a copy that exited.
        let _ = std::fs::remove_file(&socket);
        let listener =
            UnixListener::bind(&socket).map_err(|_| "Could not start ScreenFling's listener.")?;
        std::thread::Builder::new()
            .name("screenfling-instance".into())
            .spawn(move || {
                for mut stream in listener.incoming().flatten() {
                    let mut request = [0u8; 16];
                    let n = stream.read(&mut request).unwrap_or(0);
                    if &request[..n] == CAPTURE {
                        desktop::post(Message::Capture);
                    }
                }
            })
            .map_err(|_| "Could not start ScreenFling's listener.")?;
        Ok(Role::Primary(Listener {
            socket: Some(socket),
            _lock: Some(lock),
        }))
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use windows_sys::Win32::{
        Foundation::{
            CloseHandle, GENERIC_WRITE, GetLastError, HANDLE, HLOCAL, INVALID_HANDLE_VALUE,
            LocalFree,
        },
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
                SDDL_REVISION_1,
            },
            GetTokenInformation, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER, TokenUser,
        },
        Storage::FileSystem::{
            CreateFileW, FILE_FLAG_FIRST_PIPE_INSTANCE, OPEN_EXISTING, PIPE_ACCESS_INBOUND,
            ReadFile, WriteFile,
        },
        System::{
            Pipes::{
                ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe,
                GetNamedPipeServerProcessId, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS,
                PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT, WaitNamedPipeW,
            },
            RemoteDesktop::ProcessIdToSessionId,
            Threading::{
                GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
    };

    const ERROR_PIPE_BUSY: u32 = 231;
    const ERROR_NO_DATA: u32 = 232;
    const ERROR_PIPE_CONNECTED: u32 = 535;

    pub struct Listener;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain([0]).collect()
    }

    /// The account SID of a process, as text (S-1-5-21-…).
    fn user_of(process: HANDLE) -> Option<String> {
        unsafe {
            let mut token = std::ptr::null_mut();
            if OpenProcessToken(process, TOKEN_QUERY, &mut token) == 0 {
                return None;
            }
            // u64 storage keeps TOKEN_USER and the SID after it aligned.
            let mut buffer = vec![0u64; 64];
            let mut length = 0;
            let ok = GetTokenInformation(
                token,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                (buffer.len() * 8) as u32,
                &mut length,
            );
            CloseHandle(token);
            if ok == 0 {
                return None;
            }
            let user = &*(buffer.as_ptr() as *const TOKEN_USER);
            let mut text = std::ptr::null_mut();
            if ConvertSidToStringSidW(user.User.Sid, &mut text) == 0 {
                return None;
            }
            let length = (0..).take_while(|&i| *text.add(i) != 0).count();
            let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, length));
            LocalFree(text as HLOCAL);
            Some(sid)
        }
    }

    /// Pipe names are machine-wide, so the name carries the user and the
    /// login session: each session of each user has its own running copy.
    fn name(sid: &str) -> Vec<u16> {
        let mut session = 0;
        unsafe { ProcessIdToSessionId(std::process::id(), &mut session) };
        wide(&format!(r"\\.\pipe\screenfling-{sid}-{session}"))
    }

    fn pipe(name: &[u16], sid: &str) -> Option<HANDLE> {
        // Only this user may connect: a protected DACL granting just their SID.
        let sddl = wide(&format!("D:P(A;;GA;;;{sid})"));
        let mut descriptor = std::ptr::null_mut();
        let converted = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                std::ptr::null_mut(),
            )
        };
        if converted == 0 {
            return None;
        }
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        // FILE_FLAG_FIRST_PIPE_INSTANCE fails if the name exists: an atomic
        // test for a running copy, with no window between check and create.
        let handle = unsafe {
            CreateNamedPipeW(
                name.as_ptr(),
                PIPE_ACCESS_INBOUND | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                PIPE_UNLIMITED_INSTANCES,
                0,
                64,
                0,
                &attributes,
            )
        };
        unsafe { LocalFree(descriptor as HLOCAL) };
        (handle != INVALID_HANDLE_VALUE).then_some(handle)
    }

    fn forward(name: &[u16], sid: &str) -> Result<Role, String> {
        let open = || unsafe {
            CreateFileW(
                name.as_ptr(),
                GENERIC_WRITE,
                0,
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                std::ptr::null_mut(),
            )
        };
        let mut handle = open();
        // The running copy serves one launch at a time; wait for it briefly.
        let deadline = Instant::now() + Duration::from_secs(3);
        while handle == INVALID_HANDLE_VALUE && Instant::now() < deadline {
            if unsafe { GetLastError() } == ERROR_PIPE_BUSY {
                unsafe { WaitNamedPipeW(name.as_ptr(), 1000) };
            } else {
                std::thread::sleep(Duration::from_millis(50));
            }
            handle = open();
        }
        if handle == INVALID_HANDLE_VALUE {
            return Err("ScreenFling is already running but did not answer.".into());
        }
        // Trust the pipe only if this user's own process serves it.
        let mut server = 0;
        let owner = unsafe {
            if GetNamedPipeServerProcessId(handle, &mut server) == 0 {
                None
            } else {
                let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, server);
                let owner = (!process.is_null()).then(|| user_of(process)).flatten();
                if !process.is_null() {
                    CloseHandle(process);
                }
                owner
            }
        };
        if owner.as_deref() != Some(sid) {
            unsafe { CloseHandle(handle) };
            return Err("Another account's process holds ScreenFling's name.".into());
        }
        // This launch may bring a window forward (the user just started it);
        // pass that right on so the overlay can take keyboard focus.
        unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(server);
            let mut written = 0;
            WriteFile(
                handle,
                CAPTURE.as_ptr(),
                CAPTURE.len() as u32,
                &mut written,
                std::ptr::null_mut(),
            );
            CloseHandle(handle);
        }
        Ok(Role::Forwarded)
    }

    pub fn claim() -> Result<Role, String> {
        let sid = user_of(unsafe { GetCurrentProcess() })
            .ok_or("Could not identify the current user.")?;
        let name = name(&sid);
        let Some(handle) = pipe(&name, &sid) else {
            return forward(&name, &sid);
        };
        let handle = handle as usize;
        std::thread::Builder::new()
            .name("screenfling-instance".into())
            .spawn(move || {
                // One instance, reused after each client, so the name never
                // lapses and a launch can never become a second running copy.
                let handle = handle as HANDLE;
                loop {
                    let connected = unsafe { ConnectNamedPipe(handle, std::ptr::null_mut()) } != 0
                        || matches!(
                            unsafe { GetLastError() },
                            ERROR_PIPE_CONNECTED | ERROR_NO_DATA
                        );
                    if connected {
                        let mut request = [0u8; 16];
                        let mut read = 0;
                        unsafe {
                            ReadFile(
                                handle,
                                request.as_mut_ptr(),
                                request.len() as u32,
                                &mut read,
                                std::ptr::null_mut(),
                            )
                        };
                        if &request[..read as usize] == CAPTURE {
                            desktop::post(Message::Capture);
                        }
                    } else {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    unsafe { DisconnectNamedPipe(handle) };
                }
            })
            .map_err(|_| "Could not start ScreenFling's listener.")?;
        Ok(Role::Primary(Listener))
    }
}
