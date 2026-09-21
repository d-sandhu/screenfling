//! Driven only by scripts/check-wezterm.py against its private synthetic mux.
#![cfg(not(test))]

#[cfg(target_os = "linux")]
#[path = "../src/relay.rs"]
mod relay;
#[cfg(target_os = "linux")]
#[path = "../src/trusted.rs"]
mod trusted;
#[cfg(target_os = "linux")]
#[path = "../src/wezterm.rs"]
mod wezterm;

fn main() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        check()
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err("Run the isolated WezTerm check on Linux.".into())
    }
}

#[cfg(target_os = "linux")]
fn check() -> Result<(), String> {
    use std::{fs, path::PathBuf, process::Command, thread, time::Duration};
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 3 || args[0] != "--isolated-fixture" {
        return Err("Use scripts/check-wezterm.py; never point this check at a real session.".into());
    }
    let root = PathBuf::from(&args[1]);
    trusted::private_dir(&root)?;
    if fs::read_to_string(root.join("fixture-ready"))
        .ok()
        .as_deref()
        != Some("native-wezterm-fixture-v1")
    {
        return Err("The isolated fixture is unavailable.".into());
    }
    let records = fs::read(root.join("panes.json")).map_err(|e| e.to_string())?;
    let ids: Vec<u32> = serde_json::from_slice(&records).map_err(|e| e.to_string())?;
    if ids.len() != 2 || ids[0] == ids[1] {
        return Err("The fixture must contain two distinct panes.".into());
    }
    let settings = wezterm::ConnectionSettings {
        executable: args[2].clone(),
        socket: root.join("mux.sock").to_string_lossy().into_owned(),
        paste_confirmed: true,
    };
    let destinations = wezterm::discover(&settings)?;
    let target = destinations
        .iter()
        .find(|pane| pane.pane_id == ids[0])
        .ok_or("Target missing")?;
    assert!(target.belongs_to(&settings));
    assert!(!target.title.is_empty() && !target.workspace.is_empty());
    let other = destinations
        .iter()
        .find(|pane| pane.pane_id == ids[1])
        .ok_or("Decoy missing")?;
    assert_eq!(target.window_id, other.window_id);
    assert_eq!(target.title, other.title); // Duplicate labels cannot route input.
    let read = |name| fs::read(root.join(name)).map_err(|e| e.to_string());
    assert!(wezterm::stage(target, "blocked", || false).is_err());
    assert!(wezterm::stage(target, "\n", || true).is_err());
    assert!(read("first.bytes")?.is_empty() && read("second.bytes")?.is_empty());
    let result = wezterm::stage(target, "screenfling-stage-check", || true)?;
    assert!(result.contains("UNVERIFIED"));
    let expected = screenfling::model::stage_input("screenfling-stage-check")?;
    for _ in 0..100 {
        if read("first.bytes")? == expected {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(read("first.bytes")?, expected);
    assert!(read("second.bytes")?.is_empty());
    let cli = |arguments: &[String]| {
        Command::new(&settings.executable)
            .args(["--skip-config", "cli", "--no-auto-start"])
            .args(arguments)
            .env("WEZTERM_UNIX_SOCKET", &settings.socket)
            .output()
            .map_err(|e| e.to_string())
    };
    let active = || -> Result<u32, String> {
        let output = cli(&["list".into(), "--format".into(), "json".into()])?;
        assert!(output.status.success());
        let panes: Vec<serde_json::Value> =
            serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
        let pane = panes
            .iter()
            .find(|pane| pane["is_active"].as_bool() == Some(true))
            .ok_or("Active pane missing")?;
        u32::try_from(pane["pane_id"].as_u64().ok_or("Invalid active pane")?)
            .map_err(|e| e.to_string())
    };
    assert_eq!(active()?, ids[1]); // Stage itself must not reveal.
    wezterm::reveal(target)?;
    assert_eq!(active()?, ids[0]);
    let killed = cli(&["kill-pane".into(), "--pane-id".into(), ids[0].to_string()])?;
    assert!(killed.status.success());
    assert!(wezterm::stage(target, "closed", || true).is_err());
    thread::sleep(Duration::from_millis(100));
    assert_eq!(read("first.bytes")?, expected);
    assert!(read("second.bytes")?.is_empty());
    println!(
        "Real WezTerm: duplicate labels, exact Stage bytes, no Enter, no focus fallback, clipboard rejection, separate Reveal, and closed-pane rejection passed. Agent attachment was not tested."
    );
    Ok(())
}
