//! Clipboard writes happen only through an explicit Copy or Send.
use screenfling::model::{Pixels, Result};

/// On Linux the clipboard is served by this process (arboard keeps a worker
/// thread for it), so ScreenFling must keep running until the image is pasted.
pub struct Clipboard(arboard::Clipboard);
impl Clipboard {
    pub fn new() -> Result<Self> {
        arboard::Clipboard::new()
            .map(Self)
            .map_err(|_| "The image clipboard is unavailable.".into())
    }
    pub fn copy(&mut self, image: &Pixels) -> Result<()> {
        // arboard writes the registered "PNG" format and CF_DIBV5 on Windows,
        // and image/png on X11 and Wayland.
        #[cfg(not(target_os = "macos"))]
        self.0
            .set_image(arboard::ImageData {
                width: image.width as usize,
                height: image.height as usize,
                bytes: std::borrow::Cow::Borrowed(&image.rgba),
            })
            .map_err(|_| "The image clipboard is busy or unavailable.")?;
        #[cfg(target_os = "macos")]
        macos::write(image)?;
        if !self.matches(image) {
            return Err("The clipboard write could not be verified. Try copying again.".into());
        }
        Ok(())
    }
    /// Read-only. Never overwrite an image replaced by another application.
    pub fn matches(&mut self, expected: &Pixels) -> bool {
        self.0.get_image().is_ok_and(|actual| {
            actual.width == expected.width as usize
                && actual.height == expected.height as usize
                && actual.bytes.as_ref() == expected.rgba
        })
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use image::{ExtendedColorType, ImageEncoder, codecs::tiff::TiffEncoder};
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{
        NSPasteboard, NSPasteboardItem, NSPasteboardTypePNG, NSPasteboardTypeTIFF,
    };
    use objc2_foundation::{NSArray, NSData};
    use screenfling::model::{Pixels, Result};

    /// One item, two representations. arboard alone writes an NSImage, which
    /// macOS stores as TIFF; readers that ask for public.png (Claude Code's
    /// «class PNGf», browsers) need PNG, while NSImage and arboard read TIFF.
    pub fn write(image: &Pixels) -> Result<()> {
        let png = image.png()?;
        let mut tiff = std::io::Cursor::new(Vec::new());
        TiffEncoder::new(&mut tiff)
            .write_image(
                &image.rgba,
                image.width,
                image.height,
                ExtendedColorType::Rgba8,
            )
            .map_err(|_| "The image could not be encoded.")?;
        // SAFETY: AppKit's pasteboard type constants are immutable statics.
        let (png_type, tiff_type) = unsafe { (NSPasteboardTypePNG, NSPasteboardTypeTIFF) };
        let item = NSPasteboardItem::new();
        if !item.setData_forType(&NSData::with_bytes(&png), png_type)
            || !item.setData_forType(&NSData::with_bytes(tiff.get_ref()), tiff_type)
        {
            return Err("The image clipboard is busy or unavailable.".into());
        }
        let pasteboard = NSPasteboard::generalPasteboard();
        pasteboard.clearContents();
        let items = NSArray::from_retained_slice(&[ProtocolObject::from_retained(item)]);
        if !pasteboard.writeObjects(&items)
            || pasteboard
                .dataForType(png_type)
                .is_none_or(|data| data.to_vec() != png)
        {
            return Err("The image clipboard is busy or unavailable.".into());
        }
        Ok(())
    }
}
