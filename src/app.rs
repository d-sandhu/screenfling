use crate::{clipboard::Clipboard, desktop, send, settings::Settings};
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
    Send,
    ApplyShortcut,
    Hide,
    Quit,
}
pub struct App {
    pub flow: Flow,
    pub settings: Settings,
    pub status: String,
    pub shortcut_status: String,
    pub shortcut: desktop::Shortcut,
    full: Option<Captured>,
    crop: Option<Pixels>,
    texture: Option<TextureHandle>,
    preview_native: bool,
    destination: Option<send::Target>,
    pending_send: Option<send::Pending>,
    copied: bool,
    anchor: Option<Pos2>,
    selection: Option<Rect>,
    clipboard: Option<Clipboard>,
    worker: Option<JoinHandle<()>>,
    cancelled: Arc<AtomicBool>,
    capture_due: Option<(Instant, [i32; 2])>,
    restore: [i32; 4],
    settings_open: bool,
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
            settings,
            status,
            shortcut_status,
            shortcut,
            full: None,
            crop: None,
            texture: None,
            preview_native: false,
            destination: None,
            pending_send: None,
            copied: false,
            anchor: None,
            selection: None,
            clipboard: None,
            worker: None,
            cancelled: Arc::new(AtomicBool::new(false)),
            capture_due: None,
            restore: [100, 100, 1000, 740],
            settings_open: false,
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
            #[cfg(target_os = "linux")]
            Message::ShortcutStatus(status) => self.shortcut_status = status,
            _ => {} // Stale work cannot mutate the workflow or clipboard.
        }
        ctx.request_repaint();
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
                self.destination = send::remember();
                self.clear_images();
                self.settings_open = false;
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
                self.status = String::new();
                self.normal_window(window);
            }
            Action::Copy if self.flow.phase() == Phase::Review => {
                if self.clipboard.is_none() {
                    self.clipboard = Some(Clipboard::new()?);
                }
                let crop = self
                    .crop
                    .as_ref()
                    .ok_or("The reviewed crop is unavailable.")?;
                self.flow.advance(id, Phase::Review, Phase::Delivering)?;
                let result = self.clipboard.as_mut().unwrap().copy(crop);
                self.finish_copy(id, result);
            }
            Action::Send if self.flow.phase() == Phase::Review => {
                let target = self.destination.clone().ok_or("Start capture with the shortcut from your terminal to use Paste back. Copy image is always available.")?;
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
                            "Returning to your terminal. Pasting once, without Enter.".into();
                    }
                    Err(error) => {
                        let _ = self.flow.advance(id, Phase::Delivering, Phase::Review);
                        return Err(error);
                    }
                }
            }
            Action::ApplyShortcut if self.flow.phase() != Phase::Delivering => {
                let old = self.shortcut.current().to_owned();
                self.shortcut.set(&self.settings.shortcut)?;
                let next = self.settings.clone();
                if let Err(error) = next.save() {
                    if let Err(rollback) = self.shortcut.restore(&old) {
                        self.shortcut_status =
                            format!("Active shortcut: {} (not saved)", self.shortcut.current());
                        return Err(format!("{error} {rollback}"));
                    }
                    return Err(error);
                }
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
    fn finish_copy(&mut self, id: u64, result: Result<()>) {
        if !self.flow.is_current(id, Phase::Delivering) {
            return;
        }
        match result {
            Ok(()) => {
                let _ = self.flow.advance(id, Phase::Delivering, Phase::Result);
                self.copied = true;
                self.status = "Image copied. Switch to your coding agent and press Ctrl+V.".into();
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
        app.finish_copy(id, Err("Clipboard busy".into()));
        assert!(app.flow.is_current(id, Phase::Review));
        assert_eq!(app.crop, Some(pixels));
        assert!(!app.copied);
        app.flow
            .advance(id, Phase::Review, Phase::Delivering)
            .unwrap();
        app.finish_copy(id, Ok(()));
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
}
