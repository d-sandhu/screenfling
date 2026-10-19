//! The small window for everything that is not the overlay: a passing notice,
//! the shortcut prompt, and the controls on desktops without a tray.
use crate::canvas::{Canvas, Rect, Rgb, Text, rgb};

const BACKGROUND: Rgb = rgb(12, 17, 27);
const BUTTON: Rgb = rgb(28, 37, 52);
const HOVER: Rgb = rgb(25, 49, 74);
const BORDER: Rgb = rgb(112, 130, 153);
const TEXT: Rgb = rgb(239, 244, 251);
const MUTED: Rgb = rgb(177, 190, 208);
const ACCENT: Rgb = rgb(132, 198, 255);
const INK: Rgb = rgb(8, 24, 40);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Mode {
    /// A message that disappears on its own and never takes focus.
    Notice(String),
    /// Waiting for the new capture shortcut.
    Prompt,
    /// Controls, when the desktop has no tray to hold them.
    Home,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Control {
    Capture,
    ChangeShortcut,
    ToggleLogin,
    Quit,
}

/// What the home panel shows.
pub struct Status {
    pub shortcut: String,
    pub login: bool,
    pub message: String,
}

pub struct Layout {
    pub size: [f32; 2],
    lines: Vec<(String, f32, f32, f32, Rgb)>,
    buttons: Vec<(Rect, String, Control, bool)>,
}

impl Layout {
    pub fn new(mode: &Mode, status: &Status, text: &mut Text, scale: f32) -> Self {
        let s = scale;
        let pad = 18.0 * s;
        let mut lines = Vec::new();
        let mut buttons = Vec::new();
        let mut y = pad;
        let mut width: f32 = 260.0 * s;
        let mut line = |text: &mut Text, words: String, size: f32, color: Rgb, y: &mut f32| {
            let (_, height) = text.line(size);
            width = width.max(text.width(&words, size) + 2.0 * pad);
            lines.push((words, pad, *y, size, color));
            *y += height + 4.0 * s;
        };
        match mode {
            Mode::Notice(message) => line(text, message.clone(), 14.0 * s, TEXT, &mut y),
            Mode::Prompt => {
                line(
                    text,
                    "Press the new capture shortcut".into(),
                    16.0 * s,
                    TEXT,
                    &mut y,
                );
                line(
                    text,
                    "Hold Ctrl, Alt, Shift or Win/Cmd with a key  ·  Esc cancels".into(),
                    13.0 * s,
                    MUTED,
                    &mut y,
                );
            }
            Mode::Home => {
                line(text, "ScreenFling".into(), 18.0 * s, TEXT, &mut y);
                line(
                    text,
                    format!("Press {} anywhere to capture.", status.shortcut),
                    14.0 * s,
                    MUTED,
                    &mut y,
                );
                if !status.message.is_empty() {
                    line(text, status.message.clone(), 14.0 * s, TEXT, &mut y);
                }
                y += 8.0 * s;
                let h = 34.0 * s;
                let mut x = pad;
                let login = if status.login {
                    "Start at login: On"
                } else {
                    "Start at login: Off"
                };
                for (label, control, primary) in [
                    ("Capture", Control::Capture, true),
                    ("Change shortcut", Control::ChangeShortcut, false),
                    (login, Control::ToggleLogin, false),
                    ("Quit", Control::Quit, false),
                ] {
                    let w = text.width(label, 14.0 * s) + 24.0 * s;
                    buttons.push((Rect::new(x, y, w, h), label.to_owned(), control, primary));
                    x += w + 8.0 * s;
                }
                width = width.max(x - 8.0 * s + pad);
                y += h;
            }
        }
        Self {
            size: [width.ceil(), (y + pad).ceil()],
            lines,
            buttons,
        }
    }

    pub fn hit(&self, p: [f32; 2]) -> Option<Control> {
        self.buttons
            .iter()
            .find_map(|(r, _, control, _)| r.contains(p).then_some(*control))
    }

    pub fn draw(&self, canvas: &mut Canvas, text: &mut Text, pointer: [f32; 2], scale: f32) {
        let bounds = Rect::new(0.0, 0.0, canvas.width as f32, canvas.height as f32);
        canvas.fill(bounds, BACKGROUND);
        canvas.outline(bounds, 1.0, BORDER, false);
        for (words, x, y, size, color) in &self.lines {
            canvas.text(text, words, *x, *y, *size, *color);
        }
        let (_, line) = text.line(14.0 * scale);
        for (r, label, _, primary) in &self.buttons {
            let (fill, ink) = match (primary, r.contains(pointer)) {
                (true, _) => (ACCENT, INK),
                (false, true) => (HOVER, TEXT),
                (false, false) => (BUTTON, TEXT),
            };
            canvas.panel(*r, 8.0 * scale, fill, (!primary).then_some(BORDER));
            canvas.text(
                text,
                label,
                r.x + 12.0 * scale,
                r.y + (r.h - line) / 2.0,
                14.0 * scale,
                ink,
            );
        }
    }
}

/// A capture shortcut in global-hotkey's names from the keys being held,
/// once a non-modifier key joins at least one modifier.
pub fn shortcut(modifiers: &[&str], key: &str) -> Option<String> {
    let modifier = |k: &str| {
        k.starts_with("Control")
            || k.starts_with("Shift")
            || k.starts_with("Alt")
            || k.starts_with("Super")
            || k.starts_with("Meta")
    };
    (!modifiers.is_empty() && !modifier(key)).then(|| {
        let mut parts: Vec<&str> = modifiers.to_vec();
        parts.push(key);
        parts.join("+")
    })
}

/// "Control+Shift+Digit9" as people read it: "Ctrl+Shift+9".
pub fn readable(shortcut: &str) -> String {
    shortcut
        .split('+')
        .map(|part| match part {
            "Control" => "Ctrl".to_owned(),
            "Super" if cfg!(target_os = "macos") => "Cmd".to_owned(),
            "Super" => "Win".to_owned(),
            "Alt" if cfg!(target_os = "macos") => "Option".to_owned(),
            other => other
                .strip_prefix("Key")
                .or_else(|| other.strip_prefix("Digit"))
                .unwrap_or(other)
                .to_owned(),
        })
        .collect::<Vec<_>>()
        .join("+")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn winit_key_names_are_what_global_hotkey_parses() {
        use winit::keyboard::KeyCode;
        // The prompt names keys with winit's Debug output; the shortcut is
        // only usable if global-hotkey reads those names back.
        for code in [KeyCode::Digit9, KeyCode::KeyS, KeyCode::F8, KeyCode::Space] {
            let value = shortcut(&["Control", "Shift"], &format!("{code:?}")).unwrap();
            assert!(
                value.parse::<global_hotkey::hotkey::HotKey>().is_ok(),
                "{value}"
            );
        }
    }

    #[test]
    fn shortcuts_need_a_modifier_and_a_key() {
        assert_eq!(
            shortcut(&["Control", "Shift"], "Digit9").as_deref(),
            Some("Control+Shift+Digit9")
        );
        assert_eq!(shortcut(&[], "Digit9"), None);
        assert_eq!(shortcut(&["Control"], "ShiftLeft"), None);
        if !cfg!(target_os = "macos") {
            assert_eq!(readable("Control+Shift+Digit9"), "Ctrl+Shift+9");
            assert_eq!(readable("Super+Shift+KeyS"), "Win+Shift+S");
        }
    }
}
