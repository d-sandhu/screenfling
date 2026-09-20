//! Concrete filesystem checks for settings and the explicitly selected local terminal.
//! Connection evidence is immutable; it is never inferred from window titles or focus.
use screenfling::model::Result;
use std::{
    fs,
    path::{Path, PathBuf},
};
#[cfg(windows)]
#[path = "trusted_windows.rs"]
mod windows;

pub fn nonce() -> Result<String> {
    let mut bytes = [0u8; 12];
    getrandom::fill(&mut bytes)
        .map_err(|_| "The operating system random source is unavailable.")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

pub fn data_dir() -> Result<PathBuf> {
    #[cfg(windows)]
    let root = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or("LOCALAPPDATA is unavailable.")?;
    #[cfg(target_os = "macos")]
    let root = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("The home directory is unavailable.")?
        .join("Library/Application Support");
    #[cfg(target_os = "linux")]
    let root = match std::env::var_os("XDG_CONFIG_HOME") {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or("The home directory is unavailable.")?
            .join(".config"),
    };
    if !root.is_absolute() {
        return Err("The settings directory must be absolute.".into());
    }
    fs::create_dir_all(&root).map_err(|_| "Could not create the settings directory.")?;
    let path = root.join("screenfling");
    create_private_dir(&path, true)?;
    Ok(path)
}

pub fn create_private_dir(path: &Path, existing_ok: bool) -> Result<()> {
    let builder = fs::DirBuilder::new();
    #[cfg(unix)]
    let mut builder = builder;
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match builder.create(path) {
        Ok(()) => {}
        Err(error) if existing_ok && error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err("Could not create a private local directory.".into()),
    }
    private_dir(path)
}

pub fn private_dir(path: &Path) -> Result<()> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| "The private directory is unavailable.")?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("The private directory must not be a symbolic link.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o077 != 0 {
            return Err(
                "The local directory must be owned by you and accessible only to you (mode 700)."
                    .into(),
            );
        }
    }
    #[cfg(windows)]
    {
        windows::validate(path, true, false)?;
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stamp {
    path: PathBuf,
    identity: Vec<u64>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Connection {
    pub executable: PathBuf,
    pub socket: PathBuf,
    stamps: Vec<Stamp>,
}
impl Connection {
    pub fn inspect(executable: &str, socket: &str) -> Result<Self> {
        let executable = absolute(executable)?;
        let socket = absolute(socket)?;
        let executable = fs::canonicalize(executable)
            .map_err(|_| "The configured WezTerm executable is unavailable.")?;
        // Resolve parent aliases, but never resolve a socket symlink to another endpoint.
        let parent = fs::canonicalize(socket.parent().ok_or("The socket path has no parent.")?)
            .map_err(|_| "The configured WezTerm socket directory is unavailable.")?;
        let socket = parent.join(
            socket
                .file_name()
                .ok_or("The socket path has no filename.")?,
        );
        let mut stamps = vec![
            stamp(&executable, Kind::Executable)?,
            stamp(&socket, Kind::Socket)?,
        ];
        for (path, private) in [(&executable, false), (&socket, true)] {
            let mut first = true;
            for parent in path.ancestors().skip(1) {
                let kind = if private && first {
                    Kind::SocketParent
                } else {
                    Kind::Parent
                };
                let entry = stamp(parent, kind)?;
                if !stamps.iter().any(|s| s.path == entry.path) {
                    stamps.push(entry);
                }
                first = false;
            }
        }
        Ok(Self {
            executable,
            socket,
            stamps,
        })
    }
    pub fn unchanged(&self) -> Result<()> {
        let current = Self::inspect(
            self.executable
                .to_str()
                .ok_or("Unsupported executable path encoding.")?,
            self.socket
                .to_str()
                .ok_or("Unsupported socket path encoding.")?,
        )?;
        if &current != self {
            return Err("The selected WezTerm connection changed. Refresh and select the destination again.".into());
        }
        Ok(())
    }
}
fn absolute(value: &str) -> Result<PathBuf> {
    if value.is_empty() || value.len() > 4096 || value.chars().any(char::is_control) {
        return Err("Set the absolute WezTerm executable and socket paths in Settings.".into());
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(
            "WezTerm paths must be absolute. Relative paths are never used for routing.".into(),
        );
    }
    Ok(path)
}
#[derive(Clone, Copy)]
enum Kind {
    Executable,
    Socket,
    SocketParent,
    Parent,
}
fn stamp(path: &Path, kind: Kind) -> Result<Stamp> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| "A configured WezTerm path is unavailable.")?;
    if (matches!(kind, Kind::Executable) && !metadata.is_file())
        || (matches!(kind, Kind::Parent | Kind::SocketParent) && !metadata.is_dir())
    {
        return Err("A configured WezTerm path has an unexpected file type.".into());
    }
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::{FileTypeExt, MetadataExt};
        let uid = unsafe { libc::geteuid() };
        let is_parent = matches!(kind, Kind::Parent | Kind::SocketParent);
        let socket = matches!(kind, Kind::Socket);
        if metadata.file_type().is_symlink()
            || (socket && !metadata.file_type().is_socket())
            || (matches!(kind, Kind::Executable) && metadata.mode() & 0o111 == 0)
        {
            return Err("A WezTerm path has an unexpected file type or is not executable.".into());
        }
        if (socket || matches!(kind, Kind::SocketParent)) && metadata.uid() != uid {
            return Err(
                "The WezTerm socket and its immediate directory must be owned by you.".into(),
            );
        }
        if metadata.uid() != uid && metadata.uid() != 0 {
            return Err("A WezTerm path is owned by another user.".into());
        }
        // Root-owned sticky directories cannot remove a user's private child.
        let sticky_root =
            matches!(kind, Kind::Parent) && metadata.uid() == 0 && metadata.mode() & 0o1000 != 0;
        if metadata.mode() & 0o022 != 0 && !sticky_root {
            return Err(
                "A WezTerm path is writable by other users. Copy remains available.".into(),
            );
        }
        let mut values = vec![
            metadata.dev(),
            metadata.ino(),
            metadata.uid() as u64,
            metadata.mode() as u64,
        ];
        if !is_parent {
            values.extend([
                metadata.size(),
                metadata.mtime() as u64,
                metadata.mtime_nsec() as u64,
                metadata.ctime() as u64,
                metadata.ctime_nsec() as u64,
            ]);
        }
        values
    };
    #[cfg(windows)]
    let identity = windows::validate(
        path,
        matches!(kind, Kind::Socket | Kind::SocketParent),
        matches!(kind, Kind::Socket),
    )?;
    Ok(Stamp {
        path: path.to_owned(),
        identity,
    })
}

pub struct TemporaryDirectory(pub PathBuf);
impl TemporaryDirectory {
    pub fn new() -> Result<Self> {
        let root = fs::canonicalize(std::env::temp_dir())
            .map_err(|_| "The local temporary directory is unavailable.")?;
        let path = root.join(format!("sf-{}", nonce()?));
        create_private_dir(&path, false)?;
        Ok(Self(path))
    }
}
impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_file(self.0.join("s"));
        let _ = fs::remove_dir(&self.0);
    }
}
