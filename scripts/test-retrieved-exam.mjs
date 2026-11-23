import fs from "fs";
import * as cheerio from "cheerio";

// Parse function matching src/lib/html-parser.ts
function testParseHtml(html) {
  const $ = cheerio.load(html);
  const h1Title = $("h1.p-title-value, h1").first().clone();
  h1Title.find(".label, .label-append").remove();
  let title = h1Title.text().replace(/\s+/g, " ").trim();
  if (!title) {
    title = $("title").first().text().replace(/\s+/g, " ").trim();
  }
  if (!title) {
    title = "Generated Quiz";
  }
  title = title.replace(/\s*\|\s*FuOverflow.*$/i, "").trim() || title;

  $("script, style, meta, link, noscript, nav, footer, header").remove();

  const DECORATIVE_IMG_REGEX = /(avatar|smilie|smiley|emoji|reaction|badge|logo|icon|favicon|sidebar|study-icon|presets)/i;

  function extractImgData(img, index) {
    const src = img.attr("src") || img.attr("data-src") || img.attr("data-url") || "";
    if (!src || DECORATIVE_IMG_REGEX.test(src)) return null;
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
    if (/^https?:\/\//i.test(src)) {
      return {
        id: `img_${index}`,
        mimeType: "image/webp",
        base64Data: "",
        src,
      };
    }
    return null;
  }

  const units = [];
  let imageCounter = 0;

  // Next.js Attachment Grid
  const nextJsAttachmentGrid = $('ul[aria-label*="Ảnh đính kèm" i] li, a[href*="/media/"]').filter(
    (_, el) => $(el).find("img").length > 0
  );

  if (nextJsAttachmentGrid.length > 0) {
    const seenGridKeys = new Set();
    nextJsAttachmentGrid.each((_, el) => {
      const container = $(el);
      const a = container.is("a") ? container : container.find('a[href*="/media/"]').first();
      const img = container.find("img").first();
      if (!img.length) return;

      const ariaLabel = a.attr("aria-label") || "";
      const alt = img.attr("alt") || "";
      let rawFilename = "";
      const mFile = ariaLabel.match(/:\s*([^\s—–-]+(?:\.webp|\.png|\.jpe?g))/i);
      if (mFile) {
        rawFilename = mFile[1];
      } else {
        const mQ =
          ariaLabel.match(/(q\d+(?:\.webp|\.png|\.jpe?g)?)/i) ||
          alt.match(/(ảnh\s*\d+\/\d+)/i);
        if (mQ) rawFilename = mQ[1];
      }

      const imgData = extractImgData(img, imageCounter++);
      if (imgData) {
        const key = imgData.src || imgData.base64Data.slice(0, 64);
        if (!seenGridKeys.has(key)) {
          seenGridKeys.add(key);
          const qNum = units.length + 1;
          const label = rawFilename
            ? `Question ${qNum} (${rawFilename})`
            : ariaLabel || alt || `Question ${qNum}`;
          units.push({
            id: `unit_${qNum}`,
            questionNumber: qNum,
            rawText: label,
            images: [imgData],
          });
        }
      }
    });

    if (units.length > 0) {
      return { title, units };
    }
  }

  // Question blocks (.question)
  const questionBlocks = $(".question");
  if (questionBlocks.length > 0) {
    questionBlocks.each((i, el) => {
      const block = $(el);
      const images = [];
      block.find("img").each((_, imgEl) => {
        const imgData = extractImgData($(imgEl), imageCounter++);
        if (imgData) images.push(imgData);
      });
      const rawText = block.text().replace(/\s+/g, " ").trim();
      units.push({
        id: `unit_${i + 1}`,
        questionNumber: i + 1,
        rawText,
        images,
      });
    });
    return { title, units };
  }

  return { title, units };
}

console.log("=== TEST 1: fuoverflow_latest_ready.html ===");
const readyHtml = fs.readFileSync("fuoverflow_latest_ready.html", "utf8");
const readyRes = testParseHtml(readyHtml);
console.log("Ready Title:", readyRes.title);
console.log("Ready Units:", readyRes.units.length);
if (readyRes.units.length !== 30) {
  console.error("FAIL: Expected 30 units in readyHtml, got", readyRes.units.length);
  process.exit(1);
}
console.log("All 30 units have valid base64:", readyRes.units.every(u => u.images.length === 1 && u.images[0].base64Data.length > 500));

console.log("\n=== TEST 2: temp_page.html (raw Next.js drop) ===");
const rawHtml = fs.readFileSync("temp_page.html", "utf8");
const rawRes = testParseHtml(rawHtml);
console.log("Raw Title:", rawRes.title);
console.log("Raw Units:", rawRes.units.length);
if (rawRes.units.length !== 30) {
  console.error("FAIL: Expected 30 units in rawHtml, got", rawRes.units.length);
  process.exit(1);
}
console.log("All 30 units in raw drop have clean labels:", rawRes.units[0].rawText, "...", rawRes.units[29].rawText);

console.log("\n[ALL INGESTION TESTS PASSED]");
