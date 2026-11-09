import sharp from "sharp";

export interface EnhancementOptions {
  targetWidth?: number;
  contrastNormalize?: boolean;
  sharpen?: boolean;
}

/**
 * Enhances image quality for low-resolution, blurry, or washed-out exam screenshots:
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
    const isTiny = Boolean(metadata.width && metadata.width < 600);

    // 1. Flatten transparency to solid white (prevents pitch-black inversion for PNG/WebP)
    pipeline = pipeline.flatten({ background: "#ffffff" });

    // 2. Upscale if small or compressed
    if (metadata.width && metadata.width < targetWidth) {
      pipeline = pipeline.resize({
        width: isTiny ? Math.min(targetWidth, 1400) : targetWidth,
        withoutEnlargement: false,
        kernel: sharp.kernel.lanczos3,
      });
    }

    // 3. Contrast Normalization (stretches dark text to solid black, background to clean white)
    if (options.contrastNormalize !== false) {
      pipeline = pipeline.normalize();
    }

    // 4. Sharpening filter: tuned parameters to prevent ringing noise around formulas
    if (options.sharpen !== false && !isTiny) {
      pipeline = pipeline.sharpen({
        sigma: 1.0,
        m1: 0.5,
        m2: 0.8,
      });
    }

    // 5. Output as clean high-quality JPEG
    const outputBuffer = await pipeline
      .jpeg({
        quality: 92,
        chromaSubsampling: "4:4:4", // Maintain full color fidelity for diagrams/charts
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
