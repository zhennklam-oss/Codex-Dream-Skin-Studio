use crate::{
    error::{StudioError, StudioResult},
    model::status::ImageMetadata,
};
use image::{ImageFormat, ImageReader};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

const MAX_IMAGE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_IMAGE_SIDE: u32 = 16_384;
const MAX_IMAGE_PIXELS: u64 = 50_000_000;

pub fn validate_image(path: &Path) -> StudioResult<ImageMetadata> {
    let canonical_path = path
        .canonicalize()
        .map_err(|error| StudioError::io("failed to locate image", error))?;
    let file_metadata = fs::metadata(&canonical_path)
        .map_err(|error| StudioError::io("failed to inspect image", error))?;
    if !file_metadata.is_file() {
        return Err(StudioError::new(
            "IMAGE_NOT_A_FILE",
            "image path is not a file",
        ));
    }
    if file_metadata.len() > MAX_IMAGE_BYTES {
        return Err(StudioError::new(
            "IMAGE_TOO_LARGE",
            "image exceeds the 16 MiB limit",
        ));
    }

    let reader = ImageReader::open(&canonical_path)
        .map_err(|error| StudioError::io("failed to open image", error))?
        .with_guessed_format()
        .map_err(|error| StudioError::io("failed to identify image format", error))?;
    let format = reader.format().ok_or_else(|| {
        StudioError::new("IMAGE_FORMAT_UNSUPPORTED", "image format is unsupported")
    })?;
    let format_name = match format {
        ImageFormat::Jpeg => "jpeg",
        ImageFormat::Png => "png",
        ImageFormat::WebP => "webp",
        _ => {
            return Err(StudioError::new(
                "IMAGE_FORMAT_UNSUPPORTED",
                "only PNG, JPEG, and WebP images are supported",
            ))
        }
    };
    let (width, height) = reader.into_dimensions().map_err(|error| {
        StudioError::new("IMAGE_DECODE_FAILED", "failed to read image dimensions")
            .with_detail(error.to_string())
    })?;
    if width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE {
        return Err(StudioError::new(
            "IMAGE_DIMENSIONS_TOO_LARGE",
            "image dimensions exceed 16384 pixels per side",
        ));
    }
    if u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS {
        return Err(StudioError::new(
            "IMAGE_TOO_MANY_PIXELS",
            "image exceeds the 50 megapixel limit",
        ));
    }

    let bytes = fs::read(&canonical_path)
        .map_err(|error| StudioError::io("failed to read image", error))?;
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    Ok(ImageMetadata {
        path: canonical_path,
        format: format_name.to_owned(),
        width,
        height,
        bytes: file_metadata.len(),
        sha256,
    })
}

pub fn extension_for_format(format: &str) -> StudioResult<&'static str> {
    match format {
        "jpeg" => Ok("jpg"),
        "png" => Ok("png"),
        "webp" => Ok("webp"),
        _ => Err(StudioError::new(
            "IMAGE_FORMAT_UNSUPPORTED",
            "image format is unsupported",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};
    use std::{fs, path::Path};
    use tempfile::tempdir;

    fn write_minimal_jpeg(path: &Path, width: u16, height: u16) {
        ImageBuffer::<Rgb<u8>, Vec<u8>>::new(u32::from(width), u32::from(height))
            .save(path)
            .unwrap();
    }

    fn crc32(bytes: &[u8]) -> u32 {
        let mut crc = u32::MAX;
        for byte in bytes {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = (crc >> 1) ^ (0xedb8_8320 & (0_u32.wrapping_sub(crc & 1)));
            }
        }
        !crc
    }

    fn write_png_header(path: &Path, width: u32, height: u32) {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut ihdr = b"IHDR".to_vec();
        ihdr.extend_from_slice(&width.to_be_bytes());
        ihdr.extend_from_slice(&height.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        bytes.extend_from_slice(&13_u32.to_be_bytes());
        bytes.extend_from_slice(&ihdr);
        bytes.extend_from_slice(&crc32(&ihdr).to_be_bytes());
        let mut idat = b"IDAT".to_vec();
        idat.extend_from_slice(&[
            0x78, 0x01, 0x01, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0x01,
        ]);
        bytes.extend_from_slice(&11_u32.to_be_bytes());
        bytes.extend_from_slice(&idat);
        bytes.extend_from_slice(&crc32(&idat).to_be_bytes());
        let iend = b"IEND";
        bytes.extend_from_slice(&0_u32.to_be_bytes());
        bytes.extend_from_slice(iend);
        bytes.extend_from_slice(&crc32(iend).to_be_bytes());
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn validates_supported_jpeg_and_reports_metadata() {
        let directory = tempdir().unwrap();
        let image = directory.path().join("valid.jpg");
        write_minimal_jpeg(&image, 640, 480);

        let metadata = validate_image(&image).unwrap();

        assert_eq!(metadata.path, image.canonicalize().unwrap());
        assert_eq!(metadata.format, "jpeg");
        assert_eq!((metadata.width, metadata.height), (640, 480));
        assert_eq!(metadata.bytes, fs::metadata(&image).unwrap().len());
        assert_eq!(metadata.sha256.len(), 64);
    }

    #[test]
    fn rejects_a_file_larger_than_sixteen_mib_before_decoding() {
        let directory = tempdir().unwrap();
        let image = directory.path().join("oversize.jpg");
        fs::File::create(&image)
            .unwrap()
            .set_len(16 * 1024 * 1024 + 1)
            .unwrap();

        assert_eq!(
            validate_image(&image).unwrap_err().code(),
            "IMAGE_TOO_LARGE"
        );
    }

    #[test]
    fn rejects_an_image_over_fifty_megapixels() {
        let directory = tempdir().unwrap();
        let image = directory.path().join("pixels.png");
        write_png_header(&image, 10_000, 6_000);

        assert_eq!(
            validate_image(&image).unwrap_err().code(),
            "IMAGE_TOO_MANY_PIXELS"
        );
    }

    #[test]
    fn rejects_an_image_over_the_per_side_dimension_limit() {
        let directory = tempdir().unwrap();
        let image = directory.path().join("too-wide.png");
        write_png_header(&image, MAX_IMAGE_SIDE + 1, 1);

        assert_eq!(
            validate_image(&image).unwrap_err().code(),
            "IMAGE_DIMENSIONS_TOO_LARGE"
        );
    }

    #[test]
    fn rejects_unsupported_gif_content_even_with_a_jpeg_extension() {
        let directory = tempdir().unwrap();
        let image = directory.path().join("not-really.jpg");
        fs::write(&image, b"GIF89a\x01\x00\x01\x00").unwrap();

        assert_eq!(
            validate_image(&image).unwrap_err().code(),
            "IMAGE_FORMAT_UNSUPPORTED"
        );
    }
}
