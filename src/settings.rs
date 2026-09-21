use crate::{trusted, wezterm::ConnectionSettings};
use screenfling::model::Result;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
};

const MAX_SETTINGS_BYTES: usize = 16384;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Settings {
    pub version: u32,
    pub shortcut: String,
    pub connection: ConnectionSettings,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            shortcut: if cfg!(target_os = "macos") {
                "Super+Shift+Digit9"
            } else {
                "Control+Shift+Digit9"
            }
            .into(),
            connection: ConnectionSettings::default(),
        }
    }
}
impl Settings {
    fn validate(&self) -> Result<()> {
        if self.version != 1
            || self.shortcut.len() > 80
            || self.connection.executable.len() > 4096
            || self.connection.socket.len() > 4096
        {
            return Err(
                "Settings have an unsupported version or an excessive field length.".into(),
            );
        }
        Ok(())
    }
    fn read(path: &Path) -> Result<Option<Self>> {
        match fs::symlink_metadata(path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("Could not read settings.".into()),
            Ok(metadata)
                if metadata.len() > MAX_SETTINGS_BYTES as u64
                    || !metadata.is_file()
                    || metadata.file_type().is_symlink() =>
            {
                return Err("Settings are invalid or too large.".into());
            }
            Ok(_) => {}
        }
        // Bound the actual read as well as the metadata check.
        let mut data = Vec::new();
        File::open(path)
            .and_then(|file| {
                file.take((MAX_SETTINGS_BYTES + 1) as u64)
                    .read_to_end(&mut data)
            })
            .map_err(|_| "Could not read settings.")?;
        if data.len() > MAX_SETTINGS_BYTES {
            return Err("Settings are too large.".into());
        }
        let settings: Self = serde_json::from_slice(&data).map_err(|_| "Settings are invalid.")?;
        settings.validate()?;
        Ok(Some(settings))
    }
    pub fn load() -> (Self, String) {
        let result = trusted::data_dir().and_then(|dir| Self::read(&dir.join("settings.json")));
        match result {
            Ok(Some(settings)) => (settings, String::new()),
            Ok(None) => (
                Self::default(),
                "Capture a region, review it, then choose Copy or Stage. Nothing is uploaded."
                    .into(),
            ),
            Err(error) => (Self::default(), format!("{error} Defaults are in use.")),
        }
    }
    pub fn save(&self) -> Result<()> {
        self.save_to(&trusted::data_dir()?)
    }
    fn save_to(&self, dir: &Path) -> Result<()> {
        self.validate()?;
        trusted::private_dir(dir)?;
        let data = serde_json::to_vec_pretty(self).map_err(|_| "Could not encode settings.")?;
        if data.len() > MAX_SETTINGS_BYTES {
            return Err("Settings are too large.".into());
        }
        let temp = dir.join(format!("settings-{}.tmp", trusted::nonce()?));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let result = (|| -> Result<()> {
            let mut file = options
                .open(&temp)
                .map_err(|_| "Could not create the settings file.")?;
            file.write_all(&data)
                .and_then(|_| file.sync_all())
                .map_err(|_| "Could not save settings.")?;
            drop(file);
            fs::rename(&temp, dir.join("settings.json"))
                .map_err(|_| "Could not replace settings safely.")?;
            #[cfg(unix)]
            {
                if let Ok(parent) = File::open(dir) {
                    let _ = parent.sync_all();
                }
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_round_trip_and_rejected_save_preserve_previous_value() {
        let directory = trusted::TemporaryDirectory::new().unwrap();
        let path = directory.0.join("settings.json");
        assert!(Settings::read(&path).unwrap().is_none());
        let mut settings = Settings::default();
        settings.save_to(&directory.0).unwrap();
        assert_eq!(Settings::read(&path).unwrap().unwrap(), settings);
        settings.shortcut = "Control+Shift+KeyF".into();
        settings.save_to(&directory.0).unwrap();
        assert_eq!(Settings::read(&path).unwrap().unwrap(), settings);
        let mut invalid = settings.clone();
        invalid.connection.socket = "x".repeat(4097);
        assert!(invalid.save_to(&directory.0).is_err());
        invalid = settings.clone();
        invalid.version = 2;
        assert!(invalid.save_to(&directory.0).is_err());
        assert_eq!(Settings::read(&path).unwrap().unwrap(), settings);
        fs::write(&path, vec![b' '; MAX_SETTINGS_BYTES + 1]).unwrap();
        assert!(Settings::read(&path).is_err());
        fs::remove_file(path).unwrap();
        assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 0);
    }
}
