import * as cheerio from "cheerio";
import type { ExtractedImage, ExtractedUnit } from "./types";

interface ParseOptions {
  assetFiles?: Map<string, { mimeType: string; base64Data: string }>;
  baseUrl?: string;
}

const IMAGE_EXT_REGEX = /\.(webp|png|jpe?g|gif|bmp|heic|heif)(\?.*)?$/i;
const DECORATIVE_IMG_REGEX = /(avatar|smilie|smiley|emoji|reaction|badge|logo|icon|favicon)/i;

function resolveAgainstBase(href: string, baseUrl?: string): string {
  const trimmed = (href || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:") || /^https?:\/\//i.test(trimmed)) return trimmed;
  if (!baseUrl) return trimmed;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

export function parseHtmlContent(
  html: string,
  options: ParseOptions = {}
): { title: string; units: ExtractedUnit[] } {
  const $ = cheerio.load(html);

  // Detect base URL from document metadata if not explicitly passed
  const detectedBase =
    options.baseUrl ||
    $("base").attr("href") ||
    $('link[rel="canonical"]').attr("href") ||
    $('meta[property="og:url"]').attr("content") ||
    undefined;

  // 1. Extract Clean Title
  const h1Title = $("h1.p-title-value").first().clone();
  h1Title.find(".label, .label-append").remove();
  let title = h1Title.text().replace(/\s+/g, " ").trim();
  if (!title) {
    title = $("title").first().text().replace(/\s+/g, " ").trim();
  }
  if (!title) {
    title = $("h1").first().text().replace(/\s+/g, " ").trim();
  }
  if (!title) {
    title = "Generated Quiz";
  }

  // 2. Remove non-exam UI chrome, navigation, menus, sidebars, breadcrumbs, and footers
  $(
    [
      "script",
      "style",
      "meta",
      "link",
      "noscript",
      "nav",
      "footer",
      "header",
      "aside",
      ".p-nav",
      ".p-navSticky",
      ".p-header",
      ".p-footer",
      ".p-breadcrumbs",
      ".p-body-sidebar",
      ".p-sectionLinks",
      ".p-staffBar",
      ".menu",
      ".sidebar",
      ".breadcrumb",
      ".breadcrumbs",
      ".pagination",
      ".pageNavWrapper",
      ".block-footer",
      ".reactionBar",
      ".reactionsBar",
      ".message-signature",
      ".message-userExtras",
      ".message-attribution",
      ".shareButtons",
      ".offCanvasMenu",
    ].join(", ")
  ).remove();

  // Helper to extract image data from an <img> element or URL string
  function extractImgFromSrc(
    rawSrc: string,
    index: number,
    fallbackRawSrc?: string
  ): ExtractedImage | null {
    const src = (rawSrc || "").trim();
    if (!src || DECORATIVE_IMG_REGEX.test(src)) return null;

    // 1. Check if it's base64 inline
    if (src.startsWith("data:")) {
      const match = src.match(/^data:([^;]+);base64,(.+)$/);
      if (match && !match[1].includes("svg")) {
        return {
          id: `img_${index}`,
          mimeType: match[1],
          base64Data: match[2],
          src,
        };
      }
      return null;
    }

    // 2. Check if it matches an asset file from a ZIP archive
    if (options.assetFiles) {
      const cleanSrc = src.replace(/^\.\//, "").replace(/^\//, "").split("?")[0];
      for (const [filename, asset] of Array.from(options.assetFiles.entries())) {
        const cleanFile = filename.split("?")[0];
        if (cleanFile.endsWith(cleanSrc) || cleanSrc.endsWith(cleanFile)) {
          return {
            id: `img_${index}`,
            mimeType: asset.mimeType,
            base64Data: asset.base64Data,
            src,
          };
        }
      }
    }

    // 3. Resolve remote URL (directly or via detected document baseUrl)
    const resolved = resolveAgainstBase(src, detectedBase);
    const resolvedFallback = fallbackRawSrc
      ? resolveAgainstBase(fallbackRawSrc, detectedBase)
      : undefined;

    if (/^https?:\/\//i.test(resolved)) {
      return {
        id: `img_${index}`,
        mimeType: "image/jpeg",
        base64Data: "",
        src: resolved,
        fallbackSrc:
          resolvedFallback && /^https?:\/\//i.test(resolvedFallback) && resolvedFallback !== resolved
            ? resolvedFallback
            : undefined,
      };
    }

    return null;
  }

  function extractImgData(img: cheerio.Cheerio<any>, index: number): ExtractedImage | null {
    const rawSrc = img.attr("src") || img.attr("data-src") || img.attr("data-url") || "";
    return extractImgFromSrc(rawSrc, index);
  }

  const units: ExtractedUnit[] = [];
  let imageCounter = 0;

  // 3A. Priority 1: XenForo Exam Attachment Cards (fuoverflow.com, fuexam.me, etc.)
  const fileAttachments = $("li.file");
  if (fileAttachments.length > 0) {
    fileAttachments.each((_, el) => {
      const li = $(el);
      const aPreview = li.find("a.file-preview");
      const img = li.find("img");
      const nameEl = li.find(".file-name");
      const filename = (
        nameEl.attr("title") ||
        nameEl.text().trim() ||
        img.attr("alt") ||
        ""
      ).trim();

      const fullHref = aPreview.attr("href") || "";
      const thumbSrc = img.attr("src") || img.attr("data-url") || img.attr("data-src") || "";

      // Skip non-image attachments (like .pdf/.docx) unless image tag exists
      const looksLikeImage =
        img.length > 0 || IMAGE_EXT_REGEX.test(filename) || IMAGE_EXT_REGEX.test(fullHref);
      if (!looksLikeImage) return;

      // Prefer embedded/zip thumbnail if local base64, otherwise try full attachment URL with thumbnail fallback
      let imgData: ExtractedImage | null = null;
      if (thumbSrc.startsWith("data:") || options.assetFiles) {
        imgData = extractImgFromSrc(thumbSrc, imageCounter++);
      }
      if (!imgData && fullHref) {
        imgData = extractImgFromSrc(fullHref, imageCounter++, thumbSrc || undefined);
      }
      if (!imgData && thumbSrc) {
        imgData = extractImgFromSrc(thumbSrc, imageCounter++);
      }

      if (imgData) {
        const qNum = units.length + 1;
        units.push({
          id: `unit_${qNum}`,
          questionNumber: qNum,
          rawText: filename ? `Question ${qNum} (${filename})` : `Question ${qNum}`,
          images: [imgData],
        });
      }
    });

    if (units.length > 0) {
      return { title, units };
    }
  }

  // 3B. Priority 2: Explicit Question / Quiz Containers
  const questionSelectors = [
    ".question",
    ".que",
    ".quiz-item",
    ".question-item",
    ".question-card",
    ".exam-question",
    "div[id^='question']",
    "div[class*='question']",
    ".form-group",
  ];

  for (const selector of questionSelectors) {
    const matched = $(selector);
    if (matched.length > 0) {
      // Skip wrapper containers that hold nested matches
      const leafBlocks = matched.filter((_, el) => $(el).find(selector).length === 0);
      const blocks = leafBlocks.length > 0 ? leafBlocks : matched;

      blocks.each((_, el) => {
        const block = $(el);
        // Ignore login/search form-groups
        if (selector === ".form-group" && block.closest("form[action*='login'], form[action*='search']").length > 0) {
          return;
        }
        const images: ExtractedImage[] = [];

        block.find("img").each((__, imgEl) => {
          const imgData = extractImgData($(imgEl), imageCounter++);
          if (imgData) images.push(imgData);
        });

        const rawText = block.text().replace(/\s+/g, " ").trim();
        if (rawText.length > 10 || images.length > 0) {
          const qNum = units.length + 1;
          units.push({
            id: `unit_${qNum}`,
            questionNumber: qNum,
            rawText,
            images,
          });
        }
      });

      if (units.length > 0) {
        return { title, units };
      }
    }
  }

  // Scope remaining fallback searches strictly to main content regions if present
  const contentScope = $(
    ".message-body, .bbWrapper, article, main, #content, .content, .quiz-container, .exam-content"
  );
  const $scope = contentScope.length > 0 ? contentScope : $("body");

  // 3C. Priority 3: Inline Exam Images inside forum/article content (without li.file)
  const seenImgKeys = new Set<string>();
  $scope.find("a.js-lbImage, a[data-lb-sidebar-href]").each((_, el) => {
    const a = $(el);
    const img = a.find("img");
    const fullHref = a.attr("href") || "";
    const thumbSrc = img.attr("data-url") || img.attr("src") || img.attr("data-src") || "";
    const imgData = thumbSrc.startsWith("data:")
      ? extractImgFromSrc(thumbSrc, imageCounter++)
      : extractImgFromSrc(fullHref || thumbSrc, imageCounter++, thumbSrc);
    if (imgData) {
      const key = imgData.src || imgData.base64Data.slice(0, 64);
      if (!seenImgKeys.has(key)) {
        seenImgKeys.add(key);
        const qNum = units.length + 1;
        const alt = (img.attr("alt") || img.attr("title") || "").trim();
        units.push({
          id: `unit_${qNum}`,
          questionNumber: qNum,
          rawText: alt ? `Question ${qNum} (${alt})` : `Question ${qNum}`,
          images: [imgData],
        });
      }
    }
  });
  if (units.length > 0) {
    return { title, units };
  }

  // 4. Priority 4: Question Lists strictly inside content scope (skip nav/short UI items)
  const listItems = $scope.find("ol > li, ul > li");
  if (listItems.length >= 2) {
    listItems.each((_, el) => {
      const item = $(el);
      const images: ExtractedImage[] = [];

      item.find("img").each((__, imgEl) => {
        const imgData = extractImgData($(imgEl), imageCounter++);
        if (imgData) images.push(imgData);
      });

      const rawText = item.text().replace(/\s+/g, " ").trim();
      const looksSubstantive =
        images.length > 0 ||
        rawText.length >= 25 ||
        /^(question\s*\d+|q\d+|\d+[\.\):])/i.test(rawText);

      if (looksSubstantive) {
        const qNum = units.length + 1;
        units.push({
          id: `unit_${qNum}`,
          questionNumber: qNum,
          rawText,
          images,
        });
      }
    });

    if (units.length > 0) {
      return { title, units };
    }
  }

  // 5. Fallback: Parse paragraphs & standalone images inside content scope
  let currentUnit: ExtractedUnit = {
    id: "unit_1",
    questionNumber: 1,
    rawText: "",
    images: [],
  };

  let unitIndex = 1;

  $scope
    .find("p, h1, h2, h3, h4, table, img")
    .each((_, el) => {
      const elem = $(el);
      if (elem.is("img")) {
        const imgData = extractImgData(elem, imageCounter++);
        if (imgData) currentUnit.images.push(imgData);
      } else {
        const text = elem.text().replace(/\s+/g, " ").trim();
        if (text) {
          const looksLikeNewQuestion = /^(question\s*\d+|câu\s*\d+|\d+[\.\)])/i.test(text);
          if (
            looksLikeNewQuestion &&
            (currentUnit.rawText.length > 10 || currentUnit.images.length > 0)
          ) {
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

  return { title, units };
}
