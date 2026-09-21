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
    // Resolve legitimate platform aliases before checking every ancestor.
    let root = fs::canonicalize(root).map_err(|_| "The settings directory is unavailable.")?;
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
    let created = match builder.create(path) {
        Ok(()) => true,
        Err(error) if existing_ok && error.kind() == std::io::ErrorKind::AlreadyExists => false,
        Err(_) => return Err("Could not create a private local directory.".into()),
    };
    let result = private_dir(path);
    if result.is_err() && created {
        // Never remove an existing settings directory or recursively follow an unsafe path.
        let _ = fs::remove_dir(path);
    }
    result
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
    // A private leaf is not private if another user can rename an ancestor and replace it.
    // Reuse the endpoint policy, including the safe root-owned sticky /tmp exception.
    for parent in path.ancestors().skip(1) {
        stamp(parent, Kind::Parent).map_err(|_| {
            "A private directory's parent is writable by another user or cannot be verified."
        })?;
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
            stamp(&executable, Kind::Executable)
                .map_err(|error| format!("WezTerm executable: {error}"))?,
            stamp(&socket, Kind::Socket).map_err(|error| format!("WezTerm socket: {error}"))?,
        ];
        for (path, private) in [(&executable, false), (&socket, true)] {
            let mut first = true;
            for parent in path.ancestors().skip(1) {
                let kind = if private && first {
                    Kind::SocketParent
                } else {
                    Kind::Parent
                };
                let entry = stamp(parent, kind).map_err(|error| {
                    let item = if private { "socket" } else { "executable" };
                    format!("WezTerm {item} directory: {error}")
                })?;
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
        // macOS application directories can be writable by administrators.
        // This trusts the same privileged users as Windows, not other users.
        let administrator_install = cfg!(target_os = "macos")
            && matches!(kind, Kind::Executable | Kind::Parent)
            && matches!(metadata.gid(), 0 | 80);
        let unsafe_write = metadata.mode() & 0o002 != 0
            || (metadata.mode() & 0o020 != 0 && !administrator_install);
        if unsafe_write && !sticky_root {
            return Err(
                "A WezTerm path is writable by other users. Copy remains available.".into(),
            );
        }
        let mut values = vec![
            metadata.dev(),
            metadata.ino(),
            metadata.uid() as u64,
            metadata.gid() as u64,
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_endpoint_is_pinned_and_replacement_is_rejected() {
        use socket2::{Domain, SockAddr, Socket, Type};
        let directory = TemporaryDirectory::new().unwrap();
        let path = directory.0.join("s");
        // Test identity, not execution. A CI workspace need not be a trusted install directory.
        let executable = directory.0.join("terminal-fixture");
        fs::write(&executable, b"identity fixture").unwrap();
        let listener = Socket::new(Domain::UNIX, Type::STREAM, None).unwrap();
        listener.bind(&SockAddr::unix(&path).unwrap()).unwrap();
        listener.listen(1).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        }
        let connection =
            Connection::inspect(executable.to_str().unwrap(), path.to_str().unwrap()).unwrap();
        connection.unchanged().unwrap();
        let client = crate::relay::connect(&connection.socket).unwrap();
        drop(client);
        drop(listener);
        fs::remove_file(&path).unwrap();
        fs::write(&path, b"not a socket").unwrap();
        assert!(connection.unchanged().is_err());
        fs::remove_file(executable).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let parent = directory.0.join("shared");
            let child = parent.join("private");
            create_private_dir(&parent, false).unwrap();
            fs::set_permissions(&parent, fs::Permissions::from_mode(0o777)).unwrap();
            assert!(create_private_dir(&child, false).is_err());
            assert!(!child.exists(), "Failed creation must not leave a private directory");
            fs::set_permissions(&parent, fs::Permissions::from_mode(0o700)).unwrap();
            create_private_dir(&child, false).unwrap();
            fs::set_permissions(&parent, fs::Permissions::from_mode(0o777)).unwrap();
            assert!(private_dir(&child).is_err());
            fs::set_permissions(&parent, fs::Permissions::from_mode(0o700)).unwrap();
            fs::remove_dir(child).unwrap();
            fs::remove_dir(parent).unwrap();
        }
    }
}
