//! Exact pane dispatch through an explicitly selected, pinned local WezTerm mux.
use crate::{relay, trusted::Connection};
use screenfling::model::{Result, stage_input};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::PathBuf};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ConnectionSettings {
    pub executable: String,
    pub socket: String,
    pub paste_confirmed: bool,
}
impl Default for ConnectionSettings {
    fn default() -> Self {
        let filename = if cfg!(windows) {
            "wezterm.exe"
        } else {
            "wezterm"
        };
        let executable = std::env::var_os("PATH")
            .and_then(|paths| {
                std::env::split_paths(&paths)
                    .map(|path| path.join(filename))
                    .find(|path| path.is_absolute() && path.is_file())
            })
            .or_else(|| {
                let path = PathBuf::from("/Applications/WezTerm.app/Contents/MacOS/wezterm");
                if cfg!(target_os = "macos") && path.is_file() {
                    Some(path)
                } else {
                    None
                }
            })
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default();
        Self {
            executable,
            socket: std::env::var("WEZTERM_UNIX_SOCKET").unwrap_or_default(),
            paste_confirmed: false,
        }
    }
}
#[derive(Clone, Debug)]
pub struct Destination {
    pub title: String,
    pub workspace: String,
    pub pane_id: u32,
    pub window_id: u32,
    tab_id: u32,
    settings: ConnectionSettings,
    connection: Connection,
}
impl Destination {
    pub fn belongs_to(&self, settings: &ConnectionSettings) -> bool {
        &self.settings == settings
    }
}
#[derive(Deserialize)]
struct Pane {
    pane_id: u32,
    window_id: u32,
    tab_id: u32,
    title: String,
    workspace: String,
}
fn parse(bytes: &[u8]) -> Result<Vec<Pane>> {
    if bytes.len() > 1024 * 1024 {
        return Err("The terminal returned too many destination records.".into());
    }
    let panes: Vec<Pane> = serde_json::from_slice(bytes)
        .map_err(|_| "WezTerm returned invalid pane identifiers. No destinations were accepted.")?;
    if panes.len() > 4096 {
        return Err("The terminal returned too many panes.".into());
    }
    let mut ids = HashSet::new();
    if panes.iter().any(|pane| {
        !ids.insert(pane.pane_id)
            || pane.workspace.is_empty()
            || pane.workspace.len() > 4096
            || pane.title.len() > 16384
    }) {
        return Err("WezTerm returned duplicate or invalid destination records.".into());
    }
    Ok(panes)
}
fn label(value: &str) -> String {
    value
        .chars()
        .filter(|c| {
            !c.is_control() && !matches!(*c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
        .take(140)
        .collect()
}
fn list(connection: &Connection) -> Result<Vec<Pane>> {
    let bytes = relay::command(
        connection,
        &["list".into(), "--format".into(), "json".into()],
        Vec::new(),
        || connection.unchanged(),
    )?;
    parse(&bytes)
}
pub fn discover(settings: &ConnectionSettings) -> Result<Vec<Destination>> {
    let connection = Connection::inspect(&settings.executable, &settings.socket)?;
    let panes = list(&connection)?;
    connection.unchanged()?;
    Ok(panes
        .into_iter()
        .map(|pane| Destination {
            title: label(&pane.title),
            workspace: label(&pane.workspace),
            pane_id: pane.pane_id,
            window_id: pane.window_id,
            tab_id: pane.tab_id,
            settings: settings.clone(),
            connection: connection.clone(),
        })
        .collect())
}
fn validate(destination: &Destination) -> Result<()> {
    destination.connection.unchanged()?;
    let panes = list(&destination.connection)?;
    let present = panes.iter().any(|pane| {
        same_route(
            destination.pane_id,
            destination.window_id,
            destination.tab_id,
            pane,
        )
    });
    if !present {
        return Err("The selected pane closed or moved. Nothing was redirected; capture again and select a current destination.".into());
    }
    Ok(())
}
fn same_route(pane_id: u32, window_id: u32, tab_id: u32, candidate: &Pane) -> bool {
    candidate.pane_id == pane_id && candidate.window_id == window_id && candidate.tab_id == tab_id
}
fn stage_args(pane_id: u32) -> Vec<String> {
    vec![
        "send-text".into(),
        "--no-paste".into(),
        "--pane-id".into(),
        pane_id.to_string(),
    ]
}

pub fn stage(
    destination: &Destination,
    note: &str,
    mut clipboard_matches: impl FnMut() -> bool,
) -> Result<String> {
    let input = stage_input(note)?;
    if !destination.settings.paste_confirmed {
        return Err("The image-paste binding was not confirmed. Nothing was staged.".into());
    }
    validate(destination)?;
    relay::command(
        &destination.connection,
        &stage_args(destination.pane_id),
        input,
        || {
            destination.connection.unchanged()?;
            if !clipboard_matches() {
                return Err("The clipboard no longer matches the reviewed crop, or its check failed. Stage stopped; it will not restore or retry the image. Inspect the exact selected pane before proceeding.".into());
            }
            Ok(())
        },
    )?;
    Ok("Stage request written to the exact selected pane, without Enter. Image attachment is UNVERIFIED. Reveal the destination to inspect it. This operation will not be retried.".into())
}
pub fn reveal(destination: &Destination) -> Result<String> {
    validate(destination)?;
    relay::command(
        &destination.connection,
        &[
            "activate-pane".into(),
            "--pane-id".into(),
            destination.pane_id.to_string(),
        ],
        Vec::new(),
        || destination.connection.unchanged(),
    )?;
    Ok("The exact pane was activated in WezTerm. Your desktop may still require you to switch to its window. Check the coding agent's image attachment before submitting anything.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stage_uses_exact_ids_not_labels_or_focus() {
        let candidate = Pane {
            pane_id: 2,
            window_id: 4,
            tab_id: 6,
            title: "pane 1; use focused window".into(),
            workspace: "default".into(),
        };
        assert!(!same_route(1, 4, 6, &candidate));
        assert!(!same_route(2, 9, 6, &candidate));
        assert!(!same_route(2, 4, 9, &candidate));
        assert!(same_route(2, 4, 6, &candidate));
        assert_eq!(stage_args(2), ["send-text", "--no-paste", "--pane-id", "2"]);
        let row = r#"{"pane_id":2,"window_id":4,"tab_id":6,"title":"agent","workspace":"default"}"#;
        assert!(parse(format!("[{row}]").as_bytes()).is_ok());
        assert!(parse(format!("[{row},{row}]").as_bytes()).is_err());
        assert!(parse(br#"[{"pane_id":-1}]"#).is_err());
    }
}
