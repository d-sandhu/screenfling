//! Terminal-independent handoff: explicitly save a PNG and copy its local path.
use crate::trusted;
use screenfling::model::{Pixels, Result};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub fn save(image: &Pixels) -> Result<PathBuf> {
    save_in(&trusted::data_dir()?.join("captures"), image)
}

fn save_in(directory: &Path, image: &Pixels) -> Result<PathBuf> {
    trusted::create_private_dir(directory, true)?;
    let path = directory.join(format!("capture-{}.png", trusted::nonce()?));
    clipboard_path(&path)?;
    let png = image.png()?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .map_err(|_| "Could not save the screenshot.")?;
    if file.write_all(&png).and_then(|_| file.sync_all()).is_err() {
        drop(file);
        let _ = fs::remove_file(&path);
        return Err("Could not finish saving the screenshot.".into());
    }
    Ok(path)
}

pub fn clipboard_path(path: &Path) -> Result<&str> {
    let text = path
        .to_str()
        .ok_or("The screenshot path cannot be represented as text.")?;
    if !path.is_absolute() || text.chars().any(char::is_control) {
        return Err("The screenshot needs an absolute, single-line path.".into());
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_handoff_preserves_pixels_and_existing_files() {
        let temporary = trusted::TemporaryDirectory::new().unwrap();
        let directory = temporary.0.join("captures");
        let original = Pixels::new(2, 1, vec![20, 40, 80, 255, 90, 70, 50, 255]).unwrap();
        let first = save_in(&directory, &original).unwrap();
        let second = save_in(&directory, &original).unwrap();
        assert_ne!(first, second);
        let decoded = image::load_from_memory(&fs::read(&first).unwrap())
            .unwrap()
            .into_rgba8();
        assert_eq!(decoded.dimensions(), (2, 1));
        assert_eq!(decoded.as_raw(), &original.rgba);
        assert!(first.exists() && second.exists());
        assert_eq!(clipboard_path(&first).unwrap(), first.to_str().unwrap());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&first).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::remove_file(first).unwrap();
        fs::remove_file(second).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn path_handoff_preserves_spaces_and_rejects_controls() {
        let temporary = trusted::TemporaryDirectory::new().unwrap();
        let path = temporary.0.join("a screenshot.png");
        assert!(clipboard_path(&path).unwrap().ends_with("a screenshot.png"));
        assert!(clipboard_path(Path::new("relative.png")).is_err());
        assert!(clipboard_path(&temporary.0.join("line\nbreak.png")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn save_does_not_follow_a_replaced_directory() {
        let temporary = trusted::TemporaryDirectory::new().unwrap();
        let target = temporary.0.join("target");
        fs::create_dir(&target).unwrap();
        let link = temporary.0.join("captures");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let image = Pixels::new(1, 1, vec![0, 0, 0, 255]).unwrap();
        assert!(save_in(&link, &image).is_err());
        assert_eq!(fs::read_dir(&target).unwrap().count(), 0);
        fs::remove_file(link).unwrap();
        fs::remove_dir(target).unwrap();
    }
}
