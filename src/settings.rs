use crate::{trusted, wezterm::ConnectionSettings};
use screenfling::model::Result;
use serde::{Deserialize, Serialize};
use std::{fs::{self, OpenOptions}, io::Write};

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Settings { pub version: u32, pub shortcut: String, pub connection: ConnectionSettings }
impl Default for Settings {
    fn default() -> Self {
        Self { version: 1, shortcut: if cfg!(target_os = "macos") { "Super+Shift+Digit9" } else { "Control+Shift+Digit9" }.into(), connection: ConnectionSettings::default() }
    }
}
impl Settings {
    pub fn load() -> (Self, String) {
        let result = (|| -> Result<Option<Self>> {
            let path = trusted::data_dir()?.join("settings.json");
            match fs::symlink_metadata(&path) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(_) => return Err("Could not read settings; defaults are in use.".into()),
                Ok(metadata) if metadata.len() > 16384 || !metadata.is_file() || metadata.file_type().is_symlink() => return Err("Settings are invalid; defaults are in use.".into()),
                Ok(_) => {}
            }
            let data = fs::read(path).map_err(|_| "Could not read settings; defaults are in use.")?;
            let settings: Self = serde_json::from_slice(&data).map_err(|_| "Settings are invalid; defaults are in use.")?;
            if settings.version != 1 || settings.shortcut.len() > 80 || settings.connection.executable.len() > 4096 || settings.connection.socket.len() > 4096 {
                return Err("Settings are not supported; defaults are in use.".into());
            }
            Ok(Some(settings))
        })();
        match result { Ok(Some(settings)) => (settings, String::new()), Ok(None) => (Self::default(), "Capture a region, review it, then choose Copy or Stage. Nothing is uploaded.".into()), Err(error) => (Self::default(), error) }
    }
    pub fn save(&self) -> Result<()> {
        let dir = trusted::data_dir()?;
        let temp = dir.join(format!("settings-{}.tmp", trusted::nonce()?));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let result = (|| -> Result<()> {
            let data = serde_json::to_vec_pretty(self).map_err(|_| "Could not encode settings.")?;
            if data.len() > 16384 { return Err("Settings are too large.".into()); }
            let mut file = options.open(&temp).map_err(|_| "Could not create the settings file.")?;
            file.write_all(&data).and_then(|_| file.sync_all()).map_err(|_| "Could not save settings.")?;
            drop(file);
            fs::rename(&temp, dir.join("settings.json")).map_err(|_| "Could not replace settings safely.")?;
            #[cfg(unix)]
            { if let Ok(parent) = fs::File::open(&dir) { let _ = parent.sync_all(); } }
            Ok(())
        })();
        if result.is_err() { let _ = fs::remove_file(temp); }
        result
    }
}
