//! Image clipboard writes happen only through explicit Copy or Stage actions.
use screenfling::model::{Pixels, Result};

#[cfg(not(target_os = "linux"))]
pub struct Clipboard(arboard::Clipboard);
#[cfg(target_os = "linux")]
pub struct Clipboard;
impl Clipboard {
    pub fn new() -> Result<Self> {
        #[cfg(not(target_os = "linux"))]
        { arboard::Clipboard::new().map(Self).map_err(|_| "The image clipboard is unavailable.".into()) }
        #[cfg(target_os = "linux")]
        { Ok(Self) }
    }
    pub fn copy(&mut self, image: &Pixels) -> Result<()> {
        #[cfg(not(target_os = "linux"))]
        self.0.set_image(arboard::ImageData { width: image.width as usize, height: image.height as usize, bytes: std::borrow::Cow::Borrowed(&image.rgba) }).map_err(|_| "The image clipboard is busy or unavailable.")?;
        #[cfg(target_os = "linux")]
        linux::write(image.png()?)?;
        if !self.matches(image) { return Err("The clipboard write could not be verified. Nothing was staged.".into()); }
        Ok(())
    }
    /// Read-only. Never repair a replaced clipboard during Stage.
    pub fn matches(&mut self, expected: &Pixels) -> bool {
        #[cfg(not(target_os = "linux"))]
        { self.0.get_image().is_ok_and(|actual| actual.width == expected.width as usize && actual.height == expected.height as usize && actual.bytes.as_ref() == expected.rgba) }
        #[cfg(target_os = "linux")]
        { linux::read().is_ok_and(|actual| &actual == expected) }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use screenfling::model::MAX_IMAGE_BYTES;
    use std::{ffi::{c_char, c_void}, io::Cursor};
    use sdl3_sys::{clipboard::{SDL_ClearClipboardData, SDL_GetClipboardData, SDL_SetClipboardData}, stdinc::SDL_free};
    unsafe extern "C" fn provide(userdata: *mut c_void, _: *const c_char, size: *mut usize) -> *const c_void {
        // SDL owns the allocation after SDL_SetClipboardData, even if its backend fails.
        let bytes = unsafe { &*userdata.cast::<Vec<u8>>() };
        unsafe { *size = bytes.len(); }
        bytes.as_ptr().cast()
    }
    unsafe extern "C" fn cleanup(userdata: *mut c_void) {
        if !userdata.is_null() { drop(unsafe { Box::from_raw(userdata.cast::<Vec<u8>>()) }); }
    }
    pub fn write(png: Vec<u8>) -> Result<()> {
        let data = Box::into_raw(Box::new(png));
        let mimes = [c"image/png".as_ptr()];
        // Called on the main thread after successful video initialization, with valid
        // callbacks and MIME types. SDL therefore owns data; cleanup is its only owner.
        if !unsafe { SDL_SetClipboardData(Some(provide), Some(cleanup), data.cast(), mimes.as_ptr(), mimes.len()) } {
            unsafe { SDL_ClearClipboardData(); }
            return Err("The desktop did not accept the image clipboard.".into());
        }
        Ok(())
    }
    pub fn read() -> Result<Pixels> {
        let mut len = 0usize;
        let pointer = unsafe { SDL_GetClipboardData(c"image/png".as_ptr(), &mut len) };
        if pointer.is_null() { return Err("The clipboard no longer contains an image.".into()); }
        let result = if len == 0 || len > MAX_IMAGE_BYTES { Err("The clipboard image is too large or empty.".into()) }
        else {
            let bytes = unsafe { std::slice::from_raw_parts(pointer.cast::<u8>(), len) };
            let mut reader = image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png);
            let mut limits = image::Limits::default();
            limits.max_alloc = Some(MAX_IMAGE_BYTES as u64);
            limits.max_image_width = Some(16384);
            limits.max_image_height = Some(16384);
            reader.limits(limits);
            reader.decode().map_err(|_| "Could not verify the clipboard image.".into()).and_then(|image| {
                let rgba = image.into_rgba8();
                Pixels::new(rgba.width(), rgba.height(), rgba.into_raw())
            })
        };
        unsafe { SDL_free(pointer); }
        result
    }
}
