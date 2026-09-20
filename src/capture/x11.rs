use super::Captured;
use crate::model::{MAX_IMAGE_BYTES, Pixels, Result};
use x11rb::{
    connection::Connection,
    protocol::{
        randr::ConnectionExt as _,
        xproto::{ConnectionExt as _, ImageFormat, ImageOrder, VisualClass},
    },
};

pub fn capture(pointer: [i32; 2]) -> Result<Captured> {
    let (connection, screen_index) = x11rb::connect(None).map_err(message)?;
    let screen = &connection.setup().roots[screen_index];
    let monitors = connection
        .randr_get_monitors(screen.root, true)
        .map_err(message)?
        .reply()
        .map_err(message)?;
    let monitor = monitors
        .monitors
        .iter()
        .find(|m| {
            pointer[0] >= i32::from(m.x)
                && pointer[1] >= i32::from(m.y)
                && pointer[0] < i32::from(m.x) + i32::from(m.width)
                && pointer[1] < i32::from(m.y) + i32::from(m.height)
        })
        .ok_or("The display under the pointer is unavailable.")?;
    let width = u32::from(monitor.width);
    let height = u32::from(monitor.height);
    if width as usize * height as usize * 4 > MAX_IMAGE_BYTES {
        return Err("This display is too large to capture safely.".into());
    }
    let reply = connection
        .get_image(
            ImageFormat::Z_PIXMAP,
            screen.root,
            monitor.x,
            monitor.y,
            monitor.width,
            monitor.height,
            u32::MAX,
        )
        .map_err(message)?
        .reply()
        .map_err(message)?;
    let after = connection
        .randr_get_monitors(screen.root, true)
        .map_err(message)?
        .reply()
        .map_err(message)?;
    if after.timestamp != monitors.timestamp
        || !after.monitors.iter().any(|m| {
            m.name == monitor.name
                && m.x == monitor.x
                && m.y == monitor.y
                && m.width == monitor.width
                && m.height == monitor.height
                && m.outputs == monitor.outputs
        })
    {
        return Err("The display layout changed during capture. Capture again.".into());
    }
    let format = connection
        .setup()
        .pixmap_formats
        .iter()
        .find(|f| f.depth == reply.depth)
        .ok_or("Unsupported X11 image format.")?;
    let visual = screen
        .allowed_depths
        .iter()
        .flat_map(|d| &d.visuals)
        .find(|v| v.visual_id == reply.visual)
        .ok_or("Unsupported X11 visual.")?;
    if visual.class != VisualClass::TRUE_COLOR
        || !matches!(format.bits_per_pixel, 16 | 24 | 32)
        || format.scanline_pad == 0
    {
        return Err("This X11 desktop does not expose a supported true-color image.".into());
    }
    let bpp = usize::from(format.bits_per_pixel) / 8;
    let pad = usize::from(format.scanline_pad);
    let stride = (width as usize * usize::from(format.bits_per_pixel)).div_ceil(pad) * pad / 8;
    if reply.data.len() < stride * height as usize {
        return Err("X11 returned an incomplete image.".into());
    }
    let masks = [visual.red_mask, visual.green_mask, visual.blue_mask];
    if masks.contains(&0) {
        return Err("X11 returned invalid color masks.".into());
    }
    let little = connection.setup().image_byte_order == ImageOrder::LSB_FIRST;
    let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
    for y in 0..height as usize {
        for bytes in reply.data[y * stride..y * stride + width as usize * bpp].chunks_exact(bpp) {
            let mut value = 0u32;
            for (i, byte) in bytes.iter().enumerate() {
                let shift = if little { i } else { bpp - 1 - i } * 8;
                value |= u32::from(*byte) << shift;
            }
            for mask in masks {
                let shift = mask.trailing_zeros();
                let maximum = mask >> shift;
                rgba.push((((value & mask) >> shift) as u64 * 255 / maximum as u64) as u8);
            }
            rgba.push(255);
        }
    }
    Ok(Captured {
        pixels: Pixels::new(width, height, rgba)?,
        bounds: Some([
            i32::from(monitor.x),
            i32::from(monitor.y),
            width as i32,
            height as i32,
        ]),
    })
}
fn message(_: impl std::fmt::Display) -> String {
    "Could not read the X11 desktop. Check the display connection and XRandR support.".into()
}
