use crate::{
    clipboard::Clipboard,
    desktop,
    settings::Settings,
    wezterm::{self, Destination},
};
use egui_sdl3::egui::{self, Color32, Pos2, Rect, Sense, TextureHandle, Vec2};
use screenfling::{
    capture::{self, Captured},
    model::{self, Flow, Phase, Pixels, Result},
};
use sdl3::video::Window;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

pub enum Message {
    Capture,
    Open,
    Quit,
    Shortcut(u32),
    Captured(u64, Result<Captured>),
    Destinations(u64, wezterm::ConnectionSettings, Result<Vec<Destination>>),
    VerifyClipboard(u64, mpsc::SyncSender<bool>),
    Staged(u64, Destination, Result<String>),
    Revealed(u64, Result<String>),
    #[cfg(target_os = "linux")]
    ShortcutStatus(String),
}
#[derive(Default)]
pub enum Action {
    #[default]
    None,
    Capture,
    Cancel,
    Crop([f64; 4], [f64; 2]),
    Copy,
    Discover,
    Stage,
    Reveal,
    SaveSettings,
    ApplyShortcut,
    Hide,
    Quit,
}
pub struct App {
    pub flow: Flow,
    pub settings: Settings,
    saved_settings: Settings,
    pub status: String,
    pub shortcut_status: String,
    pub shortcut: desktop::Shortcut,
    full: Option<Captured>,
    crop: Option<Pixels>,
    texture: Option<TextureHandle>,
    note: String,
    anchor: Option<Pos2>,
    selection: Option<Rect>,
    routes: Vec<Destination>,
    selected: Option<usize>,
    reveal: Option<Destination>,
    clipboard: Option<Clipboard>,
    worker: Option<JoinHandle<()>>,
    cancelled: Arc<AtomicBool>,
    capture_due: Option<(Instant, [i32; 2])>,
    restore: [i32; 4],
    settings_open: bool,
    discovering: bool,
    revealing: bool,
    show_after_paint: bool,
    pub tray_available: bool,
    pub quit: bool,
}
impl App {
    pub fn new(
        settings: Settings,
        status: String,
        shortcut: desktop::Shortcut,
        shortcut_status: String,
    ) -> Self {
        Self {
            flow: Flow::default(),
            saved_settings: settings.clone(),
            settings,
            status,
            shortcut_status,
            shortcut,
            full: None,
            crop: None,
            texture: None,
            note: String::new(),
            anchor: None,
            selection: None,
            routes: Vec::new(),
            selected: None,
            reveal: None,
            clipboard: None,
            worker: None,
            cancelled: Arc::new(AtomicBool::new(false)),
            capture_due: None,
            restore: [100, 100, 820, 680],
            settings_open: false,
            discovering: false,
            revealing: false,
            show_after_paint: false,
            tray_available: false,
            quit: false,
        }
    }
    fn reap(&mut self) -> bool {
        if self.worker.as_ref().is_some_and(JoinHandle::is_finished)
            && let Some(worker) = self.worker.take()
        {
            let _ = worker.join();
        }
        self.worker.is_none()
    }
    fn spawn(&mut self, work: impl FnOnce() + Send + 'static) -> Result<()> {
        if !self.reap() {
            return Err(
                "The previous operation is still ending. No new operation was started.".into(),
            );
        }
        self.worker = Some(
            std::thread::Builder::new()
                .name("screenfling-action".into())
                .spawn(work)
                .map_err(|_| "Could not start the desktop operation.")?,
        );
        Ok(())
    }
    fn clear_images(&mut self) {
        self.full = None;
        self.crop = None;
        self.texture = None;
        self.note.clear();
        self.anchor = None;
        self.selection = None;
    }
    fn load_texture(&mut self, ctx: &egui::Context, pixels: &Pixels) {
        self.texture = Some(ctx.load_texture(
            "reviewed-capture",
            egui::ColorImage::from_rgba_unmultiplied(
                [pixels.width as usize, pixels.height as usize],
                &pixels.rgba,
            ),
            egui::TextureOptions::LINEAR,
        ));
    }
    pub fn next_deadline(&self) -> Option<Instant> {
        self.capture_due.map(|(when, _)| when)
    }
    pub fn tick(&mut self) {
        if let Some((when, pointer)) = self.capture_due
            && Instant::now() >= when
        {
            self.capture_due = None;
            let id = self.flow.generation();
            let cancelled = self.cancelled.clone();
            if let Err(error) = self.spawn(move || {
                desktop::post(Message::Captured(id, capture::capture(pointer, &cancelled)));
            }) {
                desktop::post(Message::Captured(id, Err(error)));
            }
        }
        self.reap();
    }
    pub fn after_paint(&mut self, window: &mut Window) {
        if self.show_after_paint {
            self.show_after_paint = false;
            window.show();
            window.raise();
        }
    }
    fn normal_window(&mut self, window: &mut Window) {
        desktop::restore(window, self.restore);
        self.show_after_paint = true;
    }
    pub fn topology_changed(&mut self, window: &mut Window) {
        if matches!(
            self.flow.phase(),
            Phase::Capturing | Phase::Selecting | Phase::Review
        ) {
            self.cancel(window);
            self.status = "The display layout changed. The capture was cancelled; the clipboard was not changed.".into();
        }
    }
    fn cancel(&mut self, window: &mut Window) {
        if self.flow.cancel(self.flow.generation()) {
            self.cancelled.store(true, Ordering::Release);
            self.capture_due = None;
            self.clear_images();
            self.routes.clear();
            self.selected = None;
            self.discovering = false;
            self.status = "Capture cancelled. The clipboard was not changed.".into();
            self.normal_window(window);
        }
    }
    pub fn message(&mut self, message: Message, ctx: &egui::Context, window: &mut Window) {
        match message {
            Message::Capture => self.action(Action::Capture, ctx, window),
            Message::Shortcut(id) if self.shortcut.accepts(id) => {
                self.action(Action::Capture, ctx, window)
            }
            Message::Shortcut(_) => {}
            Message::Open => {
                // Do not expose our window while the pending frame is captured.
                if self.flow.phase() != Phase::Capturing {
                    window.show();
                    window.raise();
                }
            }
            Message::Quit => self.action(Action::Quit, ctx, window),
            Message::Captured(id, result) if self.flow.is_current(id, Phase::Capturing) => {
                match result {
                    Ok(captured) => {
                        if self
                            .flow
                            .advance(id, Phase::Capturing, Phase::Selecting)
                            .is_err()
                        {
                            return;
                        }
                        self.load_texture(ctx, &captured.pixels);
                        if let Err(error) = desktop::overlay(window, captured.bounds) {
                            self.flow.fail(id);
                            self.clear_images();
                            self.status = error;
                            self.normal_window(window);
                            return;
                        }
                        self.full = Some(captured);
                        self.show_after_paint = true;
                    }
                    Err(error) => {
                        self.flow.fail(id);
                        self.status = error;
                        self.normal_window(window);
                    }
                }
            }
            Message::Destinations(id, connection, result) => {
                self.finish_discovery(id, connection, result);
            }
            Message::VerifyClipboard(id, reply) => {
                let matches = self.flow.is_current(id, Phase::Delivering)
                    && self
                        .crop
                        .as_ref()
                        .zip(self.clipboard.as_mut())
                        .is_some_and(|(crop, clipboard)| clipboard.matches(crop));
                let _ = reply.try_send(matches);
            }
            Message::Staged(id, destination, result)
                if self.flow.is_current(id, Phase::Delivering) =>
            {
                let _ = self.flow.advance(id, Phase::Delivering, Phase::Result);
                self.reveal = Some(destination);
                self.status = result.unwrap_or_else(|error| error);
                self.clear_images();
            }
            Message::Revealed(id, result) if self.flow.is_current(id, Phase::Result) => {
                self.revealing = false;
                self.status = result.unwrap_or_else(|error| error);
            }
            #[cfg(target_os = "linux")]
            Message::ShortcutStatus(status) => self.shortcut_status = status,
            _ => {} // Stale work cannot mutate the workflow or clipboard.
        }
        ctx.request_repaint();
    }
    fn finish_discovery(
        &mut self,
        id: u64,
        connection: wezterm::ConnectionSettings,
        result: Result<Vec<Destination>>,
    ) {
        if !self.flow.is_current(id, Phase::Review) {
            return;
        }
        // A settings change invalidates the result, but must release the busy UI.
        // A result from an older capture must not release a newer request.
        self.discovering = false;
        self.routes.clear();
        self.selected = None;
        if connection != self.settings.connection {
            self.status =
                "Connection settings changed. Refresh panes to select a current destination."
                    .into();
            return;
        }
        match result {
            Ok(routes) => {
                self.routes = routes;
                self.status = if self.routes.is_empty() {
                    "No panes were found in the selected WezTerm instance.".into()
                } else {
                    "Select the exact coding-session pane. Nothing has been delivered.".into()
                };
            }
            Err(error) => self.status = error,
        }
    }
    pub fn action(&mut self, action: Action, ctx: &egui::Context, window: &mut Window) {
        if matches!(action, Action::None) {
            return;
        }
        if let Err(error) = self.try_action(action, ctx, window) {
            self.status = error;
        }
        ctx.request_repaint();
    }
    fn connection_settings_to_save(&self) -> Settings {
        let mut next = self.saved_settings.clone();
        next.connection = self.settings.connection.clone();
        next
    }
    fn shortcut_settings_to_save(&self) -> Settings {
        let mut next = self.saved_settings.clone();
        next.shortcut = self.settings.shortcut.clone();
        next
    }
    fn try_action(
        &mut self,
        action: Action,
        ctx: &egui::Context,
        window: &mut Window,
    ) -> Result<()> {
        let id = self.flow.generation();
        match action {
            Action::None => {}
            Action::Capture => {
                if !matches!(self.flow.phase(), Phase::Idle | Phase::Result) {
                    if self.flow.phase() != Phase::Capturing {
                        window.show();
                        window.raise();
                    }
                    return Ok(());
                }
                if !self.reap() {
                    return Err("The previous desktop operation is still ending.".into());
                }
                self.flow.start()?;
                self.clear_images();
                self.routes.clear();
                self.selected = None;
                self.reveal = None;
                self.discovering = false;
                self.revealing = false;
                self.cancelled = Arc::new(AtomicBool::new(false));
                self.restore = desktop::geometry(window);
                let pointer = desktop::pointer();
                window.hide();
                self.capture_due = Some((Instant::now() + Duration::from_millis(100), pointer));
                self.status = if capture::is_wayland() {
                    "Choose one display in the desktop sharing dialog.".into()
                } else {
                    "Capturing the display under the pointer…".into()
                };
            }
            Action::Cancel => self.cancel(window),
            Action::Crop(rect, size) if self.flow.phase() == Phase::Selecting => {
                let full = self
                    .full
                    .as_ref()
                    .ok_or("The captured image is no longer available.")?;
                let geometry =
                    model::map_crop(rect, size, [full.pixels.width, full.pixels.height])?;
                let crop = full.pixels.crop(geometry)?;
                self.flow.advance(id, Phase::Selecting, Phase::Review)?;
                self.full = None;
                self.load_texture(ctx, &crop);
                self.crop = Some(crop);
                self.anchor = None;
                self.selection = None;
                self.status = "Review this crop before copying or staging it.".into();
                self.normal_window(window);
            }
            Action::Copy if self.flow.phase() == Phase::Review => {
                if self.clipboard.is_none() {
                    self.clipboard = Some(Clipboard::new()?);
                }
                self.flow.advance(id, Phase::Review, Phase::Delivering)?;
                let result = self
                    .clipboard
                    .as_mut()
                    .ok_or("Clipboard unavailable.")?
                    .copy(
                        self.crop
                            .as_ref()
                            .ok_or("The reviewed crop is unavailable.")?,
                    );
                self.flow.advance(id, Phase::Delivering, Phase::Result)?;
                self.clear_images();
                self.status = match result { Ok(()) => "Image copied and verified. The optional note was not copied. Nothing was sent to a destination.".into(), Err(error) => error };
            }
            Action::Discover if self.flow.phase() == Phase::Review => {
                if !self.reap() {
                    return Err(
                        "Another desktop operation is still ending. Copy remains available.".into(),
                    );
                }
                self.routes.clear();
                self.selected = None;
                let connection = self.settings.connection.clone();
                self.spawn(move || {
                    let result = wezterm::discover(&connection);
                    desktop::post(Message::Destinations(id, connection, result));
                })?;
                self.discovering = true;
                self.status = "Reading panes from the configured WezTerm instance…".into();
            }
            Action::Stage if self.flow.phase() == Phase::Review => {
                if !self.reap() {
                    return Err(
                        "Another desktop operation is still ending. Nothing was staged.".into(),
                    );
                }
                if !self.settings.connection.paste_confirmed {
                    return Err("Confirm the coding agent's image-paste binding in connection settings first.".into());
                }
                model::stage_input(&self.note)?;
                let destination = self
                    .selected
                    .and_then(|i| self.routes.get(i))
                    .cloned()
                    .ok_or("Select an exact destination first.")?;
                if !destination.belongs_to(&self.settings.connection) {
                    return Err(
                        "The connection changed. Refresh and select the destination again.".into(),
                    );
                }
                if self.clipboard.is_none() {
                    self.clipboard = Some(Clipboard::new()?);
                }
                self.flow.advance(id, Phase::Review, Phase::Delivering)?;
                if let Err(error) = self
                    .clipboard
                    .as_mut()
                    .ok_or("Clipboard unavailable.")?
                    .copy(
                        self.crop
                            .as_ref()
                            .ok_or("The reviewed crop is unavailable.")?,
                    )
                {
                    self.flow.fail(id);
                    self.clear_images();
                    return Err(error);
                }
                let note = self.note.clone();
                let spawn = self.spawn(move || {
                    let result = wezterm::stage(&destination, &note, || {
                        let (tx, rx) = mpsc::sync_channel(1);
                        desktop::post(Message::VerifyClipboard(id, tx));
                        rx.recv_timeout(Duration::from_secs(2)).unwrap_or(false)
                    });
                    desktop::post(Message::Staged(id, destination, result));
                });
                if let Err(error) = spawn {
                    self.flow.fail(id);
                    self.clear_images();
                    return Err(error);
                }
                self.status = "Staging once, without submitting. Do not paste or retry while this operation is pending.".into();
            }
            Action::Reveal if self.flow.phase() == Phase::Result => {
                let destination = self
                    .reveal
                    .clone()
                    .ok_or("There is no staged destination to reveal.")?;
                self.spawn(move || {
                    desktop::post(Message::Revealed(id, wezterm::reveal(&destination)));
                })?;
                self.revealing = true;
            }
            Action::SaveSettings if self.flow.phase() != Phase::Delivering => {
                let next = self.connection_settings_to_save();
                next.save()?;
                self.saved_settings = next;
                self.status =
                    "Connection settings saved. Images and notes are never stored in settings."
                        .into();
            }
            Action::ApplyShortcut if self.flow.phase() != Phase::Delivering => {
                let old = self.shortcut.current().to_owned();
                self.shortcut.set(&self.settings.shortcut)?;
                let next = self.shortcut_settings_to_save();
                if let Err(error) = next.save() {
                    if let Err(rollback) = self.shortcut.restore(&old) {
                        self.shortcut_status =
                            format!("Active shortcut: {} (not saved)", self.shortcut.current());
                        return Err(format!("{error} {rollback}"));
                    }
                    return Err(error);
                }
                self.saved_settings = next;
                self.shortcut_status = format!("Capture shortcut: {}", self.shortcut.current());
                self.status = "Capture shortcut saved.".into();
            }
            Action::Hide => {
                if self.flow.phase() == Phase::Delivering {
                    return Err("Stage is still pending. This window stays available until its result is known.".into());
                }
                if self.flow.phase() == Phase::Selecting {
                    self.cancel(window);
                } else {
                    self.cancel(window);
                    self.show_after_paint = false;
                    if self.tray_available {
                        window.hide();
                    } else {
                        self.quit = true;
                    }
                }
            }
            Action::Quit => {
                if self.flow.phase() == Phase::Delivering {
                    return Err("Stage is still pending. Wait for its result before quitting; do not retry it.".into());
                }
                self.cancelled.store(true, Ordering::Release);
                self.clear_images();
                self.quit = true;
            }
            _ => return Err("This action is no longer available for the current capture.".into()),
        }
        Ok(())
    }
    pub fn ui(&mut self, ui: &mut egui::Ui) -> Action {
        let mut action = Action::None;
        let phase = self.flow.phase();
        if ui.input(|i| i.key_pressed(egui::Key::Escape)) {
            return if matches!(phase, Phase::Capturing | Phase::Selecting | Phase::Review) {
                Action::Cancel
            } else {
                Action::Hide
            };
        }
        if phase == Phase::Selecting {
            return self.selection_ui(ui);
        }
        if matches!(phase, Phase::Idle | Phase::Result)
            && ui.input(|i| i.key_pressed(egui::Key::F8))
        {
            return Action::Capture;
        }
        if phase == Phase::Review && ui.input(|i| i.key_pressed(egui::Key::F6)) {
            return Action::Copy;
        }
        egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
        egui::Frame::new().inner_margin(20.0).show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.heading("ScreenFling");
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if ui.button("Quit").clicked() { action = Action::Quit; }
                    if self.tray_available && ui.button("Hide").clicked() { action = Action::Hide; }
                    if ui.selectable_label(self.settings_open, "Settings").clicked() { self.settings_open = !self.settings_open; }
                });
            });
            ui.label("Capture what you see. Stage it in the right coding session."); ui.add_space(10.0);
            if self.settings_open {
                ui.add_enabled_ui(phase != Phase::Delivering, |ui| self.settings_ui(ui, &mut action));
                ui.separator();
            }
            match phase {
                Phase::Idle | Phase::Result => {
                    if ui.add_sized([180.0, 42.0], egui::Button::new("Capture (F8)")).clicked() { action = Action::Capture; }
                    ui.add_space(8.0); ui.label(&self.shortcut_status);
                    if capture::is_wayland() { ui.label("Wayland: the desktop asks which display to share. Select your display, then drag a region on its frozen image."); }
                    ui.add_space(16.0); ui.label(&self.status);
                    if phase == Phase::Result && self.reveal.is_some() {
                        ui.add_space(12.0);
                        if ui.add_enabled(!self.revealing, egui::Button::new("Reveal destination")).clicked() { action = Action::Reveal; }
                        ui.small("Reveal is separate from Stage. Inspect the coding agent to confirm that it attached the image.");
                    }
                }
                Phase::Capturing | Phase::Delivering => {
                    ui.spinner(); ui.label(&self.status);
                    if phase == Phase::Capturing && ui.button("Cancel").clicked() { action = Action::Cancel; }
                }
                Phase::Review => {
                    ui.heading("Review crop");
                    if let (Some(texture), Some(crop)) = (&self.texture, &self.crop) {
                        let available = Vec2::new(ui.available_width(), 240.0);
                        ui.image((texture.id(), fit_size(texture.size_vec2(), available)));
                        ui.small(format!("{} × {} pixels · only this crop can be delivered", crop.width, crop.height));
                    }
                    ui.add_space(8.0); ui.label("Optional note for Stage (one line)");
                    ui.add(egui::TextEdit::singleline(&mut self.note).desired_width(f32::INFINITY).char_limit(4096).hint_text("What should the coding agent look at?"));
                    if let Err(error) = model::stage_input(&self.note) { ui.colored_label(Color32::LIGHT_RED, error); }
                    ui.add_space(8.0);
                    ui.horizontal(|ui| {
                        if ui.add_sized([160.0, 36.0], egui::Button::new("Copy image (F6)")).clicked() { action = Action::Copy; }
                        if ui.button("Cancel").clicked() { action = Action::Cancel; }
                        ui.small("Copy does not include the note.");
                    });
                    ui.separator();
                    ui.horizontal(|ui| {
                        ui.label("Exact WezTerm destination");
                        if ui.add_enabled(!self.discovering, egui::Button::new("Refresh panes")).clicked() { action = Action::Discover; }
                    });
                    egui::ScrollArea::vertical().max_height(110.0).show(ui, |ui| {
                        for (index, destination) in self.routes.iter().enumerate() {
                            let label = format!("{}  ·  pane {}  ·  window {}  ·  {}", destination.title, destination.pane_id, destination.window_id, destination.workspace);
                            if ui.selectable_label(self.selected == Some(index), label).clicked() { self.selected = Some(index); }
                        }
                    });
                    let can_stage = self.selected.is_some() && self.settings.connection.paste_confirmed && model::stage_input(&self.note).is_ok();
                    if ui.add_enabled(can_stage, egui::Button::new("Stage — do not submit")).clicked() { action = Action::Stage; }
                    ui.small("Stage copies this image, then requests an image paste in only the selected pane. It never presses Enter. Attachment remains unverified.");
                    ui.add_space(6.0); ui.label(&self.status);
                }
                Phase::Selecting => {}
            }
        });
        });
        action
    }
    fn settings_ui(&mut self, ui: &mut egui::Ui, action: &mut Action) {
        egui::CollapsingHeader::new("WezTerm connection").default_open(true).show(ui, |ui| {
            ui.label("Absolute WezTerm executable path");
            let changed_executable = ui.text_edit_singleline(&mut self.settings.connection.executable).changed();
            ui.label("Exact WEZTERM_UNIX_SOCKET path from the intended WezTerm instance");
            let changed_socket = ui.text_edit_singleline(&mut self.settings.connection.socket).changed();
            if changed_executable || changed_socket { self.routes.clear(); self.selected = None; self.settings.connection.paste_confirmed = false; }
            ui.checkbox(&mut self.settings.connection.paste_confirmed, "My coding agent uses Ctrl+V to attach a clipboard image (not to submit).");
            ui.small("Only select a pane running that coding agent. A pane title is a label, not routing evidence. Copy works without this connection.");
            if ui.button("Save connection settings").clicked() { *action = Action::SaveSettings; }
        });
        ui.horizontal(|ui| {
            ui.label("Capture shortcut");
            ui.add_enabled(
                !capture::is_wayland(),
                egui::TextEdit::singleline(&mut self.settings.shortcut).desired_width(210.0),
            );
            if ui
                .add_enabled(!capture::is_wayland(), egui::Button::new("Apply shortcut"))
                .clicked()
            {
                *action = Action::ApplyShortcut;
            }
        });
        ui.small(&self.shortcut_status);
        if capture::is_wayland() {
            ui.small("Wayland global shortcuts are managed by the desktop portal. The Capture button is always available.");
        }
    }
    fn selection_ui(&mut self, ui: &mut egui::Ui) -> Action {
        let (Some(texture), Some(full)) = (&self.texture, &self.full) else {
            return Action::Cancel;
        };
        let screen = ui.max_rect();
        let image_rect = Rect::from_center_size(
            screen.center(),
            fit_size(texture.size_vec2(), screen.size()),
        );
        ui.painter().rect_filled(screen, 0.0, Color32::BLACK);
        ui.painter().image(
            texture.id(),
            image_rect,
            Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0)),
            Color32::WHITE,
        );
        let response = ui.interact(
            image_rect,
            ui.id().with(("frozen-region", self.flow.generation())),
            Sense::drag(),
        );
        if response.drag_started() {
            self.anchor = ui
                .input(|i| i.pointer.press_origin())
                .map(|p| p.clamp(image_rect.min, image_rect.max));
        }
        if let (Some(anchor), Some(pointer)) = (self.anchor, ui.input(|i| i.pointer.interact_pos()))
        {
            self.selection = Some(Rect::from_two_pos(
                anchor,
                pointer.clamp(image_rect.min, image_rect.max),
            ));
        }
        if let Some(selection) = self.selection {
            let dim = Color32::from_black_alpha(115);
            for rect in [
                Rect::from_min_max(image_rect.min, Pos2::new(image_rect.max.x, selection.min.y)),
                Rect::from_min_max(Pos2::new(image_rect.min.x, selection.max.y), image_rect.max),
                Rect::from_min_max(
                    Pos2::new(image_rect.min.x, selection.min.y),
                    Pos2::new(selection.min.x, selection.max.y),
                ),
                Rect::from_min_max(
                    Pos2::new(selection.max.x, selection.min.y),
                    Pos2::new(image_rect.max.x, selection.max.y),
                ),
            ] {
                ui.painter().rect_filled(rect, 0.0, dim);
            }
            ui.painter().rect_stroke(
                selection,
                0.0,
                egui::Stroke::new(2.0_f32, Color32::WHITE),
                egui::StrokeKind::Inside,
            );
            if response.drag_stopped() && selection.width() > 0.0 && selection.height() > 0.0 {
                return crop_action(selection, image_rect);
            }
        }
        let label_rect = Rect::from_center_size(
            Pos2::new(screen.center().x, screen.min.y + 32.0),
            Vec2::new(440.0, 38.0),
        );
        ui.painter()
            .rect_filled(label_rect, 8.0, Color32::from_black_alpha(220));
        ui.painter().text(
            label_rect.center(),
            egui::Align2::CENTER_CENTER,
            "Drag a region  ·  Space: whole display  ·  Esc: cancel",
            egui::FontId::proportional(15.0),
            Color32::WHITE,
        );
        if ui.input(|i| i.key_pressed(egui::Key::Space)) {
            return Action::Crop(
                [
                    0.0,
                    0.0,
                    full.pixels.width as f64,
                    full.pixels.height as f64,
                ],
                [full.pixels.width as f64, full.pixels.height as f64],
            );
        }
        Action::None
    }
}
fn fit_size(source: Vec2, available: Vec2) -> Vec2 {
    source
        * (available.x / source.x)
            .min(available.y / source.y)
            .clamp(0.001, 1.0)
}

fn crop_action(selection: Rect, image: Rect) -> Action {
    // Widen coordinates before subtracting: rounded f32 widths can put a valid
    // edge selection outside the image when map_crop adds its f64 x and width.
    Action::Crop(
        [
            selection.min.x as f64 - image.min.x as f64,
            selection.min.y as f64 - image.min.y as f64,
            selection.max.x as f64 - selection.min.x as f64,
            selection.max.y as f64 - selection.min.y as f64,
        ],
        [
            image.max.x as f64 - image.min.x as f64,
            image.max.y as f64 - image.min.y as f64,
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fractional_scale_edge_selection_stays_in_bounds() {
        let image = Rect::from_min_max(Pos2::ZERO, Pos2::new(640.0, 400.0));
        let selection = Rect::from_min_max(Pos2::new(4.0 / 3.0, 2.0 / 3.0), image.max);
        let Action::Crop(rect, size) = crop_action(selection, image) else {
            panic!("Expected a crop action");
        };
        assert_eq!(
            model::map_crop(rect, size, [960, 600]).unwrap(),
            model::Crop {
                x: 2,
                y: 1,
                width: 958,
                height: 599,
            }
        );
    }

    #[test]
    fn discovery_recovers_after_settings_change_and_ignores_old_capture() {
        let mut app = App::new(
            Settings::default(),
            String::new(),
            desktop::Shortcut::default(),
            String::new(),
        );
        let begin_review = |app: &mut App| {
            let id = app.flow.start().unwrap();
            app.flow
                .advance(id, Phase::Capturing, Phase::Selecting)
                .unwrap();
            app.flow
                .advance(id, Phase::Selecting, Phase::Review)
                .unwrap();
            app.discovering = true;
            id
        };
        let old = begin_review(&mut app);
        let settings = app.settings.connection.clone();
        app.settings.connection.socket.push_str("changed");
        app.finish_discovery(old, settings.clone(), Err("obsolete response".into()));
        assert!(!app.discovering);
        assert!(app.status.contains("settings changed"));
        assert!(app.routes.is_empty() && app.selected.is_none());

        assert!(app.flow.cancel(old));
        let current = begin_review(&mut app);
        app.finish_discovery(old, settings, Err("old capture".into()));
        assert!(app.discovering);
        app.finish_discovery(
            current,
            app.settings.connection.clone(),
            Err("unavailable".into()),
        );
        assert!(!app.discovering);
        assert_eq!(app.status, "unavailable");
    }

    #[test]
    fn applying_one_settings_section_does_not_persist_other_drafts() {
        let saved = Settings::default();
        let mut app = App::new(
            saved.clone(),
            String::new(),
            desktop::Shortcut::default(),
            String::new(),
        );
        app.settings.shortcut = "not a registered shortcut".into();
        app.settings.connection.socket = "/an/unsaved/socket".into();
        let connection = app.connection_settings_to_save();
        assert_eq!(connection.shortcut, saved.shortcut);
        assert_eq!(connection.connection, app.settings.connection);
        let shortcut = app.shortcut_settings_to_save();
        assert_eq!(shortcut.connection, saved.connection);
        assert_eq!(shortcut.shortcut, app.settings.shortcut);
        assert_eq!(app.saved_settings, saved);
    }
}
