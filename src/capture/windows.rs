use super::Captured;
use crate::model::{Pixels, Result};

pub fn capture(pointer: [i32; 2]) -> Result<Captured> {
    let monitor = xcap::Monitor::from_point(pointer[0], pointer[1]).map_err(|_| "The display under the pointer is unavailable.")?;
    let bounds = [monitor.x().map_err(message)?, monitor.y().map_err(message)?, monitor.width().map_err(message)? as i32, monitor.height().map_err(message)? as i32];
    let image = monitor.capture_image().map_err(message)?;
    let after = [monitor.x().map_err(message)?, monitor.y().map_err(message)?, monitor.width().map_err(message)? as i32, monitor.height().map_err(message)? as i32];
    if bounds != after { return Err("The display changed during capture. Capture again.".into()); }
    let pixels = Pixels::new(image.width(), image.height(), image.into_raw())?.opaque();
    Ok(Captured { pixels, bounds: Some(bounds) })
}
fn message(_: impl std::fmt::Display) -> String { "Windows could not capture this display. Check that the desktop is unlocked and the display is connected.".into() }
