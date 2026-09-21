//! Parse launch options before initializing the desktop or requesting capture.
use std::ffi::OsString;

pub const HELP: &str = "ScreenFling - capture, review, and copy or stage a screenshot.

Usage: screenfling [--capture | --help | --version]

  --capture  Start a new application and request a capture.
  --help     Print this help without starting the desktop.
  --version  Print the application version without starting the desktop.

With no option, open ScreenFling. Keep one copy running and use its tray or
capture shortcut. --capture does not activate an existing application.
Nothing is copied or staged until you review the crop and choose an action.";

#[derive(Debug, PartialEq, Eq)]
pub enum Startup {
    Open,
    Capture,
    Help,
    Version,
}

pub fn parse(args: impl IntoIterator<Item = OsString>) -> Result<Startup, &'static str> {
    let mut args = args.into_iter();
    let first = args.next();
    if args.next().is_some() {
        return Err("Use only one launch option. No capture was started.");
    }
    match first.as_deref().and_then(|arg| arg.to_str()) {
        None if first.is_none() => Ok(Startup::Open),
        Some("--capture") => Ok(Startup::Capture),
        Some("--help" | "-h") => Ok(Startup::Help),
        Some("--version" | "-V") => Ok(Startup::Version),
        _ => Err("Unknown launch option. No capture was started."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_options_are_explicit_and_do_not_ignore_extra_input() {
        let parse = |args: &[&str]| super::parse(args.iter().map(|arg| OsString::from(*arg)));
        assert_eq!(parse(&[]), Ok(Startup::Open));
        assert_eq!(parse(&["--capture"]), Ok(Startup::Capture));
        assert_eq!(parse(&["--help"]), Ok(Startup::Help));
        assert_eq!(parse(&["--version"]), Ok(Startup::Version));
        for args in [
            vec!["--unknown"],
            vec!["--capture", "--unknown"],
            vec!["--version", "--capture"],
            vec!["--capture", "--capture"],
        ] {
            assert!(parse(&args).is_err());
        }
    }
}
