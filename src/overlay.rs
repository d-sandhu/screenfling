//! The selection overlay: the frozen display, the chosen region and the
//! toolbar beside it. Layout, hit-testing and drawing share one geometry, so
//! what is drawn is exactly what a click hits.
use crate::{
    canvas::{Canvas, Rect, Rgb, Text, rgb},
    send,
};
use screenfling::model::{self, Crop, Pixels, Result};

const BACKGROUND: Rgb = rgb(12, 17, 27);
const BUTTON: Rgb = rgb(28, 37, 52);
const HOVER: Rgb = rgb(25, 49, 74);
const BORDER: Rgb = rgb(112, 130, 153);
const TEXT: Rgb = rgb(239, 244, 251);
const MUTED: Rgb = rgb(177, 190, 208);
const ACCENT: Rgb = rgb(132, 198, 255);
const INK: Rgb = rgb(8, 24, 40);
const ERROR: Rgb = rgb(255, 174, 185);
const WHITE: Rgb = rgb(255, 255, 255);
const BLACK: Rgb = rgb(0, 0, 0);

pub const COPY_KEY: &str = if cfg!(target_os = "macos") {
    "Cmd+C"
} else {
    "Ctrl+C"
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Delivery {
    Copy,
    Send,
}

/// What a key asked for, carried out once every key is up.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Intent {
    Deliver(Delivery),
    Cancel,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Hit {
    Copy,
    Send,
    Menu,
    Destination(usize),
}

pub struct Selection {
    pub pixels: Pixels,
    /// The capture resampled to the window, and its darkened copy.
    frame: Vec<u32>,
    dimmed: Vec<u32>,
    width: usize,
    height: usize,
    /// Interface scale: physical pixels per logical pixel.
    scale: f32,
    /// The window capture started from; Copy and Cancel return focus there.
    pub origin: Option<send::Target>,
    /// Where Send can go, most recently used first.
    pub agents: Vec<send::Target>,
    pub chosen: usize,
    anchor: Option<[f32; 2]>,
    region: Option<Rect>,
    pointer: [f32; 2],
    menu: bool,
    pub armed: Option<Intent>,
}

impl Selection {
    pub fn new(
        pixels: Pixels,
        origin: Option<send::Target>,
        agents: Vec<send::Target>,
        chosen: usize,
    ) -> Self {
        Self {
            pixels,
            frame: Vec::new(),
            dimmed: Vec::new(),
            width: 0,
            height: 0,
            scale: 1.0,
            origin,
            agents,
            chosen,
            anchor: None,
            region: None,
            pointer: [0.0; 2],
            menu: false,
            armed: None,
        }
    }

    /// Match the window's pixel size; resampling happens only when it changes.
    pub fn resize(&mut self, width: usize, height: usize, scale: f32) {
        self.scale = scale.max(0.5);
        if (width, height) == (self.width, self.height) || width == 0 || height == 0 {
            return;
        }
        let image = [self.pixels.width as usize, self.pixels.height as usize];
        self.frame = crate::canvas::frame(&self.pixels.rgba, image, width, height);
        self.dimmed = crate::canvas::dim(&self.frame);
        (self.width, self.height) = (width, height);
        // A region from another size no longer maps to the same pixels.
        self.region = None;
        self.anchor = None;
    }

    fn bounds(&self) -> Rect {
        Rect::new(0.0, 0.0, self.width as f32, self.height as f32)
    }

    pub fn dragging(&self) -> bool {
        self.anchor.is_some()
    }

    /// The region as captured pixels.
    pub fn crop(&self) -> Option<Crop> {
        let r = self.region?;
        model::map_crop(
            [r.x as f64, r.y as f64, r.w as f64, r.h as f64],
            [self.width as f64, self.height as f64],
            [self.pixels.width, self.pixels.height],
        )
        .ok()
    }

    pub fn crop_pixels(&self, crop: Crop) -> Result<Pixels> {
        self.pixels.crop(crop)
    }

    pub fn destination(&self) -> Option<&send::Target> {
        self.agents.get(self.chosen)
    }

    pub fn select_all(&mut self) {
        if !self.dragging() {
            self.region = Some(self.bounds());
        }
    }

    pub fn next_destination(&mut self) {
        if !self.agents.is_empty() {
            self.chosen = (self.chosen + 1) % self.agents.len();
        }
    }

    /// Escape closes the destination list before it cancels the capture.
    pub fn close_menu(&mut self) -> bool {
        std::mem::take(&mut self.menu)
    }

    pub fn pointer_moved(&mut self, p: [f32; 2]) {
        self.pointer = p;
        if let Some(anchor) = self.anchor {
            let b = self.bounds();
            let clamp = |p: [f32; 2]| [p[0].clamp(0.0, b.w), p[1].clamp(0.0, b.h)];
            self.region = Some(Rect::from_points(clamp(anchor), clamp(p)));
        }
    }

    /// A press either hits the toolbar or starts a new region.
    pub fn pressed(&mut self, text: &mut Text) {
        if self.hit(text).is_none() {
            self.menu = false;
            self.armed = None;
            let b = self.bounds();
            self.anchor = Some([
                self.pointer[0].clamp(0.0, b.w),
                self.pointer[1].clamp(0.0, b.h),
            ]);
            self.region = None;
        }
    }

    /// A release ends a drag, or completes a click on the toolbar.
    pub fn released(&mut self, text: &mut Text) -> Option<Delivery> {
        if self.anchor.take().is_some() {
            self.region = self.region.filter(|r| r.w >= 1.0 && r.h >= 1.0);
            return None;
        }
        match self.hit(text)? {
            Hit::Copy => Some(Delivery::Copy),
            Hit::Send => Some(Delivery::Send),
            Hit::Menu => {
                self.menu = !self.menu;
                None
            }
            Hit::Destination(index) => {
                self.chosen = index;
                self.menu = false;
                None
            }
        }
    }

    fn hit(&self, text: &mut Text) -> Option<Hit> {
        let layout = self.layout(text)?;
        let p = self.pointer;
        if self.menu
            && let Some(i) = layout.items.iter().position(|r| r.contains(p))
        {
            return Some(Hit::Destination(i));
        }
        [
            (layout.copy, Hit::Copy),
            (layout.send.unwrap_or_default(), Hit::Send),
            (layout.menu.unwrap_or_default(), Hit::Menu),
        ]
        .into_iter()
        .find_map(|(rect, hit)| rect.contains(p).then_some(hit))
    }

    fn labels(&self) -> (String, Option<String>) {
        match self.destination() {
            Some(agent) => (
                format!("Copy  {COPY_KEY}"),
                Some(format!("Send to {}  Enter", agent.name())),
            ),
            None => ("Copy  Enter".to_owned(), None),
        }
    }

    /// Toolbar geometry: below the region, above it when there is no room,
    /// or inside it for a full-display region; always within the display.
    fn layout(&self, text: &mut Text) -> Option<Layout> {
        let region = self.region?;
        if self.dragging() {
            return None;
        }
        let s = self.scale;
        let (size, pad, gap, height) = (14.0 * s, 12.0 * s, 6.0 * s, 34.0 * s);
        let (copy, send) = self.labels();
        let button = |label: &str, text: &mut Text| text.width(label, size) + 2.0 * pad;
        let dims = self.dimensions();
        let mut widths = vec![text.width(&dims, 13.0 * s) + pad, button(&copy, text)];
        if let Some(send) = &send {
            widths.push(button(send, text));
        }
        let has_menu = self.agents.len() > 1;
        if has_menu {
            widths.push(height);
        }
        let inner: f32 = widths.iter().sum::<f32>() + gap * (widths.len() - 1) as f32;
        let bar = Rect::new(0.0, 0.0, inner + 2.0 * gap, height + 2.0 * gap);
        let b = self.bounds();
        let margin = 8.0 * s;
        let y = if region.bottom() + margin + bar.h <= b.h {
            region.bottom() + margin
        } else if region.y - margin - bar.h >= 0.0 {
            region.y - margin - bar.h
        } else {
            region.bottom() - bar.h - 12.0 * s
        };
        let x = (region.right() - bar.w).clamp(0.0, (b.w - bar.w).max(0.0));
        let y = y.clamp(0.0, (b.h - bar.h).max(0.0));
        let bar = Rect::new(x, y, bar.w, bar.h);
        let mut cursor = x + gap;
        let mut next = |w: f32| {
            let r = Rect::new(cursor, y + gap, w, height);
            cursor += w + gap;
            r
        };
        let size_label = next(widths[0]);
        let copy_rect = next(widths[1]);
        let send_rect = send.as_ref().map(|_| next(widths[2]));
        let menu_rect = has_menu.then(|| next(height));
        // The destination list opens away from the region's nearer edge.
        let row = 30.0 * s;
        let list_w = self
            .agents
            .iter()
            .map(|a| text.width(&a.label(), size) + 2.0 * pad)
            .fold(0.0f32, f32::max)
            .min(b.w);
        let list_h = row * self.agents.len() as f32;
        let list_x = (bar.right() - list_w).clamp(0.0, (b.w - list_w).max(0.0));
        let list_y = if bar.bottom() + list_h <= b.h {
            bar.bottom() + 4.0 * s
        } else {
            (bar.y - list_h - 4.0 * s).max(0.0)
        };
        let items = (0..self.agents.len())
            .map(|i| Rect::new(list_x, list_y + row * i as f32, list_w, row))
            .collect();
        Some(Layout {
            bar,
            size: size_label,
            copy: copy_rect,
            send: send_rect,
            menu: menu_rect,
            items,
            copy_label: copy,
            send_label: send,
            dims,
        })
    }

    fn dimensions(&self) -> String {
        self.crop()
            .map(|c| format!("{} × {}", c.width, c.height))
            .unwrap_or_default()
    }

    pub fn draw(&self, canvas: &mut Canvas, text: &mut Text, status: &str) {
        if self.frame.len() != canvas.pixels.len() {
            canvas.fill(self.bounds(), BLACK);
            return;
        }
        let s = self.scale;
        match self.region {
            None => canvas.pixels.copy_from_slice(&self.dimmed),
            Some(r) => {
                canvas.pixels.copy_from_slice(&self.dimmed);
                let x0 = r.x.round().max(0.0) as usize;
                let x1 = (r.right().round() as usize).min(self.width);
                let y0 = r.y.round().max(0.0) as usize;
                let y1 = (r.bottom().round() as usize).min(self.height);
                for y in y0..y1 {
                    let row = y * self.width;
                    canvas.pixels[row + x0..row + x1]
                        .copy_from_slice(&self.frame[row + x0..row + x1]);
                }
                // A two-tone edge stays visible on light and dark captures.
                canvas.outline(r, (2.0 * s).round(), BLACK, true);
                canvas.outline(r, s.round().max(1.0), WHITE, false);
            }
        }
        if let Some(layout) = self.layout(text) {
            self.draw_toolbar(canvas, text, &layout);
        } else if self.dragging()
            && let Some(r) = self.region
        {
            // While dragging, only the size follows the pointer.
            let label = self.dimensions();
            let w = text.width(&label, 13.0 * s) + 16.0 * s;
            let badge = Rect::new(
                (r.right() - w).max(0.0),
                (r.bottom() + 8.0 * s).min(self.height as f32 - 28.0 * s),
                w,
                26.0 * s,
            );
            canvas.panel(badge, 6.0 * s, BACKGROUND, None);
            canvas.text(
                text,
                &label,
                badge.x + 8.0 * s,
                badge.y + 5.0 * s,
                13.0 * s,
                MUTED,
            );
        }
        self.draw_hint(canvas, text, status);
    }

    fn draw_toolbar(&self, canvas: &mut Canvas, text: &mut Text, layout: &Layout) {
        let s = self.scale;
        let size = 14.0 * s;
        let hit = self.hit(text);
        canvas.panel(layout.bar, 10.0 * s, BACKGROUND, Some(BORDER));
        let (_, line) = text.line(size);
        let middle = |r: Rect| r.y + (r.h - line) / 2.0;
        canvas.text(
            text,
            &layout.dims,
            layout.size.x,
            middle(layout.size),
            13.0 * s,
            MUTED,
        );
        let mut button = |canvas: &mut Canvas, r: Rect, label: &str, primary: bool, hover: bool| {
            let (fill, ink) = match (primary, hover) {
                (true, _) => (ACCENT, INK),
                (false, true) => (HOVER, TEXT),
                (false, false) => (BUTTON, TEXT),
            };
            canvas.panel(r, 8.0 * s, fill, (!primary).then_some(BORDER));
            canvas.text(text, label, r.x + 12.0 * s, middle(r), size, ink);
        };
        let primary_copy = layout.send.is_none();
        button(
            canvas,
            layout.copy,
            &layout.copy_label,
            primary_copy,
            hit == Some(Hit::Copy),
        );
        if let (Some(r), Some(label)) = (layout.send, &layout.send_label) {
            button(canvas, r, label, true, hit == Some(Hit::Send));
        }
        if let Some(r) = layout.menu {
            let fill = if hit == Some(Hit::Menu) || self.menu {
                HOVER
            } else {
                BUTTON
            };
            canvas.panel(r, 8.0 * s, fill, Some(BORDER));
            // A downward triangle, drawn rather than taken from a font.
            let (cx, cy, half) = (r.x + r.w / 2.0, r.y + r.h / 2.0, 5.0 * s);
            for i in 0..(half as i32) {
                let w = 2.0 * (half - i as f32);
                canvas.fill(
                    Rect::new(cx - w / 2.0, cy - half / 2.0 + i as f32, w, 1.0),
                    TEXT,
                );
            }
        }
        if self.menu {
            for (i, (agent, r)) in self.agents.iter().zip(&layout.items).enumerate() {
                let fill = if i == self.chosen || hit == Some(Hit::Destination(i)) {
                    HOVER
                } else {
                    BACKGROUND
                };
                canvas.fill(*r, fill);
                canvas.text(text, &agent.label(), r.x + 12.0 * s, middle(*r), size, TEXT);
            }
            if let (Some(first), Some(last)) = (layout.items.first(), layout.items.last()) {
                let list = Rect::new(first.x, first.y, first.w, last.bottom() - first.y);
                canvas.outline(list, 1.0, BORDER, true);
            }
        }
    }

    fn draw_hint(&self, canvas: &mut Canvas, text: &mut Text, status: &str) {
        let s = self.scale;
        let size = 14.0 * s;
        let (message, color) = if !status.is_empty() {
            (status.to_owned(), ERROR)
        } else if self.agents.len() > 1 {
            (
                "Drag a region  ·  Space whole display  ·  Tab next agent  ·  Esc cancel"
                    .to_owned(),
                TEXT,
            )
        } else {
            (
                "Drag a region  ·  Space whole display  ·  Esc cancel".to_owned(),
                TEXT,
            )
        };
        let (_, line) = text.line(size);
        let w = text.width(&message, size) + 28.0 * s;
        let h = line + 18.0 * s;
        let r = Rect::new((self.width as f32 - w) / 2.0, 16.0 * s, w, h);
        canvas.panel(r, 10.0 * s, BACKGROUND, Some(BORDER));
        canvas.text(text, &message, r.x + 14.0 * s, r.y + 9.0 * s, size, color);
    }
}

struct Layout {
    bar: Rect,
    size: Rect,
    copy: Rect,
    send: Option<Rect>,
    menu: Option<Rect>,
    items: Vec<Rect>,
    copy_label: String,
    send_label: Option<String>,
    dims: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn selection(width: u32, height: u32, window: [usize; 2]) -> Selection {
        let pixels = Pixels::new(width, height, vec![0; (width * height * 4) as usize]).unwrap();
        let mut s = Selection::new(pixels, None, Vec::new(), 0);
        s.resize(window[0], window[1], 1.0);
        s
    }

    #[test]
    fn regions_map_to_exact_captured_pixels() {
        // 1:1, the normal case: the region is the crop.
        let mut s = selection(1920, 1080, [1920, 1080]);
        s.region = Some(Rect::new(300.0, 250.0, 600.0, 400.0));
        assert_eq!(
            s.crop(),
            Some(Crop {
                x: 300,
                y: 250,
                width: 600,
                height: 400
            })
        );
        // A full-window region is every captured pixel, at any window size.
        let mut s = selection(960, 600, [640, 400]);
        s.select_all();
        assert_eq!(
            s.crop(),
            Some(Crop {
                x: 0,
                y: 0,
                width: 960,
                height: 600
            })
        );
    }

    #[test]
    fn a_drag_is_clamped_and_a_click_is_not_a_region() {
        let mut text = Text::new();
        let mut s = selection(100, 100, [100, 100]);
        s.pointer_moved([90.0, 90.0]);
        s.pressed(&mut text);
        s.pointer_moved([150.0, -20.0]);
        assert_eq!(s.released(&mut text), None);
        assert_eq!(s.region, Some(Rect::new(90.0, 0.0, 10.0, 90.0)));
        s.pointer_moved([5.0, 5.0]);
        s.pressed(&mut text);
        s.released(&mut text);
        assert_eq!(s.region, None);
    }

    #[test]
    fn the_toolbar_stays_on_screen_and_is_what_a_click_hits() {
        let mut text = Text::new();
        let mut s = selection(800, 600, [800, 600]);
        s.select_all();
        let layout = s.layout(&mut text).unwrap();
        let b = s.bounds();
        assert!(layout.bar.x >= 0.0 && layout.bar.right() <= b.w);
        assert!(layout.bar.y >= 0.0 && layout.bar.bottom() <= b.h);
        s.pointer_moved([
            layout.copy.x + layout.copy.w / 2.0,
            layout.copy.y + layout.copy.h / 2.0,
        ]);
        s.pressed(&mut text);
        assert_eq!(s.released(&mut text), Some(Delivery::Copy));
        assert!(s.region.is_some());
    }
}
