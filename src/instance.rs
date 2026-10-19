//! One running copy per user. A later launch asks the running copy to
//! capture, then exits, so any launcher, script or key can start a capture.
use crate::{app::Message, desktop};

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
        io::{ErrorKind, Read, Write},
        os::unix::net::{UnixListener, UnixStream},
        path::PathBuf,
    };

    pub struct Listener(PathBuf);
    impl Drop for Listener {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    /// The socket lives in a directory only this user can use.
    fn path() -> Option<PathBuf> {
        let dir = if cfg!(target_os = "macos") {
            std::env::var_os("TMPDIR")
        } else {
            std::env::var_os("XDG_RUNTIME_DIR")
        }
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)?;
        Some(dir.join("screenfling.sock"))
    }

    pub fn claim() -> Result<Role, String> {
        let Some(path) = path() else {
            // Without a private runtime directory, run without single-instance.
            return Ok(Role::Primary(Listener(PathBuf::new())));
        };
        if let Ok(mut stream) = UnixStream::connect(&path) {
            stream
                .write_all(CAPTURE)
                .map_err(|_| "Could not reach the running ScreenFling.")?;
            return Ok(Role::Forwarded);
        }
        // Nothing answers: any file left there belongs to an exited copy.
        let _ = std::fs::remove_file(&path);
        let listener = match UnixListener::bind(&path) {
            Ok(listener) => listener,
            // Another copy bound it first; it is the running one.
            Err(e) if e.kind() == ErrorKind::AddrInUse => {
                let mut stream = UnixStream::connect(&path)
                    .map_err(|_| "Could not reach the running ScreenFling.")?;
                let _ = stream.write_all(CAPTURE);
                return Ok(Role::Forwarded);
            }
            Err(_) => return Err("Could not start ScreenFling's launch listener.".into()),
        };
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
            .map_err(|_| "Could not start ScreenFling's launch listener.")?;
        Ok(Role::Primary(Listener(path)))
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GENERIC_WRITE, INVALID_HANDLE_VALUE},
        Storage::FileSystem::{
            CreateFileW, FILE_FLAG_FIRST_PIPE_INSTANCE, OPEN_EXISTING, PIPE_ACCESS_INBOUND,
            ReadFile, WriteFile,
        },
        System::Pipes::{
            ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, GetNamedPipeServerProcessId,
            PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
            PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
        },
    };

    pub struct Listener;

    /// Per user: the pipe's default security lets only its creator (and
    /// administrators) write to it, and remote clients are rejected.
    fn name() -> Vec<u16> {
        let user = std::env::var("USERNAME").unwrap_or_default();
        format!(r"\\.\pipe\screenfling-{user}")
            .encode_utf16()
            .chain([0])
            .collect()
    }

    fn pipe(name: &[u16], first: bool) -> Option<windows_sys::Win32::Foundation::HANDLE> {
        let flags = PIPE_ACCESS_INBOUND
            | if first {
                FILE_FLAG_FIRST_PIPE_INSTANCE
            } else {
                0
            };
        let handle = unsafe {
            CreateNamedPipeW(
                name.as_ptr(),
                flags,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                PIPE_UNLIMITED_INSTANCES,
                0,
                64,
                0,
                std::ptr::null(),
            )
        };
        (handle != INVALID_HANDLE_VALUE).then_some(handle)
    }

    fn forward(name: &[u16]) -> Result<Role, String> {
        let handle = unsafe {
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
        if handle == INVALID_HANDLE_VALUE {
            return Err("ScreenFling is already running but did not answer.".into());
        }
        // This launch holds the right to bring a window forward (it was just
        // started by the user); pass it on so the overlay can take focus.
        let mut server = 0;
        unsafe {
            if GetNamedPipeServerProcessId(handle, &mut server) != 0 {
                windows_sys::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(server);
            }
        }
        let mut written = 0;
        unsafe {
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
        let name = name();
        // FILE_FLAG_FIRST_PIPE_INSTANCE fails if the pipe exists: an atomic
        // test for a running copy, with no window between check and create.
        let Some(first) = pipe(&name, true) else {
            return forward(&name);
        };
        let first = first as usize;
        std::thread::Builder::new()
            .name("screenfling-instance".into())
            .spawn(move || {
                let mut handle = first as windows_sys::Win32::Foundation::HANDLE;
                loop {
                    let connected = unsafe { ConnectNamedPipe(handle, std::ptr::null_mut()) } != 0
                        || std::io::Error::last_os_error().raw_os_error() == Some(535); // ERROR_PIPE_CONNECTED
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
                    }
                    unsafe {
                        DisconnectNamedPipe(handle);
                        CloseHandle(handle);
                    }
                    match pipe(&name, false) {
                        Some(next) => handle = next,
                        None => return,
                    }
                }
            })
            .map_err(|_| "Could not start ScreenFling's launch listener.")?;
        Ok(Role::Primary(Listener))
    }
}
