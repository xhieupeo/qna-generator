import sharp from "sharp";

export interface EnhancementOptions {
  targetWidth?: number;
  contrastNormalize?: boolean;
  sharpen?: boolean;
  trimDeadSpace?: boolean;
}

/**
 * Enhances image quality for low-resolution, blurry, or washed-out exam screenshots:
 * - Trims vast dead whitespace bands so small text/questions fill the vision viewport
 * - Flattens alpha channels onto pure white background (prevents black background inversion on JPEG conversion)
 * - Upscales small thumbnails (e.g. 400x150) to readable resolution using Lanczos3
 * - Normalizes contrast to eliminate screen glare and make text dark & crisp
 * - Applies tuned unsharp mask convolution to sharpen math symbols, subscripts, and code punctuation without ringing
 * - Auto-orients mobile photos
 */
export async function enhanceQuestionImage(
  inputBuffer: Buffer,
  options: EnhancementOptions = {}
): Promise<{ buffer: Buffer; mimeType: string }> {
  const targetWidth = options.targetWidth || 1800;

  try {
    let pipeline = sharp(inputBuffer).rotate(); // Auto-rotate via EXIF

    const metadata = await pipeline.metadata();
    const width = metadata.width || 800;
    const height = metadata.height || 600;

    // 1. Content-aware dead whitespace trimming:
    // If an image has question text in the top 20-30% and an enormous empty white canyon before a bottom watermark,
    // crop to the content so downsampling doesn't wash away 8px fonts.
    if (options.trimDeadSpace !== false && height > 280 && width > 400) {
      try {
        const { data, info } = await sharp(inputBuffer)
          .flatten({ background: "#ffffff" })
          .raw()
          .toBuffer({ resolveWithObject: true });

        let lastContentY = 0;
        const scanHeightLimit = Math.floor(info.height * 0.85); // Skip bottom 15% (watermark/logo)

        for (let y = 0; y < scanHeightLimit; y += 2) {
          let darkCount = 0;
          for (let x = 0; x < info.width; x += 3) {
            const idx = (y * info.width + x) * info.channels;
            if (data[idx] < 225 || data[idx + 1] < 225 || data[idx + 2] < 225) {
              darkCount++;
              if (darkCount > 4) break;
            }
          }
          if (darkCount > 4) {
            lastContentY = y;
          }
        }

        // If main text ends before 65% of the height, trim the dead white canyon
        if (lastContentY > 40 && lastContentY < info.height * 0.65) {
          const cropH = Math.min(info.height, lastContentY + 45);
          pipeline = pipeline.extract({
            left: 0,
            top: 0,
            width: info.width,
            height: cropH,
          });
        }
      } catch {
        // Safe fallback to untrimmed if extraction fails
      }
    }

    const isTiny = width < 600;

    // 2. Flatten transparency to solid white (prevents pitch-black inversion for PNG/WebP)
    pipeline = pipeline.flatten({ background: "#ffffff" });

    // 3. Upscale if small or compressed
    if (width < targetWidth) {
      pipeline = pipeline.resize({
        width: isTiny ? Math.min(targetWidth, 1400) : targetWidth,
        withoutEnlargement: false,
        kernel: sharp.kernel.lanczos3,
      });
    }

    // 4. Contrast Normalization (stretches dark text to solid black, background to clean white)
    if (options.contrastNormalize !== false) {
      pipeline = pipeline.normalize();
    }

    // 5. Sharpening filter: tuned parameters to prevent ringing noise around formulas
    if (options.sharpen !== false && !isTiny) {
      pipeline = pipeline.sharpen({
        sigma: 1.0,
        m1: 0.5,
        m2: 0.8,
      });
    }

    // 6. Output as clean high-quality JPEG
    const outputBuffer = await pipeline
      .jpeg({
        quality: 92,
        chromaSubsampling: "4:4:4",
      })
      .toBuffer();

    return {
      buffer: outputBuffer,
      mimeType: "image/jpeg",
    };
  } catch (err) {
    console.warn("Image enhancement fallback to original buffer:", err);
    return {
      buffer: inputBuffer,
      mimeType: "image/png",
    };
  }
}
