//! CPU drawing into a window's pixel buffer: rectangles, outlines, text and
//! the frozen capture. Pixels are 0x00RRGGBB, as softbuffer presents them.
use fontdue::{Font, FontSettings, Metrics};
use std::collections::HashMap;

pub type Rgb = u32;

pub const fn rgb(r: u8, g: u8, b: u8) -> Rgb {
    (r as u32) << 16 | (g as u32) << 8 | b as u32
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rect {
    pub const fn new(x: f32, y: f32, w: f32, h: f32) -> Self {
        Self { x, y, w, h }
    }
    pub fn from_points(a: [f32; 2], b: [f32; 2]) -> Self {
        let (x, y) = (a[0].min(b[0]), a[1].min(b[1]));
        Self::new(x, y, (a[0] - b[0]).abs(), (a[1] - b[1]).abs())
    }
    pub fn right(&self) -> f32 {
        self.x + self.w
    }
    pub fn bottom(&self) -> f32 {
        self.y + self.h
    }
    pub fn contains(&self, p: [f32; 2]) -> bool {
        p[0] >= self.x && p[0] < self.right() && p[1] >= self.y && p[1] < self.bottom()
    }
    /// Whole pixels covered, clipped to a `width` × `height` buffer.
    fn pixels(&self, width: usize, height: usize) -> (usize, usize, usize, usize) {
        let clamp = |v: f32, max: usize| (v.round().max(0.0) as usize).min(max);
        (
            clamp(self.x, width),
            clamp(self.y, height),
            clamp(self.right(), width),
            clamp(self.bottom(), height),
        )
    }
}

/// The bundled interface font: Inter Regular (SIL Open Font License 1.1, see
/// assets/Inter-LICENSE.txt), subset to Latin, Greek, Cyrillic, punctuation,
/// arrows and shapes without hinting or layout tables, which fontdue ignores.
static FONT_BYTES: &[u8] = include_bytes!("../assets/Inter-Regular-subset.ttf");

pub struct Text {
    font: Font,
    glyphs: HashMap<(char, u32), (Metrics, Vec<u8>)>,
}

impl Text {
    pub fn new() -> Self {
        let font = Font::from_bytes(FONT_BYTES, FontSettings::default())
            .expect("the bundled font is a valid TrueType file");
        Self {
            font,
            glyphs: HashMap::new(),
        }
    }
    fn glyph(&mut self, c: char, size: f32) -> &(Metrics, Vec<u8>) {
        let font = &self.font;
        self.glyphs
            .entry((c, size.to_bits()))
            .or_insert_with(|| font.rasterize(c, size))
    }
    /// Width of `text` at `size` pixels.
    pub fn width(&mut self, text: &str, size: f32) -> f32 {
        text.chars()
            .map(|c| self.glyph(c, size).0.advance_width)
            .sum()
    }
    /// Distance from the top of a line to its baseline, and the line height.
    pub fn line(&self, size: f32) -> (f32, f32) {
        self.font
            .horizontal_line_metrics(size)
            .map_or((size * 0.8, size * 1.2), |m| {
                (m.ascent, m.ascent - m.descent + m.line_gap)
            })
    }
}

pub struct Canvas<'a> {
    pub pixels: &'a mut [u32],
    pub width: usize,
    pub height: usize,
}

impl Canvas<'_> {
    pub fn fill(&mut self, rect: Rect, color: Rgb) {
        let (x0, y0, x1, y1) = rect.pixels(self.width, self.height);
        for y in y0..y1 {
            self.pixels[y * self.width + x0..y * self.width + x1].fill(color);
        }
    }

    /// A `thickness`-pixel outline drawn outside (`outside`) or inside `rect`.
    pub fn outline(&mut self, rect: Rect, thickness: f32, color: Rgb, outside: bool) {
        let r = if outside {
            Rect::new(
                rect.x - thickness,
                rect.y - thickness,
                rect.w + 2.0 * thickness,
                rect.h + 2.0 * thickness,
            )
        } else {
            rect
        };
        let t = thickness;
        self.fill(Rect::new(r.x, r.y, r.w, t), color);
        self.fill(Rect::new(r.x, r.bottom() - t, r.w, t), color);
        self.fill(Rect::new(r.x, r.y + t, t, r.h - 2.0 * t), color);
        self.fill(Rect::new(r.right() - t, r.y + t, t, r.h - 2.0 * t), color);
    }

    /// A filled rectangle with rounded corners and an optional 1-pixel border.
    pub fn panel(&mut self, rect: Rect, radius: f32, fill: Rgb, border: Option<Rgb>) {
        let (x0, y0, x1, y1) = rect.pixels(self.width, self.height);
        let r = radius.min(rect.w / 2.0).min(rect.h / 2.0);
        for y in y0..y1 {
            for x in x0..x1 {
                let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
                // Distance outside the rounded rectangle, for antialiased edges.
                let dx = (rect.x + r - px).max(px - (rect.right() - r)).max(0.0);
                let dy = (rect.y + r - py).max(py - (rect.bottom() - r)).max(0.0);
                let d = (dx * dx + dy * dy).sqrt() - r;
                let coverage = (0.5 - d).clamp(0.0, 1.0);
                if coverage <= 0.0 {
                    continue;
                }
                // Within a pixel of the edge, the border colour takes over.
                let border_share = (1.5 + d).clamp(0.0, 1.0);
                let color = match border {
                    Some(b) => blend(fill, b, (border_share * 255.0) as u32),
                    None => fill,
                };
                let p = &mut self.pixels[y * self.width + x];
                *p = blend(*p, color, (coverage * 255.0) as u32);
            }
        }
    }

    /// Draw `text` with its top-left at (x, y). Returns the advance width.
    pub fn text(
        &mut self,
        fonts: &mut Text,
        text: &str,
        x: f32,
        y: f32,
        size: f32,
        color: Rgb,
    ) -> f32 {
        let (ascent, _) = fonts.line(size);
        let baseline = y + ascent;
        let mut pen = x;
        for c in text.chars() {
            let (metrics, coverage) = fonts.glyph(c, size).clone();
            let left = (pen + metrics.xmin as f32).round() as isize;
            let top = (baseline - metrics.height as f32 - metrics.ymin as f32).round() as isize;
            for row in 0..metrics.height {
                let py = top + row as isize;
                if py < 0 || py >= self.height as isize {
                    continue;
                }
                for col in 0..metrics.width {
                    let px = left + col as isize;
                    let a = coverage[row * metrics.width + col] as u32;
                    if a == 0 || px < 0 || px >= self.width as isize {
                        continue;
                    }
                    let p = &mut self.pixels[py as usize * self.width + px as usize];
                    *p = blend(*p, color, a);
                }
            }
            pen += metrics.advance_width;
        }
        pen - x
    }
}

/// `over` on `under` with `alpha` in 0..=255.
fn blend(under: Rgb, over: Rgb, alpha: u32) -> Rgb {
    let mix = |shift: u32| {
        let u = (under >> shift) & 0xFF;
        let o = (over >> shift) & 0xFF;
        (o * alpha + u * (255 - alpha) + 127) / 255
    };
    mix(16) << 16 | mix(8) << 8 | mix(0)
}

/// The captured RGBA image resampled to a `width` × `height` window buffer.
/// Equal sizes, the normal case, copy every pixel unchanged.
pub fn frame(rgba: &[u8], image: [usize; 2], width: usize, height: usize) -> Vec<u32> {
    let [iw, ih] = image;
    let mut out = vec![0; width * height];
    for y in 0..height {
        let sy = if ih == height {
            y
        } else {
            y * ih / height.max(1)
        };
        for x in 0..width {
            let sx = if iw == width {
                x
            } else {
                x * iw / width.max(1)
            };
            let i = (sy.min(ih - 1) * iw + sx.min(iw - 1)) * 4;
            out[y * width + x] = rgb(rgba[i], rgba[i + 1], rgba[i + 2]);
        }
    }
    out
}

/// A darkened copy, shown outside the selection.
pub fn dim(frame: &[u32]) -> Vec<u32> {
    frame.iter().map(|&p| blend(p, 0, 115)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blending_and_resampling_are_exact_at_the_ends() {
        assert_eq!(
            blend(rgb(10, 20, 30), rgb(200, 100, 50), 0),
            rgb(10, 20, 30)
        );
        assert_eq!(
            blend(rgb(10, 20, 30), rgb(200, 100, 50), 255),
            rgb(200, 100, 50)
        );
        // A 1:1 frame keeps every pixel; channel order is RGB.
        let rgba = [1, 2, 3, 255, 4, 5, 6, 255];
        assert_eq!(frame(&rgba, [2, 1], 2, 1), [rgb(1, 2, 3), rgb(4, 5, 6)]);
    }

    #[test]
    fn drawing_is_clipped_to_the_buffer() {
        let mut pixels = vec![0; 4 * 3];
        let mut canvas = Canvas {
            pixels: &mut pixels,
            width: 4,
            height: 3,
        };
        canvas.fill(Rect::new(-2.0, 1.0, 100.0, 1.0), 7);
        canvas.outline(Rect::new(0.0, 0.0, 4.0, 3.0), 1.0, 9, true);
        assert_eq!(&pixels[4..8], &[7, 7, 7, 7]);
        assert_eq!(pixels[0], 0);
    }
}
