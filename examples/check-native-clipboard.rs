//! Opt-in check for disposable Windows/macOS desktops. Never run by cargo test.
#![cfg(not(test))]

#[cfg(any(target_os = "windows", target_os = "macos"))]
#[path = "../src/clipboard.rs"]
mod clipboard;

fn main() -> Result<(), String> {
    let arguments: Vec<_> = std::env::args().skip(1).collect();
    if arguments.first().map(String::as_str) != Some("--allow-clipboard-write")
        || arguments.len() > 2
    {
        return Err("This check replaces the system clipboard with synthetic images. Run only on a disposable desktop, with --allow-clipboard-write.".into());
    }
    let operation = arguments.get(1).map(String::as_str).unwrap_or("check");
    if !matches!(operation, "check" | "read" | "replace") {
        return Err("Unknown clipboard check operation.".into());
    }
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        check(operation)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err("Use the isolated X11/Wayland smoke scripts on Linux instead.".into())
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn check(operation: &str) -> Result<(), String> {
    use screenfling::model::Pixels;
    let first = Pixels::new(
        3,
        2,
        vec![
            1, 22, 133, 255, 44, 155, 66, 255, 177, 88, 9, 255, 110, 21, 232, 255, 43, 154, 65,
            255, 176, 87, 198, 255,
        ],
    )?;
    let mut replacement = first.clone();
    replacement.rgba[20] ^= 1;
    let mut clipboard = clipboard::Clipboard::new()?;
    match operation {
        "read" => {
            if !clipboard.matches(&first) {
                return Err("Another process could not read the exact clipboard image.".into());
            }
        }
        "replace" => clipboard.copy(&replacement)?,
        "check" => {
            clipboard.copy(&first)?;
            let executable = std::env::current_exe().map_err(|error| error.to_string())?;
            for operation in ["read", "replace"] {
                let status = std::process::Command::new(&executable)
                    .args(["--allow-clipboard-write", operation])
                    .status()
                    .map_err(|error| error.to_string())?;
                if !status.success() {
                    return Err(format!("The separate-process {operation} check failed."));
                }
            }
            if clipboard.matches(&first) || !clipboard.matches(&replacement) {
                return Err("Clipboard verification missed another process's replacement.".into());
            }
            println!(
                "Native clipboard: exact pixels read by another process; one changed pixel rejected after its writer exited."
            );
        }
        _ => unreachable!(),
    }
    Ok(())
}
