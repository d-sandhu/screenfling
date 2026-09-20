//! Pure workflow and image invariants. No operating-system side effects live here.
use image::{ImageEncoder, codecs::png::PngEncoder};

pub type Result<T> = std::result::Result<T, String>;
pub const MAX_IMAGE_BYTES: usize = 256 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pixels {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

impl Pixels {
    pub fn new(width: u32, height: u32, rgba: Vec<u8>) -> Result<Self> {
        let len = (width as usize)
            .checked_mul(height as usize)
            .and_then(|n| n.checked_mul(4));
        if width == 0 || height == 0 || len != Some(rgba.len()) || rgba.len() > MAX_IMAGE_BYTES {
            return Err("The captured image has invalid or excessive dimensions.".into());
        }
        Ok(Self {
            width,
            height,
            rgba,
        })
    }

    pub fn opaque(mut self) -> Self {
        for pixel in self.rgba.as_chunks_mut::<4>().0 {
            pixel[3] = 255;
        }
        self
    }

    pub fn crop(&self, crop: Crop) -> Result<Self> {
        if crop.width == 0
            || crop.height == 0
            || crop
                .x
                .checked_add(crop.width)
                .is_none_or(|n| n > self.width)
            || crop
                .y
                .checked_add(crop.height)
                .is_none_or(|n| n > self.height)
        {
            return Err("The selected region is outside the captured image.".into());
        }
        let mut rgba = Vec::with_capacity(crop.width as usize * crop.height as usize * 4);
        for y in crop.y..crop.y + crop.height {
            let start = (y as usize * self.width as usize + crop.x as usize) * 4;
            rgba.extend_from_slice(&self.rgba[start..start + crop.width as usize * 4]);
        }
        Self::new(crop.width, crop.height, rgba)
    }

    pub fn png(&self) -> Result<Vec<u8>> {
        let mut out = Vec::new();
        PngEncoder::new(&mut out)
            .write_image(
                &self.rgba,
                self.width,
                self.height,
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|_| "The reviewed image could not be encoded.".to_string())?;
        Ok(out)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Crop {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// Coordinates are relative to the displayed image, not the screen origin.
/// Use the actual captured dimensions, never an assumed OS scale factor.
pub fn map_crop(rect: [f64; 4], display: [f64; 2], pixels: [u32; 2]) -> Result<Crop> {
    let [x, y, w, h] = rect;
    let [dw, dh] = display;
    if !rect.into_iter().chain(display).all(f64::is_finite)
        || dw <= 0.0
        || dh <= 0.0
        || w <= 0.0
        || h <= 0.0
        || x < 0.0
        || y < 0.0
        || x + w > dw
        || y + h > dh
        || pixels.contains(&0)
    {
        return Err("The selection is empty or outside the captured display.".into());
    }
    let sx = pixels[0] as f64 / dw;
    let sy = pixels[1] as f64 / dh;
    let left = (x * sx).floor() as u32;
    let top = (y * sy).floor() as u32;
    let right = ((x + w) * sx).ceil().min(pixels[0] as f64) as u32;
    let bottom = ((y + h) * sy).ceil().min(pixels[1] as f64) as u32;
    if right <= left || bottom <= top {
        return Err("The selection contains no pixels.".into());
    }
    Ok(Crop {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Idle,
    Capturing,
    Selecting,
    Review,
    Delivering,
    Result,
}

#[derive(Debug)]
pub struct Flow {
    generation: u64,
    phase: Phase,
}
impl Default for Flow {
    fn default() -> Self {
        Self {
            generation: 0,
            phase: Phase::Idle,
        }
    }
}
impl Flow {
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn phase(&self) -> Phase {
        self.phase
    }
    pub fn is_current(&self, generation: u64, phase: Phase) -> bool {
        generation == self.generation && phase == self.phase
    }
    pub fn start(&mut self) -> Result<u64> {
        if !matches!(self.phase, Phase::Idle | Phase::Result) {
            return Err("Finish or cancel the current capture first.".into());
        }
        self.generation = self
            .generation
            .checked_add(1)
            .ok_or("Restart ScreenFling before another capture.")?;
        self.phase = Phase::Capturing;
        Ok(self.generation)
    }
    pub fn advance(&mut self, generation: u64, from: Phase, to: Phase) -> Result<()> {
        let permitted = matches!(
            (from, to),
            (Phase::Capturing, Phase::Selecting)
                | (Phase::Selecting, Phase::Review)
                | (Phase::Review, Phase::Delivering)
                | (Phase::Delivering, Phase::Result)
        );
        if !permitted || !self.is_current(generation, from) {
            return Err("This action is no longer current.".into());
        }
        self.phase = to;
        Ok(())
    }
    pub fn cancel(&mut self, generation: u64) -> bool {
        if generation != self.generation
            || !matches!(
                self.phase,
                Phase::Capturing | Phase::Selecting | Phase::Review
            )
        {
            return false;
        }
        self.phase = Phase::Idle;
        true
    }
    pub fn fail(&mut self, generation: u64) -> bool {
        if generation != self.generation || matches!(self.phase, Phase::Idle | Phase::Result) {
            return false;
        }
        self.phase = Phase::Result;
        true
    }
}

/// Raw terminal input is deliberately restricted to one line with no controls.
/// CR/LF, ESC and C1 characters could submit a prompt or change terminal modes.
pub fn stage_input(note: &str) -> Result<Vec<u8>> {
    if note.len() > 4096
        || note
            .chars()
            .any(|c| c.is_control() || matches!(c, '\u{2028}' | '\u{2029}'))
    {
        return Err(
            "Use a single-line note, without control characters, up to 4096 UTF-8 bytes.".into(),
        );
    }
    let mut bytes = Vec::with_capacity(note.len() + 1);
    bytes.push(0x16); // The explicitly configured coding agent's clipboard-image shortcut: Ctrl+V.
    bytes.extend_from_slice(note.as_bytes());
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn crop_uses_actual_image_dimensions() {
        assert_eq!(
            map_crop([1.0, 2.0, 3.0, 4.0], [100.0, 100.0], [125, 200]).unwrap(),
            Crop {
                x: 1,
                y: 4,
                width: 4,
                height: 8
            }
        );
        assert_eq!(
            map_crop([0.0, 0.0, 1536.0, 864.0], [1536.0, 864.0], [1920, 1080]).unwrap(),
            Crop {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080
            }
        );
        for rect in [
            [f64::NAN, 0.0, 1.0, 1.0],
            [-1.0, 0.0, 1.0, 1.0],
            [9.0, 0.0, 2.0, 1.0],
            [0.0, 0.0, 0.0, 1.0],
        ] {
            assert!(map_crop(rect, [10.0, 10.0], [20, 20]).is_err());
        }
    }
    #[test]
    fn crop_contains_only_selected_pixels() {
        let image = Pixels::new(2, 2, (0..16).collect()).unwrap();
        assert_eq!(
            image
                .crop(Crop {
                    x: 1,
                    y: 0,
                    width: 1,
                    height: 2
                })
                .unwrap()
                .rgba,
            [4, 5, 6, 7, 12, 13, 14, 15]
        );
        assert!(
            image
                .crop(Crop {
                    x: u32::MAX,
                    y: 0,
                    width: 2,
                    height: 1
                })
                .is_err()
        );
    }
    #[test]
    fn current_review_is_required_for_one_delivery() {
        let mut flow = Flow::default();
        let old = flow.start().unwrap();
        assert!(flow.cancel(old));
        let id = flow.start().unwrap();
        assert!(!flow.cancel(old));
        assert!(!flow.fail(old));
        assert!(
            flow.advance(old, Phase::Capturing, Phase::Selecting)
                .is_err()
        );
        assert!(
            flow.advance(id, Phase::Capturing, Phase::Delivering)
                .is_err()
        );
        for (from, to) in [
            (Phase::Capturing, Phase::Selecting),
            (Phase::Selecting, Phase::Review),
            (Phase::Review, Phase::Delivering),
        ] {
            flow.advance(id, from, to).unwrap();
        }
        assert!(!flow.cancel(id));
        assert!(flow.advance(id, Phase::Review, Phase::Delivering).is_err());
        flow.advance(id, Phase::Delivering, Phase::Result).unwrap();
        assert!(flow.advance(id, Phase::Result, Phase::Delivering).is_err());
    }
    #[test]
    fn staging_cannot_submit_or_inject_controls() {
        for note in ["\r", "\n", "\x1b[200~", "\u{85}", "\u{2028}", "x\ty", "\0"] {
            assert!(stage_input(note).is_err());
        }
        assert!(stage_input(&"x".repeat(4097)).is_err());
        assert_eq!(
            stage_input("Inspect this. Café.").unwrap(),
            "\x16Inspect this. Café.".as_bytes()
        );
    }
}
