//! Conversion of packed desktop buffers. Row padding is never image data.
use crate::model::{MAX_IMAGE_BYTES, Pixels, Result};

pub fn packed_rgba(
    bytes: &[u8],
    width: u32,
    height: u32,
    offset: usize,
    stride: usize,
    blue_first: bool,
) -> Result<Pixels> {
    let row = (width as usize)
        .checked_mul(4)
        .ok_or("Invalid frame width.")?;
    let len = row
        .checked_mul(height as usize)
        .ok_or("Invalid frame size.")?;
    let end = (height as usize)
        .checked_sub(1)
        .and_then(|h| h.checked_mul(stride))
        .and_then(|n| n.checked_add(offset))
        .and_then(|n| n.checked_add(row));
    if width == 0
        || height == 0
        || len > MAX_IMAGE_BYTES
        || stride < row
        || end.is_none_or(|n| n > bytes.len())
    {
        return Err("The desktop returned an invalid pixel buffer.".into());
    }
    let mut rgba = Vec::with_capacity(len);
    for y in 0..height as usize {
        let start = offset + y * stride;
        for p in bytes[start..start + row].chunks_exact(4) {
            if blue_first {
                rgba.extend_from_slice(&[p[2], p[1], p[0], 255]);
            } else {
                rgba.extend_from_slice(&[p[0], p[1], p[2], 255]);
            }
        }
    }
    Pixels::new(width, height, rgba)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pixel_rows_respect_padding_and_bounds() {
        let data = [99, 3, 2, 1, 0, 88, 77, 6, 5, 4, 0];
        assert_eq!(
            packed_rgba(&data, 1, 2, 1, 6, true).unwrap().rgba,
            [1, 2, 3, 255, 4, 5, 6, 255]
        );
        assert!(packed_rgba(&[0; 3], 1, 1, 0, 4, false).is_err());
        assert!(packed_rgba(&[0; 8], 1, 2, usize::MAX, 4, false).is_err());
    }
}
