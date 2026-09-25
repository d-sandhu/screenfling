use crate::{
    clipboard::Clipboard,
    desktop, handoff, send,
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
#[path = "app_view.rs"]
mod view;
pub use view::configure;

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
    CopyPath,
    ChooseWindow,
    Send,
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
    preview_native: bool,
    advanced_open: bool,
    send_open: bool,
    windows: Vec<send::Target>,
    selected_window: Option<usize>,
    pending_send: Option<send::Pending>,
    copied: bool,
    saved_capture: Option<std::path::PathBuf>,
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
            preview_native: false,
            advanced_open: false,
            send_open: false,
            windows: Vec::new(),
            selected_window: None,
            pending_send: None,
            copied: false,
            saved_capture: None,
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
            restore: [100, 100, 1000, 740],
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
        self.preview_native = false;
        self.saved_capture = None;
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
        if self.pending_send.is_some() {
            Some(Instant::now() + Duration::from_millis(25))
        } else {
            self.capture_due.map(|(when, _)| when)
        }
    }
    pub fn tick(&mut self) {
        if let Some(pending) = &self.pending_send {
            let clipboard = &mut self.clipboard;
            let crop = &self.crop;
            if let Some(result) = pending.poll(|| {
                clipboard
                    .as_mut()
                    .zip(crop.as_ref())
                    .is_some_and(|(c, image)| c.matches(image))
            }) {
                let id = self.flow.generation();
                self.pending_send = None;
                let _ = self.flow.advance(id, Phase::Delivering, Phase::Result);
                self.status = result.unwrap_or_else(|error| error);
                if let Some(path) = &self.saved_capture {
                    self.status.push_str(&format!(
                        "\n\nSaved PNG: {}\nThe file stays on this computer until you delete it.",
                        path.display()
                    ));
                }
                self.clear_images();
            }
        }
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
            self.status = "The display layout changed. The capture was cancelled.".into();
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
            self.status = "Capture cancelled. No further delivery was requested.".into();
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
                self.copied = false;
                self.send_open = false;
                self.windows.clear();
                self.selected_window = None;
                self.clear_images();
                self.settings_open = false;
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
                self.status =
                    "Send the image to a coding agent, or copy it and press Ctrl+V there.".into();
                self.normal_window(window);
            }
            Action::Copy | Action::CopyPath if self.flow.phase() == Phase::Review => {
                let copy_path = matches!(action, Action::CopyPath);
                if self.clipboard.is_none() {
                    self.clipboard = Some(Clipboard::new()?);
                }
                let crop = self
                    .crop
                    .as_ref()
                    .ok_or("The reviewed crop is unavailable.")?;
                if copy_path && self.saved_capture.is_none() {
                    self.saved_capture = Some(handoff::save(crop)?);
                }
                self.flow.advance(id, Phase::Review, Phase::Delivering)?;
                let clipboard = self.clipboard.as_mut().ok_or("Clipboard unavailable.")?;
                let result = if copy_path {
                    clipboard.copy_text(handoff::clipboard_path(
                        self.saved_capture.as_ref().unwrap(),
                    )?)
                } else {
                    clipboard.copy(crop)
                };
                self.finish_copy(id, result, copy_path);
            }
            Action::ChooseWindow if self.flow.phase() == Phase::Review => {
                self.send_open = true;
                self.advanced_open = false;
                self.selected_window = None;
                self.windows.clear();
                self.windows = send::discover()?;
                self.selected_window = (self.windows.len() == 1).then_some(0);
                self.status = if self.windows.is_empty() {
                    "No agent terminal could be verified. Use Copy image, then Ctrl+V in your agent. Terminals with mixed shell and agent tabs are omitted."
                } else {
                    "Choose an agent terminal. Ctrl+V pastes the image into its active pane; Enter is never sent."
                }
                .into();
            }
            Action::Send if self.flow.phase() == Phase::Review => {
                let target = self
                    .selected_window
                    .and_then(|i| self.windows.get(i))
                    .cloned()
                    .ok_or("Choose a window first.")?;
                let crop = self
                    .crop
                    .as_ref()
                    .ok_or("The reviewed crop is unavailable.")?;
                if self.clipboard.is_none() {
                    self.clipboard = Some(Clipboard::new()?);
                }
                let clipboard = self.clipboard.as_mut().unwrap();
                clipboard.copy(crop)?;
                self.flow.advance(id, Phase::Review, Phase::Delivering)?;
                match send::Pending::start(target, clipboard.matches(crop)) {
                    Ok(pending) => {
                        self.pending_send = Some(pending);
                        self.show_after_paint = false;
                        self.status =
                            "Switching to your selected window. Pasting once, without Enter."
                                .into();
                    }
                    Err(error) => {
                        let _ = self.flow.advance(id, Phase::Delivering, Phase::Review);
                        return Err(error);
                    }
                }
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
                    return Err("Delivery is still pending. This window stays available until its result is known.".into());
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
                    return Err("Delivery is still pending. Wait for its result before quitting; do not retry it.".into());
                }
                self.cancelled.store(true, Ordering::Release);
                self.clear_images();
                self.quit = true;
            }
            _ => return Err("This action is no longer available for the current capture.".into()),
        }
        Ok(())
    }
    fn finish_copy(&mut self, id: u64, result: Result<()>, path: bool) {
        if !self.flow.is_current(id, Phase::Delivering) {
            return;
        }
        match result {
            Ok(()) => {
                let _ = self.flow.advance(id, Phase::Delivering, Phase::Result);
                self.copied = true;
                self.status = if path {
                    format!(
                        "File path copied. Paste it into your agent's prompt.\n\nSaved PNG: {}\nThe file stays on this computer until you delete it.",
                        self.saved_capture.as_ref().unwrap().display()
                    )
                } else {
                    "Image copied. Switch to your coding agent and press Ctrl+V.".into()
                };
                self.clear_images();
            }
            Err(error) => {
                // A failed local copy is retryable; an uncertain terminal write is not.
                let _ = self.flow.advance(id, Phase::Delivering, Phase::Review);
                self.status = format!("{error} Your crop is still here; choose Copy to try again.");
            }
        }
    }
    pub fn ui(&mut self, ui: &mut egui::Ui) -> Action {
        view::show(self, ui)
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
        let response = ui
            .interact(
                image_rect,
                ui.id().with(("frozen-region", self.flow.generation())),
                Sense::drag(),
            )
            .on_hover_cursor(egui::CursorIcon::Crosshair);
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
            // The two-tone edge remains visible on both light and dark captures.
            ui.painter().rect_stroke(
                selection,
                0.0,
                egui::Stroke::new(3.0_f32, Color32::BLACK),
                egui::StrokeKind::Outside,
            );
            ui.painter().rect_stroke(
                selection,
                0.0,
                egui::Stroke::new(1.5_f32, Color32::WHITE),
                egui::StrokeKind::Inside,
            );
            view::selection_badge(
                ui,
                selection,
                image_rect,
                [full.pixels.width, full.pixels.height],
            );
            if response.drag_stopped() && selection.width() > 0.0 && selection.height() > 0.0 {
                return crop_action(selection, image_rect);
            }
        }
        view::selection_hint(ui, screen);
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
    fn failed_copy_keeps_the_reviewed_pixels_for_an_explicit_retry() {
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
        let pixels = Pixels::new(1, 1, vec![12, 24, 48, 255]).unwrap();
        app.crop = Some(pixels.clone());
        app.flow
            .advance(id, Phase::Review, Phase::Delivering)
            .unwrap();
        app.finish_copy(id, Err("Clipboard busy".into()), false);
        assert!(app.flow.is_current(id, Phase::Review));
        assert_eq!(app.crop, Some(pixels));
        assert!(!app.copied);
        app.flow
            .advance(id, Phase::Review, Phase::Delivering)
            .unwrap();
        app.finish_copy(id, Ok(()), false);
        assert!(app.flow.is_current(id, Phase::Result));
        assert!(app.crop.is_none() && app.copied);
    }

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
