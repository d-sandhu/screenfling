//! Presentation only. Delivery, clipboard access and routing remain in App actions.
use super::*;
use egui::{
    Align, Button, FontFamily, FontId, Frame, Label, Layout, RichText, Stroke, Ui, UiBuilder,
};

const BACKGROUND: Color32 = Color32::from_rgb(12, 17, 27);
const SURFACE: Color32 = Color32::from_rgb(21, 29, 42);
const FIELD: Color32 = Color32::from_rgb(15, 22, 33);
const LINE: Color32 = Color32::from_rgb(43, 56, 74);
const BORDER: Color32 = Color32::from_rgb(112, 130, 153);
const TEXT: Color32 = Color32::from_rgb(239, 244, 251);
const MUTED: Color32 = Color32::from_rgb(177, 190, 208);
const ACCENT: Color32 = Color32::from_rgb(132, 198, 255);
const ACCENT_DARK: Color32 = Color32::from_rgb(25, 49, 74);
const INK: Color32 = Color32::from_rgb(8, 24, 40);
const ERROR: Color32 = Color32::from_rgb(255, 174, 185);

pub fn configure(ctx: &egui::Context) {
    ctx.set_visuals(egui::Visuals::dark());
    ctx.global_style_mut(|style| {
        for (kind, size) in [
            (egui::TextStyle::Heading, 22.0),
            (egui::TextStyle::Body, 14.0),
            (egui::TextStyle::Button, 14.0),
            (egui::TextStyle::Small, 12.0),
        ] {
            style
                .text_styles
                .insert(kind, FontId::new(size, FontFamily::Proportional));
        }
        style
            .text_styles
            .insert(egui::TextStyle::Monospace, FontId::monospace(13.0));
        style.spacing.item_spacing = Vec2::new(10.0, 10.0);
        style.spacing.scroll = egui::style::ScrollStyle::solid();
        style.spacing.button_padding = Vec2::new(14.0, 9.0);
        style.spacing.interact_size = Vec2::new(36.0, 36.0);
        style.visuals.panel_fill = BACKGROUND;
        style.visuals.window_fill = SURFACE;
        style.visuals.extreme_bg_color = FIELD;
        style.visuals.faint_bg_color = SURFACE;
        style.visuals.hyperlink_color = ACCENT;
        style.visuals.error_fg_color = ERROR;
        style.visuals.selection.bg_fill = ACCENT_DARK;
        style.visuals.selection.stroke = Stroke::new(2.0_f32, ACCENT);
        for widget in [
            &mut style.visuals.widgets.noninteractive,
            &mut style.visuals.widgets.inactive,
            &mut style.visuals.widgets.hovered,
            &mut style.visuals.widgets.active,
            &mut style.visuals.widgets.open,
        ] {
            widget.fg_stroke = Stroke::new(1.0_f32, TEXT);
            widget.bg_fill = SURFACE;
            widget.weak_bg_fill = SURFACE;
            widget.bg_stroke = Stroke::new(1.0_f32, BORDER);
            widget.corner_radius = 8.into();
        }
        style.visuals.widgets.noninteractive.bg_stroke = Stroke::new(1.0_f32, LINE);
        style.visuals.widgets.hovered.bg_fill = ACCENT_DARK;
        style.visuals.widgets.hovered.weak_bg_fill = ACCENT_DARK;
        style.visuals.widgets.hovered.bg_stroke = Stroke::new(2.0_f32, ACCENT);
        style.visuals.widgets.active.bg_stroke = Stroke::new(2.0_f32, ACCENT);
    });
}

fn muted(ui: &mut Ui, text: impl Into<String>) {
    ui.add(Label::new(RichText::new(text).color(MUTED)).wrap());
}
fn heading(ui: &mut Ui, text: &str) {
    ui.add(Label::new(RichText::new(text).size(22.0).strong().color(TEXT)).wrap());
}
fn card() -> Frame {
    Frame::new()
        .fill(SURFACE)
        .stroke(Stroke::new(1.0_f32, LINE))
        .corner_radius(12)
        .inner_margin(16)
}
fn primary(text: &str) -> Button<'_> {
    Button::new(RichText::new(text).color(INK).strong())
        .fill(ACCENT)
        .min_size(Vec2::new(148.0, 40.0))
}
fn region(ui: &mut Ui, rect: Rect, content: impl FnOnce(&mut Ui)) {
    ui.scope_builder(
        UiBuilder::new()
            .max_rect(rect)
            .layout(Layout::top_down(Align::Min)),
        |ui| {
            ui.set_clip_rect(rect.intersect(ui.clip_rect()));
            ui.set_width(rect.width());
            content(ui);
        },
    );
}

// A fixed action area cannot disappear below a long note, pane title or settings form.
fn regions(screen: Rect, settings: bool) -> [Rect; 4] {
    let margin = if screen.width() < 720.0 { 16.0 } else { 24.0 };
    let inner = screen.shrink(margin);
    let header = Rect::from_min_size(inner.min, Vec2::new(inner.width(), 44.0));
    let steps = Rect::from_min_size(
        Pos2::new(inner.min.x, header.max.y + 12.0),
        Vec2::new(inner.width(), 32.0),
    );
    let footer_height = if inner.width() < 470.0 { 136.0 } else { 96.0 };
    let footer = Rect::from_min_max(
        Pos2::new(inner.min.x, inner.max.y - footer_height),
        inner.max,
    );
    let top = if settings {
        header.max.y + 20.0
    } else {
        steps.max.y + 20.0
    };
    let body = Rect::from_min_max(
        Pos2::new(inner.min.x, top),
        Pos2::new(inner.max.x, (footer.min.y - 16.0).max(top + 1.0)),
    );
    [header, steps, body, footer]
}

pub(super) fn show(app: &mut App, ui: &mut Ui) -> Action {
    let phase = app.flow.phase();
    if ui.input(|i| i.key_pressed(egui::Key::Escape)) {
        if app.settings_open && phase != Phase::Delivering {
            app.settings_open = false;
        } else {
            return if matches!(phase, Phase::Capturing | Phase::Selecting | Phase::Review) {
                Action::Cancel
            } else if phase == Phase::Delivering {
                Action::None
            } else {
                Action::Hide
            };
        }
    }
    if phase == Phase::Selecting {
        return app.selection_ui(ui);
    }
    if phase != Phase::Delivering && ui.input(|i| i.key_pressed(egui::Key::F10)) {
        app.settings_open = !app.settings_open;
    }
    if !app.settings_open {
        if matches!(phase, Phase::Idle | Phase::Result)
            && ui.input(|i| i.key_pressed(egui::Key::F8))
        {
            return Action::Capture;
        }
        if phase == Phase::Review && ui.input(|i| i.key_pressed(egui::Key::F6)) {
            return Action::Copy;
        }
    }
    let mut action = Action::None;
    let screen = ui.max_rect();
    ui.painter().rect_filled(screen, 0.0, BACKGROUND);
    let [header_rect, steps_rect, _, _] = regions(screen, app.settings_open);
    region(ui, header_rect, |ui| header(app, ui, &mut action));
    // A header click can change settings on this frame. Recompute before laying out content.
    let [_, _, body_rect, footer_rect] = regions(screen, app.settings_open);
    if !app.settings_open {
        region(ui, steps_rect, |ui| steps(ui, phase));
    }
    region(ui, body_rect, |ui| {
        if app.settings_open {
            egui::ScrollArea::vertical()
                .id_salt("settings-page")
                .auto_shrink([false, false])
                .show(ui, |ui| settings(app, ui, &mut action));
        } else if phase == Phase::Review {
            review(app, ui, &mut action);
        } else {
            egui::ScrollArea::vertical()
                .id_salt("overview-page")
                .auto_shrink([false, false])
                .show(ui, |ui| overview(app, ui));
        }
    });
    region(ui, footer_rect, |ui| footer(app, ui, &mut action));
    action
}

fn header(app: &mut App, ui: &mut Ui, action: &mut Action) {
    ui.horizontal(|ui| {
        let (mark, _) = ui.allocate_exact_size(Vec2::splat(32.0), Sense::hover());
        corner_mark(ui, mark.shrink(4.0), ACCENT);
        ui.label(RichText::new("ScreenFling").size(22.0).strong().color(TEXT));
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.add_enabled_ui(app.flow.phase() != Phase::Delivering, |ui| {
                ui.menu_button("More", |ui| {
                    if ui
                        .checkbox(&mut app.advanced_open, "WezTerm integration")
                        .changed()
                    {
                        app.send_open = false;
                    }
                    if app.tray_available && ui.button("Hide to tray").clicked() {
                        *action = Action::Hide;
                    }
                    if ui.button("Quit ScreenFling").clicked() {
                        *action = Action::Quit;
                    }
                });
                if ui
                    .add(Button::new("Settings").selected(app.settings_open))
                    .on_hover_text("Settings (F10)")
                    .clicked()
                {
                    app.settings_open = !app.settings_open;
                }
            });
        });
    });
}
fn steps(ui: &mut Ui, phase: Phase) {
    let current = match phase {
        Phase::Idle | Phase::Capturing | Phase::Selecting => 0,
        Phase::Review => 1,
        Phase::Delivering | Phase::Result => 2,
    };
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 12.0;
        for (index, label) in ["Capture", "Review", "Send"].into_iter().enumerate() {
            if index > 0 {
                ui.label(RichText::new("/").color(MUTED));
            }
            let color = if index == current { ACCENT } else { MUTED };
            ui.label(
                RichText::new(format!("{}  {label}", index + 1))
                    .color(color)
                    .strong(),
            );
        }
    });
}
fn overview(app: &App, ui: &mut Ui) {
    ui.add_space(12.0);
    match app.flow.phase() {
        Phase::Idle => {
            ui.add(
                Label::new(
                    RichText::new("Show your agent.")
                        .size(32.0)
                        .strong()
                        .color(TEXT),
                )
                .wrap(),
            );
            ui.add_space(6.0);
            muted(
                ui,
                "Capture a region, choose your coding-session window, and send. Keep the terminal you already use.",
            );
            ui.add_space(16.0);
            card().show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                ui.label(RichText::new("Capture → review → send").strong());
                muted(ui, "ScreenFling pastes a local image path into your selected window. You stay in control of submitting. Copy is always available too.");
            });
            ui.add_space(12.0);
            muted(ui, &app.shortcut_status);
            if capture::is_wayland() {
                muted(
                    ui,
                    "Wayland asks which display to share before region selection.",
                );
            }
            if !app.status.is_empty() {
                muted(ui, &app.status);
            }
        }
        Phase::Result => {
            heading(
                ui,
                if app.copied {
                    "Ready to paste"
                } else {
                    "Result"
                },
            );
            ui.add_space(8.0);
            card().show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                ui.add(Label::new(RichText::new(&app.status).size(16.0)).wrap());
            });
            if let Some(destination) = &app.reveal {
                ui.add_space(12.0);
                ui.label(RichText::new("Selected destination").strong());
                muted(ui, &destination.title);
                muted(
                    ui,
                    format!(
                        "Pane {} · Window {} · {}",
                        destination.pane_id, destination.window_id, destination.workspace
                    ),
                );
                ui.add_space(8.0);
                muted(
                    ui,
                    "A terminal write is not an attachment acknowledgment. Reveal the destination and inspect the coding agent before submitting or trying again.",
                );
            }
        }
        Phase::Capturing | Phase::Delivering => {
            ui.horizontal(|ui| {
                ui.spinner();
                heading(
                    ui,
                    if app.flow.phase() == Phase::Delivering {
                        "Sending once"
                    } else {
                        "Preparing your capture"
                    },
                );
            });
            ui.add_space(12.0);
            card().show(ui, |ui| {
                ui.set_min_width(ui.available_width());
                muted(ui, &app.status);
            });
            if app.flow.phase() == Phase::Delivering {
                ui.add_space(12.0);
                muted(
                    ui,
                    "Delivery is pending. Do not paste or retry. The result will say what is known; image attachment still needs your inspection.",
                );
            }
        }
        _ => {}
    }
}

fn review(app: &mut App, ui: &mut Ui, action: &mut Action) {
    if !app.advanced_open && !app.send_open {
        egui::ScrollArea::vertical()
            .id_salt("review-image")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                preview(app, ui);
                ui.add_space(8.0);
                muted(ui, &app.status);
            });
        return;
    }
    if ui.available_width() >= 720.0 {
        let rect = ui.max_rect();
        let left_width = (rect.width() - 20.0) * 0.56;
        let left = Rect::from_min_size(rect.min, Vec2::new(left_width, rect.height()));
        let right = Rect::from_min_max(Pos2::new(left.max.x + 20.0, rect.min.y), rect.max);
        region(ui, left, |ui| {
            egui::ScrollArea::vertical()
                .id_salt("preview-column")
                .auto_shrink([false, false])
                .show(ui, |ui| preview(app, ui));
        });
        region(ui, right, |ui| {
            egui::ScrollArea::vertical()
                .id_salt("delivery-column")
                .auto_shrink([false, false])
                .show(ui, |ui| delivery(app, ui, action));
        });
    } else {
        egui::ScrollArea::vertical()
            .id_salt("review-stacked")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                preview(app, ui);
                ui.add_space(16.0);
                delivery(app, ui, action);
            });
    }
}
fn preview(app: &mut App, ui: &mut Ui) {
    heading(ui, "Review crop");
    muted(ui, "This is the image you will copy.");
    ui.add_space(4.0);
    card().show(ui, |ui| {
        ui.set_min_width(ui.available_width());
        ui.horizontal_wrapped(|ui| {
            ui.label(RichText::new("Preview").strong());
            ui.selectable_value(&mut app.preview_native, false, "Fit");
            ui.selectable_value(&mut app.preview_native, true, "1:1 pixels");
        });
        if let (Some(texture), Some(crop)) = (&app.texture, &app.crop) {
            let native = texture.size_vec2() / ui.ctx().pixels_per_point();
            let height = if app.advanced_open || app.send_open {
                240.0
            } else {
                (ui.available_height() - 112.0).clamp(120.0, 420.0)
            };
            Frame::new()
                .fill(FIELD)
                .corner_radius(8)
                .inner_margin(10)
                .show(ui, |ui| {
                    if app.preview_native {
                        egui::ScrollArea::both()
                            .id_salt("native-pixel-preview")
                            .max_height(height)
                            .auto_shrink([false, false])
                            .show(ui, |ui| {
                                ui.image((texture.id(), native));
                            });
                    } else {
                        let size = fit_size(native, Vec2::new(ui.available_width(), height));
                        let (rect, _) = ui.allocate_exact_size(
                            Vec2::new(ui.available_width(), height),
                            Sense::hover(),
                        );
                        ui.painter().image(
                            texture.id(),
                            Rect::from_center_size(rect.center(), size),
                            Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0)),
                            Color32::WHITE,
                        );
                    }
                });
            muted(
                ui,
                format!("{} × {} pixels · original crop", crop.width, crop.height),
            );
        } else {
            muted(
                ui,
                "The reviewed image is unavailable. Cancel and capture again.",
            );
        }
    });
    ui.add_space(6.0);
    muted(ui, "Your screenshot keeps its original pixels.");
}
fn stage_blocked(app: &App) -> Option<&'static str> {
    if app.discovering {
        Some("Wait for pane discovery to finish.")
    } else if !app.settings.connection.paste_confirmed {
        Some("Confirm the agent's Ctrl+V image binding in Settings to enable Stage.")
    } else if app.selected.and_then(|i| app.routes.get(i)).is_none() {
        Some("Select an exact destination to enable Stage. Copy works without one.")
    } else if model::stage_input(&app.note).is_err() {
        Some("Fix the note before staging. Copy still copies only the image.")
    } else {
        None
    }
}
fn delivery(app: &mut App, ui: &mut Ui, action: &mut Action) {
    if app.send_open {
        window_picker(app, ui, action);
        return;
    }
    heading(ui, "Send to your session");
    muted(ui, "Optional · local WezTerm only");
    ui.add_space(4.0);
    card().show(ui, |ui| {
        ui.set_min_width(ui.available_width());
        ui.horizontal_wrapped(|ui| {
            ui.label(RichText::new("Destination").strong());
            if ui.add_enabled(!app.discovering, Button::new(if app.discovering { "Finding panes…" } else { "Refresh panes" })).clicked() {
                *action = Action::Discover;
            }
        });
        if app.routes.is_empty() {
            muted(ui, if app.discovering { "Reading the configured instance. Nothing has been delivered." } else { "No destination selected. Connect WezTerm, then refresh and choose the coding-agent pane." });
            if ui.button("Connection settings").clicked() { app.settings_open = true; }
        } else {
            egui::ScrollArea::vertical().id_salt("exact-destinations").max_height(180.0).show(ui, |ui| {
                for (index, destination) in app.routes.iter().enumerate() {
                    let selected = app.selected == Some(index);
                    let title = if destination.title.is_empty() { "Untitled pane" } else { &destination.title };
                    let label = format!("{}{}\nPane {} · Window {}\n{}", if selected { "Selected · " } else { "" }, title, destination.pane_id, destination.window_id, destination.workspace);
                    if ui.add_sized([ui.available_width(), 0.0], Button::new(label).wrap().selected(selected)).clicked() {
                        app.selected = Some(index);
                    }
                }
            });
        }
        if !app.settings.connection.paste_confirmed {
            muted(ui, "Stage needs your confirmation that Ctrl+V attaches an image without submitting.");
        }
    });
    ui.add_space(12.0);
    card().show(ui, |ui| {
        ui.set_min_width(ui.available_width());
        ui.label(RichText::new("Note").strong());
        muted(ui, "Optional · one line · included only with Stage");
        ui.add(
            egui::TextEdit::singleline(&mut app.note)
                .margin(egui::Margin::symmetric(9, 8))
                .id(egui::Id::new("stage-note"))
                .desired_width(f32::INFINITY)
                .char_limit(4096)
                .hint_text("What should the agent look at?"),
        );
        if let Err(error) = model::stage_input(&app.note) {
            ui.add(Label::new(RichText::new(error).color(ERROR)).wrap());
        } else if !app.note.is_empty() {
            muted(ui, format!("{} / 4096 UTF-8 bytes", app.note.len()));
        }
    });
    ui.add_space(10.0);
    muted(ui, &app.status);
}
fn window_picker(app: &mut App, ui: &mut Ui, action: &mut Action) {
    heading(ui, "Send to your session");
    ui.horizontal_wrapped(|ui| {
        muted(ui, "Choose its window.");
        if ui.button("Refresh windows").clicked() {
            *action = Action::ChooseWindow;
        }
    });
    ui.add_space(6.0);
    card().show(ui, |ui| {
        ui.set_min_width(ui.available_width());
        ui.add(
            egui::TextEdit::singleline(&mut app.window_filter)
                .hint_text("Find an app or window…")
                .desired_width(f32::INFINITY),
        );
        let query = app.window_filter.to_lowercase();
        egui::ScrollArea::vertical()
            .id_salt("session-windows")
            .max_height(180.0)
            .show(ui, |ui| {
                for (index, target) in app.windows.iter().enumerate() {
                    let label = format!("{}\n{}", target.application, target.title);
                    if !label.to_lowercase().contains(&query) {
                        continue;
                    }
                    if ui
                        .add_sized(
                            [ui.available_width(), 0.0],
                            Button::new(label)
                                .wrap()
                                .selected(app.selected_window == Some(index)),
                        )
                        .clicked()
                    {
                        app.selected_window = Some(index);
                    }
                }
            });
        if app.windows.is_empty() {
            muted(ui, &app.status);
        }
    });
    ui.add_space(10.0);
    ui.label(RichText::new("Note · optional").strong());
    ui.add(
        egui::TextEdit::singleline(&mut app.note)
            .margin(egui::Margin::symmetric(9, 8))
            .id(egui::Id::new("send-note"))
            .desired_width(f32::INFINITY)
            .char_limit(4096)
            .hint_text("What should the agent look at?"),
    );
    if let Err(error) = model::stage_input(&app.note) {
        muted(ui, error);
    }
    ui.add_space(8.0);
    muted(
        ui,
        "Pastes into the window's active tab or pane. Select that session there first. Enter is never sent.",
    );
    muted(
        ui,
        "Saves a local PNG for your agent to read. Remote and WSL sessions need access to that file.",
    );
    if !app.windows.is_empty() {
        muted(ui, &app.status);
    }
}
fn settings(app: &mut App, ui: &mut Ui, action: &mut Action) {
    heading(ui, "Settings");
    muted(
        ui,
        "Choose your capture shortcut. No terminal configuration is needed to send or copy.",
    );
    ui.add_space(8.0);
    card().show(ui, |ui| {
        ui.set_min_width(ui.available_width());
        ui.label(RichText::new("Capture shortcut").size(18.0).strong());
        ui.add_enabled_ui(!capture::is_wayland(), |ui| {
            ui.horizontal_wrapped(|ui| {
                ui.add(egui::TextEdit::singleline(&mut app.settings.shortcut).margin(egui::Margin::symmetric(9, 8)).desired_width(250.0));
                if ui.button("Apply shortcut").clicked() { *action = Action::ApplyShortcut; }
            });
        });
        muted(ui, &app.shortcut_status);
        if capture::is_wayland() {
            muted(ui, "Wayland shortcuts are managed by the desktop portal. Capture remains available in the app.");
        }
        muted(ui, "In the app: F8 capture · F6 copy reviewed image · F10 settings · Esc back or cancel.");
    });
    ui.add_space(12.0);
    egui::CollapsingHeader::new("Advanced: WezTerm integration")
        .id_salt("advanced-connection")
        .show(ui, |ui| {
    card().show(ui, |ui| {
        ui.set_min_width(ui.available_width());
        ui.label(RichText::new("WezTerm connection").size(18.0).strong());
        muted(ui, "Choose a local coding agent using the same OS clipboard. Do not select a shell, SSH session or WSL agent.");
        ui.label("WezTerm executable · absolute path");
        let executable = ui.add(egui::TextEdit::singleline(&mut app.settings.connection.executable).margin(egui::Margin::symmetric(9, 8)).id(egui::Id::new("wezterm-executable")).desired_width(f32::INFINITY)).changed();
        ui.label("Instance socket · exact WEZTERM_UNIX_SOCKET value");
        let socket = ui.add(egui::TextEdit::singleline(&mut app.settings.connection.socket).margin(egui::Margin::symmetric(9, 8)).id(egui::Id::new("wezterm-socket")).desired_width(f32::INFINITY)).changed();
        if executable || socket {
            app.routes.clear();
            app.selected = None;
            app.settings.connection.paste_confirmed = false;
        }
        ui.checkbox(&mut app.settings.connection.paste_confirmed, "I verified that Ctrl+V attaches an image in my agent and does not submit.");
        muted(ui, "Pane titles are labels, not routing identities. Copy works without a connection.");
        if ui.button("Save connection").clicked() { *action = Action::SaveSettings; }
    });
    ui.add_space(12.0);
        });
    ui.add_space(12.0);
    muted(ui, &app.status);
}
fn footer(app: &mut App, ui: &mut Ui, action: &mut Action) {
    ui.separator();
    ui.add_space(6.0);
    if app.settings_open {
        if ui
            .button(if app.flow.phase() == Phase::Review {
                "Back to review"
            } else {
                "Back to capture"
            })
            .clicked()
        {
            app.settings_open = false;
        }
        muted(ui, "Going back keeps your current capture.");
        return;
    }
    match app.flow.phase() {
        Phase::Review => {
            ui.horizontal_wrapped(|ui| {
                if !app.advanced_open {
                    if app.send_open {
                        if ui
                            .add_enabled(
                                app.selected_window.is_some()
                                    && model::stage_input(&app.note).is_ok(),
                                primary("Send · no submit"),
                            )
                            .clicked()
                        {
                            *action = Action::Send;
                        }
                    } else if ui.add(primary("Send to…")).clicked() {
                        *action = Action::ChooseWindow;
                    }
                }
                if ui.button("Copy image  F6").clicked() {
                    *action = Action::Copy;
                }
                if ui
                    .button("Copy file path")
                    .on_hover_text("Save a local PNG and copy its path for your terminal or agent.")
                    .clicked()
                {
                    *action = Action::CopyPath;
                }
                if app.advanced_open {
                    let blocked = stage_blocked(app);
                    if ui
                        .add_enabled(blocked.is_none(), Button::new("Stage in WezTerm"))
                        .on_disabled_hover_text(blocked.unwrap_or_default())
                        .clicked()
                    {
                        *action = Action::Stage;
                    }
                }
                if ui.button("Cancel").clicked() {
                    *action = Action::Cancel;
                }
            });
            if app.advanced_open {
                if let Some(blocked) = stage_blocked(app) {
                    muted(ui, blocked);
                }
            } else {
                muted(
                    ui,
                    "Send pastes a saved image path. Copy image keeps the screenshot on the clipboard.",
                );
            }
        }
        Phase::Idle | Phase::Result => {
            ui.horizontal_wrapped(|ui| {
                if ui.add(primary("Capture region  F8")).clicked() {
                    *action = Action::Capture;
                }
                if app.flow.phase() == Phase::Result
                    && app.reveal.is_some()
                    && ui
                        .add_enabled(
                            !app.revealing,
                            Button::new(if app.revealing {
                                "Revealing…"
                            } else {
                                "Reveal destination"
                            }),
                        )
                        .clicked()
                {
                    *action = Action::Reveal;
                }
            });
            muted(
                ui,
                "Nothing is sent until you choose Send. ScreenFling never submits your prompt.",
            );
        }
        Phase::Capturing => {
            if ui.button("Cancel capture").clicked() {
                *action = Action::Cancel;
            }
            muted(ui, "Cancellation leaves the existing clipboard unchanged.");
        }
        Phase::Delivering => muted(
            ui,
            "Sending is pending. Controls return when the result is known.",
        ),
        Phase::Selecting => {}
    }
}
fn corner_mark(ui: &Ui, rect: Rect, color: Color32) {
    let length = rect.width() * 0.3;
    for (corner, dx, dy) in [
        (rect.left_top(), 1.0, 1.0),
        (rect.right_top(), -1.0, 1.0),
        (rect.left_bottom(), 1.0, -1.0),
        (rect.right_bottom(), -1.0, -1.0),
    ] {
        ui.painter().line_segment(
            [corner + Vec2::new(dx * length, 0.0), corner],
            Stroke::new(2.5_f32, color),
        );
        ui.painter().line_segment(
            [corner, corner + Vec2::new(0.0, dy * length)],
            Stroke::new(2.5_f32, color),
        );
    }
}
pub(super) fn selection_hint(ui: &Ui, screen: Rect) {
    let text = if screen.width() < 580.0 {
        "Drag a region\nSpace: whole display · Esc: cancel"
    } else {
        "Drag a region  ·  Space: whole display  ·  Esc: cancel"
    };
    let galley = ui.painter().layout(
        text.into(),
        FontId::proportional(14.0),
        TEXT,
        (screen.width() - 64.0).max(64.0),
    );
    let rect = Rect::from_center_size(
        Pos2::new(
            screen.center().x,
            screen.min.y + 16.0 + (galley.size().y + 20.0) / 2.0,
        ),
        galley.size() + Vec2::new(28.0, 20.0),
    );
    ui.painter().rect_filled(rect, 10.0, BACKGROUND);
    ui.painter().rect_stroke(
        rect,
        10.0,
        Stroke::new(1.0_f32, BORDER),
        egui::StrokeKind::Inside,
    );
    ui.painter()
        .galley(rect.min + Vec2::new(14.0, 10.0), galley, TEXT);
}
pub(super) fn selection_badge(ui: &Ui, selection: Rect, image: Rect, pixels: [u32; 2]) {
    let Action::Crop(rect, size) = crop_action(selection, image) else {
        return;
    };
    let Ok(crop) = model::map_crop(rect, size, pixels) else {
        return;
    };
    let galley = ui.painter().layout_no_wrap(
        format!("{} × {} px", crop.width, crop.height),
        FontId::monospace(13.0),
        TEXT,
    );
    let size = galley.size() + Vec2::new(20.0, 14.0);
    let x = (selection.max.x - size.x).clamp(image.min.x, (image.max.x - size.x).max(image.min.x));
    let y = if selection.max.y + 8.0 + size.y <= image.max.y {
        selection.max.y + 8.0
    } else {
        (selection.min.y - size.y - 8.0).max(image.min.y)
    };
    let rect = Rect::from_min_size(Pos2::new(x, y), size);
    ui.painter().rect_filled(rect, 6.0, BACKGROUND);
    ui.painter()
        .galley(rect.min + Vec2::new(10.0, 7.0), galley, TEXT);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readable_palette_and_reserved_actions() {
        fn luminance(c: Color32) -> f32 {
            let linear = |v: u8| {
                let s = v as f32 / 255.0;
                if s <= 0.04045 {
                    s / 12.92
                } else {
                    ((s + 0.055) / 1.055).powf(2.4)
                }
            };
            0.2126 * linear(c.r()) + 0.7152 * linear(c.g()) + 0.0722 * linear(c.b())
        }
        for (fg, bg, minimum) in [
            (TEXT, SURFACE, 4.5),
            (MUTED, SURFACE, 4.5),
            (MUTED, BACKGROUND, 4.5),
            (INK, ACCENT, 4.5),
            (TEXT, ACCENT_DARK, 4.5),
            (ERROR, SURFACE, 4.5),
            (BORDER, FIELD, 3.0),
        ] {
            let a = luminance(fg);
            let b = luminance(bg);
            assert!((a.max(b) + 0.05) / (a.min(b) + 0.05) >= minimum);
        }
        for size in [
            Vec2::new(640.0, 480.0),
            Vec2::new(1000.0, 740.0),
            Vec2::new(1280.0, 800.0),
            Vec2::new(500.0, 370.0),
        ] {
            for settings in [true, false] {
                let screen = Rect::from_min_size(Pos2::ZERO, size);
                let [header, _, body, footer] = regions(screen, settings);
                assert!(
                    screen.contains_rect(header)
                        && screen.contains_rect(body)
                        && screen.contains_rect(footer)
                );
                assert!(header.max.y < body.min.y && body.max.y < footer.min.y);
            }
        }
    }

    #[test]
    fn settings_escape_preserves_review_and_copy_stays_explicit() {
        let ctx = egui::Context::default();
        configure(&ctx);
        let mut app = App::new(
            Settings::default(),
            String::new(),
            desktop::Shortcut::default(),
            String::new(),
        );
        let id = app.flow.start().unwrap();
        app.flow
            .advance(id, Phase::Capturing, Phase::Selecting)
            .unwrap();
        app.flow
            .advance(id, Phase::Selecting, Phase::Review)
            .unwrap();
        app.settings_open = true;
        let mut action = Action::None;
        let key_input = |key| egui::RawInput {
            screen_rect: Some(Rect::from_min_size(Pos2::ZERO, Vec2::new(640.0, 480.0))),
            events: vec![egui::Event::Key {
                key,
                physical_key: None,
                pressed: true,
                repeat: false,
                modifiers: egui::Modifiers::NONE,
            }],
            ..Default::default()
        };
        let _ = ctx.run_ui(key_input(egui::Key::Escape), |ui| {
            action = show(&mut app, ui);
        });
        assert!(matches!(action, Action::None));
        assert!(!app.settings_open && app.flow.is_current(id, Phase::Review));
        let _ = ctx.run_ui(key_input(egui::Key::F6), |ui| {
            action = show(&mut app, ui);
        });
        assert!(matches!(action, Action::Copy));
        assert!(app.clipboard.is_none());
    }
}
