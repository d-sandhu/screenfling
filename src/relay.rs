//! One-command, one-client local relay. Connect upstream before starting WezTerm
//! so a replaced socket path cannot redirect an authorized operation.
use crate::trusted::{self, Connection};
use screenfling::model::Result;
use socket2::{Domain, SockAddr, Socket, Type};
use std::{io::{self, Read, Write}, net::Shutdown, process::{Child, Command, Stdio}, sync::mpsc, thread, time::{Duration, Instant}};

const TIMEOUT: Duration = Duration::from_secs(8);
const MAX_OUTPUT: usize = 1024 * 1024;
const MAX_RELAY_BYTES: usize = 8 * 1024 * 1024;

pub fn connect(path: &std::path::Path) -> Result<Socket> {
    let socket = Socket::new(Domain::UNIX, Type::STREAM, None).map_err(|_| "Local AF_UNIX sockets are unavailable on this desktop.")?;
    let address = SockAddr::unix(path).map_err(|_| "The local socket path is too long or invalid.")?;
    socket.connect_timeout(&address, Duration::from_secs(2)).map_err(|_| "The selected local terminal is unavailable or did not accept a connection.")?;
    Ok(socket)
}

struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() { let _ = self.0.kill(); }
        let _ = self.0.wait();
    }
}

/// Gate every upstream write. Never retry, reroute, or restore the clipboard.
pub fn command(connection: &Connection, arguments: &[String], input: Vec<u8>, mut gate: impl FnMut() -> Result<()>) -> Result<Vec<u8>> {
    connection.unchanged()?;
    let mut upstream = connect(&connection.socket)?;
    connection.unchanged()?;
    upstream.set_nonblocking(true).map_err(io_error)?;
    let directory = trusted::TemporaryDirectory::new()?;
    let endpoint = directory.0.join("s");
    let listener = Socket::new(Domain::UNIX, Type::STREAM, None).map_err(io_error)?;
    listener.bind(&SockAddr::unix(&endpoint).map_err(io_error)?).map_err(io_error)?;
    #[cfg(unix)]
    { use std::os::unix::fs::PermissionsExt; std::fs::set_permissions(&endpoint, std::fs::Permissions::from_mode(0o600)).map_err(io_error)?; }
    listener.listen(1).map_err(io_error)?;
    listener.set_nonblocking(true).map_err(io_error)?;
    let mut process = Command::new(&connection.executable);
    process.args(["--skip-config", "cli", "--no-auto-start"]).args(arguments)
        .env("WEZTERM_UNIX_SOCKET", &endpoint).env_remove("WEZTERM_PANE")
        .env_remove("WEZTERM_CONFIG_FILE").env_remove("WEZTERM_CONFIG_DIR")
        .env_remove("LUA_PATH").env_remove("LUA_CPATH")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; process.creation_flags(0x0800_0000); }
    connection.unchanged()?;
    let mut child = ChildGuard(process.spawn().map_err(|_| "Could not start the configured WezTerm executable. Nothing was routed through ScreenFling.")?);
    let mut stdin = child.0.stdin.take().ok_or("The WezTerm input pipe is unavailable.")?;
    let stdout = child.0.stdout.take().ok_or("The WezTerm output pipe is unavailable.")?;
    let (input_sender, input_result) = mpsc::sync_channel(1);
    let writer = thread::Builder::new().name("screenfling-cli-input".into()).spawn(move || {
        let result = stdin.write_all(&input);
        drop(stdin);
        let _ = input_sender.send(result.is_ok());
    }).map_err(|_| "Could not start the bounded terminal input operation.")?;
    let (output_sender, output_result) = mpsc::sync_channel(1);
    let reader = thread::Builder::new().name("screenfling-cli-output".into()).spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout.take((MAX_OUTPUT + 1) as u64).read_to_end(&mut bytes);
        let result: Result<Vec<u8>> = if result.is_err() || bytes.len() > MAX_OUTPUT { Err("The terminal returned an invalid or excessive response.".into()) } else { Ok(bytes) };
        let _ = output_sender.send(result);
    }).map_err(|_| "Could not start the bounded terminal response operation.")?;
    let deadline = Instant::now() + TIMEOUT;
    let result = (|| {
        let mut client = None;
        let mut accepted = false;
        let mut sent = 0usize;
        let mut request = Pending::default();
        let mut response = Pending::default();
        let mut output = None;
        let mut input_ok = None;
        loop {
            if Instant::now() >= deadline { return Err("The terminal operation timed out. Its result is uncertain; inspect the selected pane before doing anything else. It will not be retried.".into()); }
            if client.is_none() && !accepted {
                match listener.accept() {
                    Ok((socket, _)) => {
                        socket.set_nonblocking(true).map_err(io_error)?;
                        gate()?;
                        client = Some(socket);
                        accepted = true;
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {},
                    Err(_) => return Err("The private terminal connection failed.".into()),
                }
            }
            let mut progress = false;
            if let Some(client) = client.as_mut() {
                progress |= request.pump(client, &mut upstream, &mut sent, &mut gate)?;
                let mut ignored = 0;
                progress |= response.pump(&mut upstream, client, &mut ignored, &mut || Ok(()))?;
            }
            if input_ok.is_none() { input_ok = input_result.try_recv().ok(); }
            if output.is_none() { if let Ok(value) = output_result.try_recv() { output = Some(value); } }
            if let Some(Err(error)) = output.as_ref() { return Err(error.clone()); }
            if let Some(status) = child.0.try_wait().map_err(io_error)? {
                if !status.success() || input_ok == Some(false) {
                    return Err(if sent == 0 { "WezTerm rejected the operation before ScreenFling forwarded a request. Check the executable and exact socket settings." } else { "WezTerm reported a failure after communication began. Delivery is uncertain. Inspect the exact selected pane; do not automatically retry." }.into());
                }
                if input_ok == Some(true) {
                    if let Some(output) = output.take() {
                        if !accepted || sent == 0 { return Err("WezTerm did not use the pinned connection. The operation is not verified.".into()); }
                        return output;
                    }
                }
            }
            if !progress { thread::sleep(Duration::from_millis(2)); }
        }
    })();
    drop(child);
    if writer.is_finished() { let _ = writer.join(); }
    if reader.is_finished() { let _ = reader.join(); }
    let _ = upstream.shutdown(Shutdown::Both);
    drop(listener);
    drop(directory);
    result
}

#[derive(Default)]
struct Pending { bytes: Vec<u8>, offset: usize, eof: bool, shutdown: bool, total: usize }
impl Pending {
    fn pump(&mut self, source: &mut Socket, destination: &mut Socket, sent: &mut usize, gate: &mut impl FnMut() -> Result<()>) -> Result<bool> {
        let mut progress = false;
        if self.offset == self.bytes.len() && !self.eof {
            self.bytes.clear(); self.offset = 0;
            let mut data = [0u8; 16384];
            match source.read(&mut data) {
                Ok(0) => self.eof = true,
                Ok(count) => {
                    self.total = self.total.checked_add(count).ok_or("Terminal response size overflow.")?;
                    if self.total > MAX_RELAY_BYTES { return Err("The terminal exceeded the bounded operation size.".into()); }
                    self.bytes.extend_from_slice(&data[..count]); progress = true;
                }
                Err(error) if matches!(error.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted) => {},
                Err(_) => return Err("The pinned terminal connection was interrupted. The result may be uncertain; do not retry automatically.".into()),
            }
        }
        if self.offset < self.bytes.len() {
            let count = guarded_write(destination, &self.bytes[self.offset..], gate)?;
            self.offset += count; *sent += count; progress |= count != 0;
        }
        if self.eof && self.offset == self.bytes.len() && !self.shutdown {
            let _ = destination.shutdown(Shutdown::Write); self.shutdown = true;
        }
        Ok(progress)
    }
}
fn guarded_write(destination: &mut impl Write, bytes: &[u8], gate: &mut impl FnMut() -> Result<()>) -> Result<usize> {
    gate()?;
    match destination.write(bytes) {
        Ok(0) => Err("The pinned terminal stopped accepting data. The result is uncertain.".into()),
        Ok(count) => Ok(count),
        Err(error) if matches!(error.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted) => Ok(0),
        Err(_) => Err("The pinned terminal write failed. The result is uncertain; do not retry automatically.".into()),
    }
}
fn io_error(_: impl std::fmt::Display) -> String { "The private local terminal transport is unavailable. No fallback destination was used.".into() }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replaced_clipboard_blocks_the_write() {
        let mut output = Vec::new();
        assert!(guarded_write(&mut output, b"stage", &mut || Err("replaced clipboard".into())).is_err());
        assert!(output.is_empty());
        assert_eq!(guarded_write(&mut output, b"stage", &mut || Ok(())).unwrap(), 5);
        assert_eq!(output, b"stage");
    }
}
