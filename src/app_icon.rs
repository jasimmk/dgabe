use sdl3::iostream::IOStream;
use sdl3::surface::Surface;
use sdl3::video::Window;

const BITMAP: &[u8] = include_bytes!("../assets/icons/app.bmp");

fn decode(bytes: &[u8]) -> Result<Surface<'static>, sdl3::Error> {
    let mut stream = IOStream::from_bytes(bytes)?;
    Surface::load_bmp_rw(&mut stream)
}

pub fn install(window: &mut Window, driver: &str) -> Result<(), sdl3::Error> {
    if driver == "dummy" {
        return Ok(());
    }
    let icon = decode(BITMAP)?;
    if window.set_icon(icon) {
        Ok(())
    } else {
        Err(sdl3::get_error())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_artwork_decodes_without_an_external_file() -> Result<(), sdl3::Error> {
        let icon = decode(BITMAP)?;
        assert_eq!(icon.size(), (256, 256));
        icon.with_lock(|pixels| {
            assert!(pixels.iter().any(|pixel| *pixel != pixels[0]));
        });
        Ok(())
    }

    #[test]
    fn damaged_bitmap_returns_the_decoder_error() {
        assert!(decode(b"invalid BMP data").is_err());
        assert!(decode(&BITMAP[..20]).is_err());
    }
}
