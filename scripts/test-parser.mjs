import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";

function parseHtmlContent(html) {
  const $ = cheerio.load(html);
  let title = $("title").first().text().trim() || $("h1").first().text().trim() || "Generated Quiz";
  $("script, style, meta, link, noscript, nav, footer, header").remove();

  const units = [];
  let imageCounter = 0;

  function extractImgData(img, index) {
    const src = img.attr("src") || "";
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
    return null;
  }

  $(".question").each((i, el) => {
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

// Read sample_quiz.html
const htmlPath = path.resolve("sample_quiz.html");
const html = fs.readFileSync(htmlPath, "utf8");
const result = parseHtmlContent(html);

console.log("=== PARSER TEST RESULT ===");
console.log("Title:", result.title);
console.log("Total units found:", result.units.length);

result.units.forEach((u, idx) => {
  console.log(`\nUnit ${idx + 1}:`);
  console.log(" - Text:", u.rawText.slice(0, 80) + "...");
  console.log(" - Images attached:", u.images.length);
  if (u.images.length > 0) {
    console.log(" - Image MIME:", u.images[0].mimeType);
    console.log(" - Image Base64 length:", u.images[0].base64Data.length);
  }
});

if (result.units.length === 2 && result.units[0].images.length === 1) {
  console.log("\n[TEST PASSED] HTML & image extraction pipeline verified successfully!");
} else {
  console.error("\n[TEST FAILED] Unexpected extraction result.");
  process.exit(1);
}

