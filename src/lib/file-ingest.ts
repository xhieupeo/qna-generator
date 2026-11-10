import JSZip from "jszip";
import sharp from "sharp";
import { parseHtmlContent } from "./html-parser";
import { enhanceQuestionImage } from "./image-enhancer";
import { ExtractedUnit } from "./types";

/**
 * Extracts HTML content and ZIP image assets from an uploaded .html, .htm, or .zip File
 * and parses it into structured question units.
 */
export async function parseUploadedExamFile(
  file: File,
  options: { resolveRemoteImages?: boolean } = {}
): Promise<{ title: string; units: ExtractedUnit[] }> {
  let htmlContent = "";
  const assetFiles = new Map<string, { mimeType: string; base64Data: string }>();
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith(".zip")) {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    let htmlFileEntry: JSZip.JSZipObject | null = null;
    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
      if (!zipEntry.dir && (relativePath.endsWith(".html") || relativePath.endsWith(".htm"))) {
        htmlFileEntry = zipEntry;
        break;
      }
    }

    if (!htmlFileEntry) {
      throw new Error("No .html or .htm file found inside the uploaded ZIP archive.");
    }

    htmlContent = await htmlFileEntry.async("text");

    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
      if (!zipEntry.dir) {
        const lower = relativePath.toLowerCase();
        let mimeType = "";
        if (lower.endsWith(".png")) mimeType = "image/png";
        else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mimeType = "image/jpeg";
        else if (lower.endsWith(".webp")) mimeType = "image/webp";
        else if (lower.endsWith(".gif")) mimeType = "image/gif";
        else if (lower.endsWith(".svg")) mimeType = "image/svg+xml";

        if (mimeType) {
          const base64Data = await zipEntry.async("base64");
          assetFiles.set(relativePath, { mimeType, base64Data });
        }
      }
    }
  } else {
    htmlContent = await file.text();
  }

  const parsed = parseHtmlContent(htmlContent, { assetFiles });

  // Enhance embedded base64/ZIP images once before downloading & enhancing remote images
  await enhanceUnitImages(parsed.units);

  if (options.resolveRemoteImages) {
    await hydrateRemoteImages(parsed.units);
  }

  return parsed;
}

/**
 * Enhances buffers for units that already have base64 image data (e.g. from HTML or ZIP).
 * Flattens transparency onto white and upscales small thumbnails to reduce OCR loops.
 */
async function enhanceUnitImages(units: ExtractedUnit[]): Promise<void> {
  const embedded = units
    .flatMap((u) => u.images)
    .filter((img) => Boolean(img.base64Data) && !img.mimeType.includes("svg"));

  const CONCURRENCY = 6;
  for (let i = 0; i < embedded.length; i += CONCURRENCY) {
    const batch = embedded.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (img) => {
        try {
          const rawBuf = Buffer.from(img.base64Data, "base64");
          if (rawBuf.byteLength < 500) return;

          let isSmall = false;
          try {
            const meta = await sharp(rawBuf).metadata();
            if (meta.width && meta.width < 600) {
              isSmall = true;
            }
          } catch {
            // ignore
          }

          const enhanced = await enhanceQuestionImage(rawBuf, {
            sharpen: !isSmall,
            contrastNormalize: true,
            targetWidth: isSmall ? 1200 : 1800,
          });
          img.base64Data = enhanced.buffer.toString("base64");
          img.mimeType = enhanced.mimeType;
        } catch {
          // Keep original base64Data if enhancement fails
        }
      })
    );
  }
}

async function fetchImageCandidate(
  targetUrl: string,
  extraHeaders: Record<string, string>
): Promise<{ buffer: Buffer; mimeType: string } | { status: number }> {
  const origin = new URL(targetUrl).origin;
  const maxAttempts = 2;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(5500),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Referer: `${origin}/`,
          ...extraHeaders,
        },
      });

      if (res.status === 429 || res.status === 503) {
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        return { status: res.status };
      }

      if (!res.ok) {
        return { status: res.status };
      }

      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      if (!contentType.startsWith("image/") || contentType.includes("svg")) {
        return { status: 415 };
      }

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength < 1500) {
        return { status: 204 };
      }

      return { buffer: buf, mimeType: contentType.split(";")[0].trim() };
    } catch {
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return { status: 0 };
    }
  }
  return { status: 0 };
}

/**
 * Fetches remote http(s) image references found inside parsed HTML units, enhances them,
 * and records `imageError` on units whose expected images could not be downloaded.
 */
export async function hydrateRemoteImages(
  units: ExtractedUnit[],
  extraHeaders: Record<string, string> = {}
): Promise<void> {
  const unitExpectations = new Map<ExtractedUnit, number>();
  const unitStatuses = new Map<ExtractedUnit, number[]>();

  const remoteItems: Array<{ unit: ExtractedUnit; img: ExtractedUnit["images"][number] }> = [];
  for (const unit of units) {
    const remoteForUnit = unit.images.filter(
      (img) => !img.base64Data && img.src && /^https?:\/\//i.test(img.src)
    );
    unitExpectations.set(unit, unit.images.length);
    unitStatuses.set(unit, []);
    for (const img of remoteForUnit) {
      remoteItems.push({ unit, img });
    }
  }

  if (remoteItems.length === 0) return;

  const CONCURRENCY = 4;
  for (let i = 0; i < remoteItems.length; i += CONCURRENCY) {
    const batch = remoteItems.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ unit, img }) => {
        const candidates = [img.src, img.fallbackSrc].filter(
          (u): u is string => Boolean(u && /^https?:\/\//i.test(u))
        );
        for (const targetUrl of candidates) {
          const result = await fetchImageCandidate(targetUrl, extraHeaders);
          if ("buffer" in result) {
            let isSmall = false;
            try {
              const meta = await sharp(result.buffer).metadata();
              if (meta.width && meta.width < 600) isSmall = true;
            } catch {
              // ignore
            }
            const enhanced = await enhanceQuestionImage(result.buffer, {
              sharpen: !isSmall,
              contrastNormalize: true,
              targetWidth: isSmall ? 1200 : 1800,
            });
            img.mimeType = enhanced.mimeType;
            img.base64Data = enhanced.buffer.toString("base64");
            img.src = targetUrl;
            break;
          } else {
            unitStatuses.get(unit)?.push(result.status);
          }
        }
      })
    );
  }

  // Drop unresolved image stubs and flag missing expected images explicitly
  for (const unit of units) {
    const expectedCount = unitExpectations.get(unit) || 0;
    unit.images = unit.images.filter((img) => Boolean(img.base64Data));
    if (expectedCount > 0 && unit.images.length === 0) {
      const codes = unitStatuses.get(unit) || [];
      if (codes.includes(403) || codes.includes(401)) {
        unit.imageError =
          "Image download blocked (HTTP 403/401). Try pasting the thread URL with your session cookie or saving a Complete Webpage ZIP.";
      } else {
        unit.imageError =
          "Failed to download question image from remote host. Try retrying or using a session cookie.";
      }
    }
  }
}
