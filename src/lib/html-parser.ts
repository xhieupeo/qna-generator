import * as cheerio from "cheerio";
import { ExtractedImage, ExtractedUnit } from "./types";

interface ParseOptions {
  assetFiles?: Map<string, { mimeType: string; base64Data: string }>;
}

export function parseHtmlContent(
  html: string,
  options: ParseOptions = {}
): { title: string; units: ExtractedUnit[] } {
  const $ = cheerio.load(html);

  // 1. Extract Title
  let title = $("title").first().text().trim();
  if (!title) {
    title = $("h1").first().text().trim();
  }
  if (!title) {
    title = "Generated Quiz";
  }

  // 2. Remove script, style, meta, nav, footer tags that clutter question content
  $("script, style, meta, link, noscript, nav, footer, header").remove();

  // Helper to extract image data from an <img> element
  function extractImgData(img: cheerio.Cheerio<any>, index: number): ExtractedImage | null {
    const src = (img.attr("src") || img.attr("data-src") || "").trim();
    if (!src) return null;

    // Check if it's base64 inline
    if (src.startsWith("data:")) {
      const match = src.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        return {
          id: `img_${index}`,
          mimeType: match[1],
          base64Data: match[2],
          src,
        };
      }
    }

    // Check if it matches an asset file from a zip archive
    if (options.assetFiles) {
      // Normalize relative path
      const cleanSrc = src.replace(/^\.\//, "").replace(/^\//, "");
      for (const [filename, asset] of Array.from(options.assetFiles.entries())) {
        if (filename.endsWith(cleanSrc) || cleanSrc.endsWith(filename)) {
          return {
            id: `img_${index}`,
            mimeType: asset.mimeType,
            base64Data: asset.base64Data,
            src,
          };
        }
      }
    }

    // Preserve remote http(s) URL so server-side /api/parse can download it
    if (src.startsWith("http://") || src.startsWith("https://")) {
      return {
        id: `img_${index}`,
        mimeType: "image/jpeg",
        base64Data: "",
        src,
      };
    }

    return null;
  }

  const units: ExtractedUnit[] = [];
  let imageCounter = 0;

  // 3. Try to find explicit question blocks (skip outer wrapper containers that hold nested matches)
  const questionSelectors = [
    ".question",
    ".que",
    ".quiz-item",
    ".form-group",
    "div[id^='question']",
    "div[class*='question']",
  ];

  let foundExplicitBlocks = false;
  for (const selector of questionSelectors) {
    const matched = $(selector);
    if (matched.length > 0) {
      // Filter out wrapper elements that contain child elements matching the same selector
      const leafBlocks = matched.filter((_, el) => $(el).find(selector).length === 0);
      const blocks = leafBlocks.length > 0 ? leafBlocks : matched;

      blocks.each((i, el) => {
        const block = $(el);
        const images: ExtractedImage[] = [];

        block.find("img").each((_, imgEl) => {
          const imgData = extractImgData($(imgEl), imageCounter++);
          if (imgData) images.push(imgData);
        });

        const rawText = block.text().replace(/\s+/g, " ").trim();
        if (rawText.length > 5 || images.length > 0) {
          units.push({
            id: `unit_${units.length + 1}`,
            questionNumber: units.length + 1,
            rawText,
            images,
          });
        }
      });

      if (units.length > 0) {
        foundExplicitBlocks = true;
        break;
      }
    }
  }

  // 4. Fallback: If no explicit question classes, check ordered list items or headings
  if (!foundExplicitBlocks) {
    const listItems = $("ol > li, ul > li");
    if (listItems.length >= 2) {
      foundExplicitBlocks = true;
      listItems.each((i, el) => {
        const item = $(el);
        const images: ExtractedImage[] = [];

        item.find("img").each((_, imgEl) => {
          const imgData = extractImgData($(imgEl), imageCounter++);
          if (imgData) images.push(imgData);
        });

        const rawText = item.text().replace(/\s+/g, " ").trim();
        if (rawText.length > 5 || images.length > 0) {
          units.push({
            id: `unit_${i + 1}`,
            questionNumber: i + 1,
            rawText,
            images,
          });
        }
      });
    }
  }

  // 5. Fallback: Parse paragraphs & standalone images
  if (!foundExplicitBlocks || units.length === 0) {
    // Gather all paragraphs and images sequentially
    let currentUnit: ExtractedUnit = {
      id: "unit_1",
      questionNumber: 1,
      rawText: "",
      images: [],
    };

    let unitIndex = 1;

    $("body")
      .find("p, h1, h2, h3, h4, table, img")
      .each((_, el) => {
        const elem = $(el);
        if (elem.is("img")) {
          const imgData = extractImgData(elem, imageCounter++);
          if (imgData) currentUnit.images.push(imgData);
        } else {
          const text = elem.text().replace(/\s+/g, " ").trim();
          if (text) {
            // If the text looks like a new question ("Question 1", "1.", etc.) start new unit
            const looksLikeNewQuestion = /^(question\s*\d+|\d+[\.\)])/i.test(text);
            if (looksLikeNewQuestion && (currentUnit.rawText.length > 10 || currentUnit.images.length > 0)) {
              units.push(currentUnit);
              unitIndex++;
              currentUnit = {
                id: `unit_${unitIndex}`,
                questionNumber: unitIndex,
                rawText: text,
                images: [],
              };
            } else {
              currentUnit.rawText += (currentUnit.rawText ? " \n " : "") + text;
            }
          }
        }
      });

    if (currentUnit.rawText.length > 5 || currentUnit.images.length > 0) {
      units.push(currentUnit);
    }
  }

  return { title, units };
}

