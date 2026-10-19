//! Presentation only. Clipboard, capture and input injection stay in App actions.
use super::*;
use egui::{
    Align2, Button, Color32, FontFamily, FontId, Frame, Label, RichText, Sense, Stroke, Ui, Vec2,
};
use screenfling::model;

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
const COPY_KEY: &str = if cfg!(target_os = "macos") {
    "Cmd+C"
} else {
    "Ctrl+C"
};

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
        style.spacing.button_padding = Vec2::new(14.0, 9.0);
        style.spacing.interact_size = Vec2::new(36.0, 36.0);
        style.visuals.panel_fill = BACKGROUND;
        style.visuals.window_fill = SURFACE;
        style.visuals.extreme_bg_color = FIELD;
        style.visuals.faint_bg_color = SURFACE;
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
fn primary(text: &str) -> Button<'_> {
    Button::new(RichText::new(text).color(INK).strong()).fill(ACCENT)
}

pub(super) fn show(app: &mut App, ui: &mut Ui) -> Action {
    if let Stage::Selecting(selection) = &mut app.stage {
        return select(selection, &app.status, ui);
    }
    if ui.input(|i| i.key_pressed(egui::Key::Escape)) {
        return match app.stage {
            Stage::Idle => Action::Hide,
            Stage::Capturing { .. } => Action::Cancel,
            _ => Action::None,
        };
    }
    home(app, ui)
}

fn home(app: &mut App, ui: &mut Ui) -> Action {
    let mut action = Action::None;
    let idle = matches!(app.stage, Stage::Idle);
    let editing = ui.ctx().egui_wants_keyboard_input();
    if idle && !editing && ui.input(|i| i.key_pressed(egui::Key::F8)) {
        action = Action::Capture;
    }
    ui.painter().rect_filled(ui.max_rect(), 0.0, BACKGROUND);
    Frame::new().inner_margin(24).show(ui, |ui| {
        ui.horizontal(|ui| {
            let (mark, _) = ui.allocate_exact_size(Vec2::splat(28.0), Sense::hover());
            corner_mark(ui, mark.shrink(3.0), ACCENT);
            ui.label(RichText::new("ScreenFling").size(22.0).strong().color(TEXT));
        });
        muted(
            ui,
            "Select part of the screen, then copy it or send it straight back to the app you came from.",
        );
        ui.add_space(4.0);
        ui.add_enabled_ui(idle, |ui| {
            if ui
                .add(primary("Capture region   F8").min_size(Vec2::new(200.0, 40.0)))
                .clicked()
            {
                action = Action::Capture;
            }
        });
        if !app.status.is_empty() {
            ui.add(Label::new(RichText::new(&app.status).color(TEXT)).wrap());
        }
        ui.add_space(8.0);
        ui.separator();
        ui.label(RichText::new("Capture shortcut").strong());
        ui.add_enabled_ui(idle && !capture::is_wayland(), |ui| {
            ui.horizontal_wrapped(|ui| {
                ui.add(
                    egui::TextEdit::singleline(&mut app.settings.shortcut)
                        .margin(egui::Margin::symmetric(9, 8))
                        .desired_width(240.0),
                );
                if ui.button("Apply").clicked() {
                    action = Action::ApplyShortcut;
                }
            });
        });
        muted(ui, &app.shortcut_status);
        muted(
            ui,
            format!(
                "Selecting: drag · Space whole display · Enter send or copy · {COPY_KEY} copy · Esc cancel"
            ),
        );
        if capture::is_wayland() {
            muted(ui, "Wayland apps cannot return focus to another window, so Send is unavailable. Copy works everywhere.");
        }
        ui.add_space(8.0);
        ui.horizontal(|ui| {
            if app.tray_available && ui.button("Hide to tray").clicked() {
                action = Action::Hide;
            }
            if ui.button("Quit").clicked() {
                action = Action::Quit;
            }
        });
    });
    action
}

fn select(selection: &mut Selection, status: &str, ui: &mut Ui) -> Action {
    let screen = ui.max_rect();
    // Anchored at the origin: the overlay starts at the display's corner, and
    // centering would offset a 1:1 image by half a pixel when sizes differ.
    let image = Rect::from_min_size(
        screen.min,
        fit(selection.texture.size_vec2(), screen.size()),
    );
    let pixels = [selection.pixels.width, selection.pixels.height];
    let painter = ui.painter();
    painter.rect_filled(screen, 0.0, Color32::BLACK);
    painter.image(
        selection.texture.id(),
        image,
        Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0)),
        Color32::WHITE,
    );
    let response = ui
        .interact(image, ui.id().with("frozen-display"), Sense::drag())
        .on_hover_cursor(egui::CursorIcon::Crosshair);
    if response.drag_started() {
        selection.armed = None;
        selection.anchor = ui
            .input(|i| i.pointer.press_origin())
            .map(|p| p.clamp(image.min, image.max));
    }
    if let (Some(anchor), Some(pointer)) =
        (selection.anchor, ui.input(|i| i.pointer.interact_pos()))
    {
        selection.region = Some(Rect::from_two_pos(
            anchor,
            pointer.clamp(image.min, image.max),
        ));
    }
    if response.drag_stopped() {
        selection.anchor = None;
        selection.region = selection.region.filter(|r| r.area() > 0.0);
    }
    let dragging = selection.anchor.is_some();
    if !dragging && ui.input(|i| i.key_pressed(egui::Key::Space)) {
        selection.region = Some(image);
    }
    let crop = selection
        .region
        .and_then(|region| crop_for(region, image, pixels).ok());
    let target = selection.target.as_ref();
    let (escape, copy, enter) = ui.input(|i| {
        (
            i.key_pressed(egui::Key::Escape),
            i.events.iter().any(|e| matches!(e, egui::Event::Copy)),
            i.key_pressed(egui::Key::Enter),
        )
    });
    if escape {
        selection.armed = Some(Intent::Cancel);
    } else if !dragging && crop.is_some() {
        if copy {
            selection.armed = Some(Intent::Deliver(Delivery::Copy));
        } else if enter {
            selection.armed = Some(Intent::Deliver(if target.is_some() {
                Delivery::Send
            } else {
                Delivery::Copy
            }));
        }
    }
    let mut action = Action::None;
    // Act only once every key is up, so nothing held or auto-repeating reaches
    // the window that gets focus next. Each key-up wakes the event loop.
    if desktop::keys_released() {
        match (selection.armed.take(), crop) {
            (Some(Intent::Cancel), _) => action = Action::Cancel,
            (Some(Intent::Deliver(delivery)), Some(crop)) => {
                action = Action::Deliver(delivery, crop)
            }
            _ => {}
        }
    }
    if let (Some(region), Some(crop)) = (selection.region, crop) {
        outline(ui, region, image);
        if let Some(clicked) = toolbar(ui, region, image, crop, target, dragging) {
            action = Action::Deliver(clicked, crop);
        }
    }
    hint(ui, screen, status);
    action
}

/// Overlay points to captured pixels, using the image's real size rather than
/// an assumed display scale.
fn crop_for(region: Rect, image: Rect, pixels: [u32; 2]) -> Result<Crop> {
    // Widen before subtracting: rounded f32 extents can put a valid edge
    // selection one ulp outside the image once map_crop adds origin and width.
    model::map_crop(
        [
            region.min.x as f64 - image.min.x as f64,
            region.min.y as f64 - image.min.y as f64,
            region.max.x as f64 - region.min.x as f64,
            region.max.y as f64 - region.min.y as f64,
        ],
        [
            image.max.x as f64 - image.min.x as f64,
            image.max.y as f64 - image.min.y as f64,
        ],
        pixels,
    )
}

fn fit(source: Vec2, available: Vec2) -> Vec2 {
    source
        * (available.x / source.x)
            .min(available.y / source.y)
            .clamp(0.001, 1.0)
}

fn outline(ui: &Ui, region: Rect, image: Rect) {
    let painter = ui.painter();
    let dim = Color32::from_black_alpha(115);
    for rect in [
        Rect::from_min_max(image.min, Pos2::new(image.max.x, region.min.y)),
        Rect::from_min_max(Pos2::new(image.min.x, region.max.y), image.max),
        Rect::from_min_max(
            Pos2::new(image.min.x, region.min.y),
            Pos2::new(region.min.x, region.max.y),
        ),
        Rect::from_min_max(
            Pos2::new(region.max.x, region.min.y),
            Pos2::new(image.max.x, region.max.y),
        ),
    ] {
        painter.rect_filled(rect, 0.0, dim);
    }
    // The two-tone edge stays visible on both light and dark captures.
    painter.rect_stroke(
        region,
        0.0,
        Stroke::new(3.0_f32, Color32::BLACK),
        egui::StrokeKind::Outside,
    );
    painter.rect_stroke(
        region,
        0.0,
        Stroke::new(1.5_f32, Color32::WHITE),
        egui::StrokeKind::Inside,
    );
}

/// Size while dragging; the actions once the region is chosen. Placed below the
/// region, above it when there is no room, or inside it for a full-display region.
fn toolbar(
    ui: &Ui,
    region: Rect,
    image: Rect,
    crop: Crop,
    target: Option<&send::Target>,
    dragging: bool,
) -> Option<Delivery> {
    const GAP: f32 = 8.0;
    const HEIGHT: f32 = 52.0;
    let (anchor, pivot) = if region.max.y + GAP + HEIGHT <= image.max.y {
        (
            Pos2::new(region.max.x, region.max.y + GAP),
            Align2::RIGHT_TOP,
        )
    } else if region.min.y - GAP - HEIGHT >= image.min.y {
        (
            Pos2::new(region.max.x, region.min.y - GAP),
            Align2::RIGHT_BOTTOM,
        )
    } else {
        (region.max - Vec2::splat(12.0), Align2::RIGHT_BOTTOM)
    };
    let mut clicked = None;
    egui::Area::new(ui.id().with("selection-toolbar"))
        .order(egui::Order::Foreground)
        .fixed_pos(anchor)
        .pivot(pivot)
        .constrain_to(image)
        .show(ui.ctx(), |ui| {
            Frame::new()
                .fill(BACKGROUND)
                .stroke(Stroke::new(1.0_f32, BORDER))
                .corner_radius(10)
                .inner_margin(6)
                .show(ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.label(
                            RichText::new(format!("{} × {}", crop.width, crop.height))
                                .monospace()
                                .color(MUTED),
                        );
                        if dragging {
                            return;
                        }
                        let copy = match target {
                            Some(_) => format!("Copy  {COPY_KEY}"),
                            None => "Copy  Enter".to_owned(),
                        };
                        let copy = if target.is_some() {
                            ui.button(copy)
                        } else {
                            ui.add(primary(&copy))
                        };
                        if copy.clicked() {
                            clicked = Some(Delivery::Copy);
                        }
                        if let Some(target) = target
                            && ui
                                .add(primary(&format!("Send to {}  Enter", target.application)))
                                .on_hover_text(format!(
                                    "Return to {} and press {} once. Nothing is submitted.",
                                    target.application,
                                    target.chord()
                                ))
                                .clicked()
                        {
                            clicked = Some(Delivery::Send);
                        }
                    });
                });
        });
    clicked
}

fn hint(ui: &Ui, screen: Rect, status: &str) {
    let text = if status.is_empty() {
        "Drag a region  ·  Space whole display  ·  Esc cancel".to_owned()
    } else {
        status.to_owned()
    };
    let color = if status.is_empty() { TEXT } else { ERROR };
    let galley = ui.painter().layout(
        text,
        FontId::proportional(14.0),
        color,
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
        .galley(rect.min + Vec2::new(14.0, 10.0), galley, color);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fractional_scale_edge_selection_stays_in_bounds() {
        let image = Rect::from_min_max(Pos2::ZERO, Pos2::new(640.0, 400.0));
        let region = Rect::from_min_max(Pos2::new(4.0 / 3.0, 2.0 / 3.0), image.max);
        assert_eq!(
            crop_for(region, image, [960, 600]).unwrap(),
            Crop {
                x: 2,
                y: 1,
                width: 958,
                height: 599,
            }
        );
        // The whole image maps to every captured pixel.
        assert_eq!(
            crop_for(image, image, [960, 600]).unwrap(),
            Crop {
                x: 0,
                y: 0,
                width: 960,
                height: 600,
            }
        );
    }
}
