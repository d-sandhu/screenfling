use super::*;
use x11rb::{
    connection::Connection,
    protocol::{xproto::*, xtest::ConnectionExt as _},
    rust_connection::RustConnection,
};

#[derive(Clone, Debug)]
pub struct Target {
    window: u32,
    pid: u32,
}
fn connection() -> Result<(RustConnection, usize)> {
    if screenfling::capture::is_wayland() {
        return Err("This Wayland desktop does not expose a portable window picker. Copy the image or file path and paste it into your session.".into());
    }
    x11rb::connect(None).map_err(|_| "Could not connect to the X11 desktop.".into())
}
fn atom(conn: &RustConnection, name: &[u8]) -> Result<u32> {
    conn.intern_atom(false, name)
        .map_err(|_| "Could not query the desktop.")?
        .reply()
        .map(|r| r.atom)
        .map_err(|_| "Could not query the desktop.".into())
}
fn values(conn: &RustConnection, window: u32, name: &[u8]) -> Result<Vec<u32>> {
    let property = atom(conn, name)?;
    let reply = conn
        .get_property(false, window, property, AtomEnum::ANY, 0, 4096)
        .map_err(|_| "The window is unavailable.")?
        .reply()
        .map_err(|_| "The window is unavailable.")?;
    Ok(reply.value32().map(|v| v.collect()).unwrap_or_default())
}
fn label(conn: &RustConnection, window: u32, name: &[u8]) -> String {
    atom(conn, name)
        .ok()
        .and_then(|a| {
            conn.get_property(false, window, a, AtomEnum::ANY, 0, 1024)
                .ok()?
                .reply()
                .ok()
        })
        .map(|r| {
            String::from_utf8_lossy(&r.value)
                .trim_matches('\0')
                .replace('\0', " · ")
        })
        .unwrap_or_default()
}
pub fn discover() -> Result<Vec<super::Target>> {
    let (conn, screen) = connection()?;
    let root = conn.setup().roots[screen].root;
    let mut targets = Vec::new();
    for window in values(&conn, root, b"_NET_CLIENT_LIST_STACKING")?
        .into_iter()
        .rev()
    {
        let pid = values(&conn, window, b"_NET_WM_PID")?
            .first()
            .copied()
            .unwrap_or(0);
        if pid == 0 || pid == std::process::id() {
            continue;
        }
        let title = label(&conn, window, b"_NET_WM_NAME");
        let title = if title.is_empty() {
            label(&conn, window, b"WM_NAME")
        } else {
            title
        };
        if title.is_empty() {
            continue;
        }
        targets.push(super::Target {
            application: label(&conn, window, b"WM_CLASS"),
            title,
            native: Target { window, pid },
        });
    }
    Ok(targets)
}
fn valid(conn: &RustConnection, target: &Target) -> bool {
    values(conn, target.window, b"_NET_WM_PID").is_ok_and(|v| v.first() == Some(&target.pid))
}
pub fn activate(target: &Target) -> Result<()> {
    let (conn, screen) = connection()?;
    if !valid(&conn, target) {
        return Err("The selected window closed. Refresh windows.".into());
    }
    let event = ClientMessageEvent::new(
        32,
        target.window,
        atom(&conn, b"_NET_ACTIVE_WINDOW")?,
        [2, x11rb::CURRENT_TIME, 0, 0, 0],
    );
    conn.send_event(
        false,
        conn.setup().roots[screen].root,
        EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
        event,
    )
    .map_err(|_| "Could not activate the selected window.")?
    .check()
    .map_err(|_| "Could not activate the selected window.")?;
    conn.flush()
        .map_err(|_| "Could not contact the desktop.".into())
}
pub fn focused(target: &Target) -> bool {
    connection().is_ok_and(|(conn, screen)| {
        valid(&conn, target)
            && values(
                &conn,
                conn.setup().roots[screen].root,
                b"_NET_ACTIVE_WINDOW",
            )
            .is_ok_and(|v| v.first() == Some(&target.window))
    })
}
pub fn paste(target: &Target) -> Result<()> {
    let (conn, _) = connection()?;
    if !focused(target) {
        return Err("The selected window lost focus. Nothing was pasted.".into());
    }
    conn.xtest_get_version(2, 2)
        .map_err(|_| "This desktop does not allow a paste request.")?
        .reply()
        .map_err(|_| "This desktop does not allow a paste request.")?;
    let setup = conn.setup();
    let count = setup.max_keycode - setup.min_keycode + 1;
    let map = conn
        .get_keyboard_mapping(setup.min_keycode, count)
        .map_err(|_| "Keyboard mapping unavailable.")?
        .reply()
        .map_err(|_| "Keyboard mapping unavailable.")?;
    if map.keysyms_per_keycode == 0 {
        return Err("Keyboard mapping unavailable.".into());
    }
    let code = |symbol| {
        map.keysyms
            .chunks(map.keysyms_per_keycode as usize)
            .position(|symbols| symbols.first() == Some(&symbol))
            .map(|i| setup.min_keycode + i as u8)
            .ok_or_else(|| "The desktop's paste shortcut could not be mapped.".to_string())
    };
    let control = code(0xffe3)?;
    let shift = code(0xffe1)?;
    let v = code(0x76)?;
    let held = conn
        .query_keymap()
        .map_err(|_| "Could not inspect keyboard state.")?
        .reply()
        .map_err(|_| "Could not inspect keyboard state.")?;
    if held.keys.iter().any(|byte| *byte != 0) {
        return Err("Release held keys before sending. The path is on your clipboard.".into());
    }
    for (key, down) in [
        (control, true),
        (shift, true),
        (v, true),
        (v, false),
        (shift, false),
        (control, false),
    ] {
        let sent = conn
            .xtest_fake_input(
                if down {
                    KEY_PRESS_EVENT
                } else {
                    KEY_RELEASE_EVENT
                },
                key,
                x11rb::CURRENT_TIME,
                x11rb::NONE,
                0,
                0,
                0,
            )
            .ok()
            .is_some_and(|cookie| cookie.check().is_ok());
        if !sent {
            // Release only; never repeat a possibly delivered paste chord.
            for key in [v, shift, control] {
                if let Ok(cookie) = conn.xtest_fake_input(
                    KEY_RELEASE_EVENT,
                    key,
                    x11rb::CURRENT_TIME,
                    x11rb::NONE,
                    0,
                    0,
                    0,
                ) {
                    let _ = cookie.check();
                }
            }
            let _ = conn.flush();
            return Err(
                "The paste request was interrupted. Inspect the destination before retrying."
                    .into(),
            );
        }
    }
    conn.flush()
        .map_err(|_| "The paste request was not confirmed. Inspect the destination.".into())
}
