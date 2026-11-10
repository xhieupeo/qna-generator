import JSZip from "jszip";
import { parseHtmlContent } from "./html-parser";
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

  if (options.resolveRemoteImages) {
    await hydrateRemoteImages(parsed.units);
  }

  return parsed;
}

/**
 * Fetches remote http(s) image references found inside parsed HTML units and converts
 * valid images to base64. Fails gracefully on unreachable or non-image URLs.
 */
async function hydrateRemoteImages(units: ExtractedUnit[]): Promise<void> {
  const remoteImages = units
    .flatMap((u) => u.images)
    .filter((img) => !img.base64Data && img.src && /^https?:\/\//i.test(img.src));

  if (remoteImages.length === 0) return;

  // Cap concurrent downloads to avoid overwhelming the server or exceeding parse time
  const CONCURRENCY = 6;
  for (let i = 0; i < remoteImages.length; i += CONCURRENCY) {
    const batch = remoteImages.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (img) => {
        try {
          const res = await fetch(img.src!, {
            signal: AbortSignal.timeout(3500),
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; QnAGenerator/1.0)",
            },
          });
          if (!res.ok) return;
          const contentType = (res.headers.get("content-type") || "").toLowerCase();
          if (!contentType.startsWith("image/") || contentType.includes("svg")) return;

          const buf = Buffer.from(await res.arrayBuffer());
          // Skip tiny tracking pixels / UI icons (< 1.5 KB)
          if (buf.byteLength < 1500) return;

          img.mimeType = contentType.split(";")[0].trim();
          img.base64Data = buf.toString("base64");
        } catch {
          // Leave base64Data empty if remote fetch fails
        }
      })
    );
  }

  // Drop unresolved remote images so downstream AI solvers only receive valid image payloads
  for (const unit of units) {
    unit.images = unit.images.filter((img) => Boolean(img.base64Data));
  }
}

