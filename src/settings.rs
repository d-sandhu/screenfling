//! The only saved preference is the capture shortcut.
use screenfling::model::Result;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MAX_SETTINGS_BYTES: u64 = 16384;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub version: u32,
    pub shortcut: String,
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
        }
    }
}
fn directory() -> Result<PathBuf> {
    #[cfg(windows)]
    let root = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let root =
        std::env::var_os("HOME").map(|p| PathBuf::from(p).join("Library/Application Support"));
    #[cfg(target_os = "linux")]
    let root = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".config")));
    let root = root
        .filter(|p| p.is_absolute())
        .ok_or("The settings directory is unavailable.")?;
    Ok(root.join("screenfling"))
}
fn nonce() -> Result<String> {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).map_err(|_| "Could not create a temporary settings filename.")?;
    Ok(format!("{:016x}", u64::from_ne_bytes(bytes)))
}
impl Settings {
    fn validate(&self) -> Result<()> {
        if self.version != 1 || self.shortcut.len() > 80 {
            return Err("Settings have an unsupported version or an invalid shortcut.".into());
        }
        Ok(())
    }
    fn read(path: &Path) -> Result<Option<Self>> {
        let file = match File::open(path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("Could not read settings.".into()),
        };
        if !file.metadata().is_ok_and(|m| m.is_file()) {
            return Err("Settings must be a regular file.".into());
        }
        let mut data = Vec::new();
        file.take(MAX_SETTINGS_BYTES + 1)
            .read_to_end(&mut data)
            .map_err(|_| "Could not read settings.")?;
        if data.len() as u64 > MAX_SETTINGS_BYTES {
            return Err("Settings are too large.".into());
        }
        // Old connection fields are ignored, preserving the user's capture shortcut.
        let settings: Self = serde_json::from_slice(&data).map_err(|_| "Settings are invalid.")?;
        settings.validate()?;
        Ok(Some(settings))
    }
    pub fn load() -> (Self, String) {
        match directory().and_then(|p| Self::read(&p.join("settings.json"))) {
            Ok(settings) => (settings.unwrap_or_default(), String::new()),
            Err(error) => (
                Self::default(),
                format!("{error} Using the default shortcut."),
            ),
        }
    }
    pub fn save(&self) -> Result<()> {
        self.save_to(&directory()?)
    }
    fn save_to(&self, dir: &Path) -> Result<()> {
        self.validate()?;
        fs::create_dir_all(dir).map_err(|_| "Could not create the settings directory.")?;
        let data = serde_json::to_vec_pretty(self).map_err(|_| "Could not encode settings.")?;
        let temp = dir.join(format!("settings-{}.tmp", nonce()?));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        // Finish the write before replacing the previous preference.
        let result = (|| -> Result<()> {
            let mut file = options
                .open(&temp)
                .map_err(|_| "Could not create settings.")?;
            file.write_all(&data)
                .and_then(|_| file.sync_all())
                .map_err(|_| "Could not save settings.")?;
            drop(file);
            fs::rename(&temp, dir.join("settings.json"))
                .map_err(|_| "Could not replace settings.".into())
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
    fn legacy_preferences_migrate_and_failed_saves_preserve_the_shortcut() {
        let dir = std::env::temp_dir().join(format!("screenfling-settings-{}", nonce().unwrap()));
        fs::create_dir(&dir).unwrap();
        let path = dir.join("settings.json");
        fs::write(&path, br#"{"version":1,"shortcut":"Control+Shift+KeyF","connection":{"socket":"old","executable":"old","paste_confirmed":true}}"#).unwrap();
        let settings = Settings::read(&path).unwrap().unwrap();
        assert_eq!(settings.shortcut, "Control+Shift+KeyF");
        settings.save_to(&dir).unwrap();
        assert_eq!(Settings::read(&path).unwrap(), Some(settings.clone()));
        assert!(!fs::read_to_string(&path).unwrap().contains("connection"));
        let mut invalid = settings.clone();
        invalid.shortcut = "x".repeat(81);
        assert!(invalid.save_to(&dir).is_err());
        assert_eq!(Settings::read(&path).unwrap(), Some(settings));
        fs::write(&path, vec![b' '; MAX_SETTINGS_BYTES as usize + 1]).unwrap();
        assert!(Settings::read(&path).is_err());
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
