//! Image clipboard writes happen only through explicit Copy or Stage actions.
use screenfling::model::{Pixels, Result};

#[cfg(not(target_os = "linux"))]
pub struct Clipboard(arboard::Clipboard);
#[cfg(target_os = "linux")]
pub struct Clipboard;
impl Clipboard {
    pub fn new() -> Result<Self> {
        #[cfg(not(target_os = "linux"))]
        {
            arboard::Clipboard::new()
                .map(Self)
                .map_err(|_| "The image clipboard is unavailable.".into())
        }
        #[cfg(target_os = "linux")]
        {
            Ok(Self)
        }
    }
    pub fn copy(&mut self, image: &Pixels) -> Result<()> {
        #[cfg(not(target_os = "linux"))]
        self.0
            .set_image(arboard::ImageData {
                width: image.width as usize,
                height: image.height as usize,
                bytes: std::borrow::Cow::Borrowed(&image.rgba),
            })
            .map_err(|_| "The image clipboard is busy or unavailable.")?;
        #[cfg(target_os = "linux")]
        linux::write(image.png()?)?;
        if !self.matches(image) {
            return Err("The clipboard write could not be verified. Nothing was staged.".into());
        }
        Ok(())
    }
    /// Read-only. Never repair a replaced clipboard during Stage.
    pub fn matches(&mut self, expected: &Pixels) -> bool {
        #[cfg(not(target_os = "linux"))]
        {
            self.0.get_image().is_ok_and(|actual| {
                actual.width == expected.width as usize
                    && actual.height == expected.height as usize
                    && actual.bytes.as_ref() == expected.rgba
            })
        }
        #[cfg(target_os = "linux")]
        {
            linux::read().is_ok_and(|actual| &actual == expected)
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use screenfling::model::MAX_IMAGE_BYTES;
    use sdl3_sys::{
        clipboard::{SDL_ClearClipboardData, SDL_GetClipboardData, SDL_SetClipboardData},
        stdinc::SDL_free,
    };
    use std::{
        ffi::{c_char, c_void},
        io::Cursor,
    };
    unsafe extern "C" fn provide(
        userdata: *mut c_void,
        _: *const c_char,
        size: *mut usize,
    ) -> *const c_void {
        // SDL owns the allocation after SDL_SetClipboardData, even if its backend fails.
        let bytes = unsafe { &*userdata.cast::<Vec<u8>>() };
        unsafe {
            *size = bytes.len();
        }
        bytes.as_ptr().cast()
    }
    unsafe extern "C" fn cleanup(userdata: *mut c_void) {
        if !userdata.is_null() {
            drop(unsafe { Box::from_raw(userdata.cast::<Vec<u8>>()) });
        }
    }
    pub fn write(png: Vec<u8>) -> Result<()> {
        let data = Box::into_raw(Box::new(png));
        let mimes = [c"image/png".as_ptr()];
        // Called on the main thread after successful video initialization, with valid
        // callbacks and MIME types. SDL therefore owns data; cleanup is its only owner.
        if !unsafe {
            SDL_SetClipboardData(
                Some(provide),
                Some(cleanup),
                data.cast(),
                mimes.as_ptr(),
                mimes.len(),
            )
        } {
            unsafe {
                SDL_ClearClipboardData();
            }
            return Err("The desktop did not accept the image clipboard.".into());
        }
        Ok(())
    }
    pub fn read() -> Result<Pixels> {
        let mut len = 0usize;
        let pointer = unsafe { SDL_GetClipboardData(c"image/png".as_ptr(), &mut len) };
        if pointer.is_null() {
            return Err("The clipboard no longer contains an image.".into());
        }
        let result = if len == 0 || len > MAX_IMAGE_BYTES {
            Err("The clipboard image is too large or empty.".into())
        } else {
            let bytes = unsafe { std::slice::from_raw_parts(pointer.cast::<u8>(), len) };
            decode_png(bytes)
        };
        unsafe {
            SDL_free(pointer);
        }
        result
    }
    fn decode_png(bytes: &[u8]) -> Result<Pixels> {
        let mut limits = image::Limits::default();
        limits.max_alloc = Some(MAX_IMAGE_BYTES as u64);
        limits.max_image_width = Some(16384);
        limits.max_image_height = Some(16384);
        let mut header =
            image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png);
        header.limits(limits.clone());
        let (width, height) = header
            .into_dimensions()
            .map_err(|_| "Could not verify the clipboard image.")?;
        // Decoder limits apply to its source color type, not the later RGBA
        // conversion. A grayscale image can otherwise expand fourfold before
        // Pixels::new gets a chance to reject it. Inspect only the header first.
        if (width as usize)
            .checked_mul(height as usize)
            .and_then(|n| n.checked_mul(4))
            .is_none_or(|n| n > MAX_IMAGE_BYTES)
        {
            return Err("The clipboard image exceeds the RGBA size limit.".into());
        }
        let mut reader =
            image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png);
        reader.limits(limits);
        let rgba = reader
            .decode()
            .map_err(|_| "Could not verify the clipboard image.")?
            .into_rgba8();
        Pixels::new(rgba.width(), rgba.height(), rgba.into_raw())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn png_expansion_is_rejected_before_pixel_decoding() {
            // Valid 10000 x 10000 grayscale header, deliberately incomplete pixel
            // data. Header inspection must reject 400 MB RGBA before decoding,
            // not allocate a 100 MB grayscale buffer or merely fail on the payload.
            let oversized = [
                137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 39, 16, 0,
                0, 39, 16, 8, 0, 0, 0, 0, 159, 37, 61, 251, 0, 0, 0, 10, 73, 68, 65, 84, 120,
                156, 99, 96, 4, 0, 0, 3, 0, 2, 75, 245, 221, 234, 0, 0, 0, 0, 73, 69, 78, 68,
                174, 66, 96, 130,
            ];
            assert_eq!(
                decode_png(&oversized).unwrap_err(),
                "The clipboard image exceeds the RGBA size limit."
            );
            let small = Pixels::new(1, 1, vec![12, 34, 56, 255]).unwrap();
            assert_eq!(decode_png(&small.png().unwrap()).unwrap(), small);
        }
    }
}
