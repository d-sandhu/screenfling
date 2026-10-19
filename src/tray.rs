//! The tray icon is the app's only standing interface: left-click captures,
//! the menu holds Capture, Change shortcut…, Start at login and Quit.
use crate::{app::Message, desktop, panel::Control};

/// A 32×32 capture mark: four corner brackets, the same mark as the app icon.
fn icon_rgba() -> Vec<u8> {
    const SIZE: usize = 32;
    let mut rgba = vec![0u8; SIZE * SIZE * 4];
    for y in 4..28 {
        for x in 4..28 {
            let near = |v: usize| !(10..22).contains(&v);
            let edge = |v: usize| (4..7).contains(&v) || (25..28).contains(&v);
            if (edge(x) && near(y)) || (edge(y) && near(x)) {
                let i = (y * SIZE + x) * 4;
                rgba[i..i + 4].copy_from_slice(&[78, 170, 245, 255]);
            }
        }
    }
    rgba
}

#[cfg(not(target_os = "linux"))]
pub use native::Tray;

#[cfg(not(target_os = "linux"))]
mod native {
    use super::*;
    use tray_icon::{
        Icon, MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent,
        menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    };

    pub struct Tray {
        _icon: TrayIcon,
        capture: MenuItem,
        login: CheckMenuItem,
    }

    impl Tray {
        pub fn new(shortcut: &str, login: bool) -> Option<Self> {
            let capture = MenuItem::new(capture_label(shortcut), true, None);
            let change = MenuItem::new("Change shortcut…", true, None);
            let login_item = CheckMenuItem::new("Start at login", true, login, None);
            let quit = MenuItem::new("Quit ScreenFling", true, None);
            let menu = Menu::new();
            menu.append_items(&[
                &capture,
                &change,
                &PredefinedMenuItem::separator(),
                &login_item,
                &PredefinedMenuItem::separator(),
                &quit,
            ])
            .ok()?;
            let controls = [
                (capture.id().clone(), Control::Capture),
                (change.id().clone(), Control::ChangeShortcut),
                (login_item.id().clone(), Control::ToggleLogin),
                (quit.id().clone(), Control::Quit),
            ];
            MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
                if let Some((_, control)) = controls.iter().find(|(id, _)| *id == event.id) {
                    desktop::post(Message::Control(*control));
                }
            }));
            // A left click captures; the menu opens on a right click.
            TrayIconEvent::set_event_handler(Some(|event: TrayIconEvent| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    desktop::post(Message::Control(Control::Capture));
                }
            }));
            let icon = Icon::from_rgba(icon_rgba(), 32, 32).ok()?;
            let tray = TrayIconBuilder::new()
                .with_menu(Box::new(menu))
                .with_menu_on_left_click(false)
                .with_tooltip("ScreenFling")
                .with_icon(icon)
                .build()
                .ok()?;
            Some(Self {
                _icon: tray,
                capture,
                login: login_item,
            })
        }

        pub fn set_login(&self, on: bool) {
            self.login.set_checked(on);
        }

        pub fn set_shortcut(&self, shortcut: &str) {
            self.capture.set_text(capture_label(shortcut));
        }
    }

    fn capture_label(shortcut: &str) -> String {
        if shortcut.starts_with("the ") || shortcut.starts_with("your ") {
            "Capture".into()
        } else {
            format!("Capture  ({shortcut})")
        }
    }
}

#[cfg(target_os = "linux")]
pub use linux::Tray;

/// Linux trays speak StatusNotifierItem over D-Bus; ksni implements it in
/// Rust, so no GTK is needed. Desktops without a tray host get the home panel.
#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use ksni::{
        Icon, ToolTip,
        blocking::{Handle, TrayMethods},
        menu::{CheckmarkItem, MenuItem, StandardItem},
    };

    struct Item {
        shortcut: String,
        login: bool,
    }

    impl ksni::Tray for Item {
        fn id(&self) -> String {
            "dev.screenfling.ScreenFling".into()
        }
        fn title(&self) -> String {
            "ScreenFling".into()
        }
        fn icon_pixmap(&self) -> Vec<Icon> {
            // StatusNotifierItem pixmaps are ARGB32 in network byte order.
            let data = icon_rgba()
                .as_chunks::<4>()
                .0
                .iter()
                .flat_map(|p| [p[3], p[0], p[1], p[2]])
                .collect();
            vec![Icon {
                width: 32,
                height: 32,
                data,
            }]
        }
        fn tool_tip(&self) -> ToolTip {
            ToolTip {
                title: "ScreenFling".into(),
                ..Default::default()
            }
        }
        fn activate(&mut self, _x: i32, _y: i32) {
            desktop::post(Message::Control(Control::Capture));
        }
        fn menu(&self) -> Vec<MenuItem<Self>> {
            let post = |control: Control| {
                Box::new(move |_: &mut Self| desktop::post(Message::Control(control)))
                    as Box<dyn Fn(&mut Self) + Send + 'static>
            };
            vec![
                StandardItem {
                    label: format!("Capture  ({})", self.shortcut),
                    activate: post(Control::Capture),
                    ..Default::default()
                }
                .into(),
                StandardItem {
                    label: "Change shortcut…".into(),
                    activate: post(Control::ChangeShortcut),
                    ..Default::default()
                }
                .into(),
                MenuItem::Separator,
                CheckmarkItem {
                    label: "Start at login".into(),
                    checked: self.login,
                    activate: post(Control::ToggleLogin),
                    ..Default::default()
                }
                .into(),
                MenuItem::Separator,
                StandardItem {
                    label: "Quit ScreenFling".into(),
                    activate: post(Control::Quit),
                    ..Default::default()
                }
                .into(),
            ]
        }
    }

    pub struct Tray(Handle<Item>);

    impl Tray {
        pub fn new(shortcut: &str, login: bool) -> Option<Self> {
            let item = Item {
                shortcut: shortcut.into(),
                login,
            };
            // Fails when no StatusNotifierWatcher (tray host) is running.
            item.spawn().ok().map(Self)
        }

        pub fn set_login(&self, on: bool) {
            self.0.update(|item| item.login = on);
        }

        pub fn set_shortcut(&self, shortcut: &str) {
            let shortcut = shortcut.to_owned();
            self.0.update(move |item| item.shortcut = shortcut);
        }
    }
}
