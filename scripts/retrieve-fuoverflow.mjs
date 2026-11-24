import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";

// Parse CLI Arguments
const args = process.argv.slice(2);
let targetUrl = "";
let inputFile = "";
let cookie = "";
let outputDir = "./fuoverflow_downloads";
let generateInlineHtml = true;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--url" && args[i + 1]) {
    targetUrl = args[++i];
  } else if (arg === "--file" && args[i + 1]) {
    inputFile = args[++i];
  } else if (arg === "--cookie" && args[i + 1]) {
    cookie = args[++i];
  } else if (arg === "--out" && args[i + 1]) {
    outputDir = args[++i];
  }
}

if (!targetUrl && !inputFile) {
  console.log(`
FU Overflow Image & Quiz Asset Retriever
=======================================
Usage:
  node scripts/retrieve-fuoverflow.mjs --url <FUOVERFLOW_URL> [options]
  node scripts/retrieve-fuoverflow.mjs --file <PATH_TO_HTML> [options]

Options:
  --cookie "<COOKIE_STRING>"   Optional session cookie for logged-in attachments
  --out <OUTPUT_DIR>           Directory to save images (default: ./fuoverflow_downloads)
  
Examples:
  node scripts/retrieve-fuoverflow.mjs --url "https://fuoverflow.com/threads/quiz-mas291.12345/"
  node scripts/retrieve-fuoverflow.mjs --file "./fuoverflow_quiz.html"
`);
  process.exit(0);
}

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "vi,en-US;q=0.9,en;q=0.8",
  Referer: "https://fuoverflow.com/",
};

if (cookie) {
  // Normalize colon formatting or newlines if pasted as "xf_user:val"
  const normalizedCookie = cookie
    .split(/[\r\n;]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      if (!p.includes("=") && p.includes(":")) {
        const idx = p.indexOf(":");
        return `${p.slice(0, idx).trim()}=${p.slice(idx + 1).trim()}`;
      }
      return p;
    })
    .join("; ");

  headers["Cookie"] = normalizedCookie;
}

async function fetchWithCookies(url, reqHeaders, maxRedirects = 5) {
  let currentUrl = url;
  for (let i = 0; i < maxRedirects; i++) {
    const res = await fetch(currentUrl, {
      headers: reqHeaders,
      redirect: "manual",
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) break;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return res;
  }
  return await fetch(currentUrl, { headers: reqHeaders });
}

async function fetchPage(url) {
  console.log(`[1/4] Fetching page from: ${url}`);
  const res = await fetchWithCookies(url, headers);
  if (!res.ok) {
    throw new Error(`Failed to fetch page: HTTP ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

async function downloadImage(imgUrl, refUrl = "https://fuoverflow.com/") {
  try {
    const res = await fetchWithCookies(imgUrl, {
      ...headers,
      Referer: refUrl,
    });

    if (!res.ok) {
      console.warn(`    [!] Could not fetch image (${res.status}): ${imgUrl}`);
      return null;
    }

    const contentType = res.headers.get("content-type") || "image/png";
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString("base64");

    return {
      buffer,
      base64Data,
      mimeType: contentType.split(";")[0].trim(),
    };
  } catch (err) {
    console.warn(`    [!] Error downloading ${imgUrl}: ${err.message}`);
    return null;
  }
}

async function run() {
  let html = "";
  let baseUrl = "https://fuoverflow.com/";

  if (targetUrl) {
    html = await fetchPage(targetUrl);
    baseUrl = targetUrl;
  } else if (inputFile) {
    console.log(`[1/4] Reading local HTML file: ${inputFile}`);
    html = fs.readFileSync(path.resolve(inputFile), "utf8");
  }

  console.log("[2/4] Parsing FU Overflow DOM structure...");
  const $ = cheerio.load(html);

  // Extract Page / Thread Title
  let rawTitle =
    $("h1.p-title-value").text().trim() ||
    $("h1").first().text().trim() ||
    $("title").text().trim() ||
    "fuoverflow_quiz";

  // Clean title: strip " | FuOverflow Community..." and extra whitespace
  let pageTitle = rawTitle
    .replace(/\s*\|\s*FuOverflow.*$/i, "")
    .replace(/\s+/g, " ")
    .trim() || rawTitle;

  // Detect Subject Code if present (e.g. JPD113, DBI202)
  let subjectCode = "";
  const codeMatch = pageTitle.match(/\b([A-Za-z]{2,4}\d{2,4}[A-Za-z]?)\b/);
  if (codeMatch) {
    subjectCode = codeMatch[1].toUpperCase();
  }

  // Clean filename for output directory
  const cleanTitle = pageTitle
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

  const targetDir = path.resolve(outputDir, cleanTitle);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const DECORATIVE_REGEX =
    /(avatar|smilie|smiley|emoji|reaction|badge|logo|icon|favicon|sidebar|study-icon|presets)/i;

  // Find all candidate image URLs
  const candidateImages = [];
  const processedUrls = new Set();

  function addCandidate(src, caption = "", rawFilename = "") {
    if (!src) return;
    let absoluteUrl = src;
    if (src.startsWith("//")) {
      absoluteUrl = "https:" + src;
    } else if (src.startsWith("/")) {
      absoluteUrl = new URL(src, baseUrl).toString();
    } else if (
      !src.startsWith("http://") &&
      !src.startsWith("https://") &&
      !src.startsWith("data:")
    ) {
      absoluteUrl = new URL(src, baseUrl).toString();
    }

    if (
      DECORATIVE_REGEX.test(absoluteUrl) ||
      absoluteUrl.endsWith(".svg") ||
      absoluteUrl.includes("data:image/svg")
    ) {
      return;
    }

    if (!processedUrls.has(absoluteUrl)) {
      processedUrls.add(absoluteUrl);
      candidateImages.push({
        url: absoluteUrl,
        caption,
        rawFilename,
      });
    }
  }

  // 1. Next.js Attachment Grid: ul[aria-label*="Ảnh đính kèm"] li
  const nextGrid = $('ul[aria-label*="Ảnh đính kèm" i] li');
  if (nextGrid.length > 0) {
    nextGrid.each((idx, el) => {
      const a = $(el).find('a[href*="/media/"]').first();
      const img = $(el).find("img").first();
      if (!img.length) return;

      const src =
        img.attr("src") || img.attr("data-src") || img.attr("data-url") || "";
      const alt = img.attr("alt") || "";
      const ariaLabel = a.attr("aria-label") || "";

      // Extract filename from ariaLabel like "Xem ảnh 1 trên 30: q1.webp — dành cho..."
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

      const caption =
        ariaLabel || alt || (rawFilename ? `Question ${idx + 1} (${rawFilename})` : `Question ${idx + 1}`);
      addCandidate(src, caption, rawFilename);
    });
  }

  // 2. Next.js /media/ anchors with CDN exam images
  if (candidateImages.length === 0) {
    $('a[href*="/media/"]').each((idx, el) => {
      const img = $(el).find("img");
      if (!img.length) return;
      const src =
        img.attr("src") || img.attr("data-src") || img.attr("data-url") || "";
      const alt = img.attr("alt") || "";
      const ariaLabel = $(el).attr("aria-label") || "";
      let rawFilename = "";
      const mFile = ariaLabel.match(/:\s*([^\s—–-]+(?:\.webp|\.png|\.jpe?g))/i);
      if (mFile) rawFilename = mFile[1];
      addCandidate(src, ariaLabel || alt, rawFilename);
    });
  }

  // 3. Exam CDN direct images inside article cards (Next.js article.fuo-card)
  if (candidateImages.length === 0) {
    $("article.fuo-card img, article img, div[id^='post-'] img").each((idx, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src") || "";
      if (src && (src.includes("cdn.fuoverflow.com/exam") || src.includes("/attachments/"))) {
        const alt = $(el).attr("alt") || "";
        addCandidate(src, alt);
      }
    });
  }

  // 4. Legacy XenForo attachments (<a class="js-lbImage" href="...">, li.file)
  if (candidateImages.length === 0) {
    $("li.file").each((idx, el) => {
      const a = $(el).find("a.file-preview, a[href*='attachments/']");
      const img = $(el).find("img");
      const src =
        a.attr("href") ||
        img.attr("src") ||
        img.attr("data-url") ||
        img.attr("data-src") ||
        "";
      const name = $(el).find(".file-name").text().trim() || img.attr("alt") || "";
      addCandidate(src, name, name);
    });

    $("a.js-lbImage, a.lbImage").each((_, el) => {
      const href = $(el).attr("href");
      const caption = $(el).attr("data-caption") || $(el).text().trim();
      addCandidate(href, caption);
    });

    $("img.bbImage, .bbWrapper img, .message-content img, .attachmentImage").each(
      (_, el) => {
        const src =
          $(el).attr("src") ||
          $(el).attr("data-url") ||
          $(el).attr("data-src");
        const alt = $(el).attr("alt") || "";
        addCandidate(src, alt);
      }
    );
  }

  // 5. Strict Safe Fallback (only non-decorative images inside main content)
  if (candidateImages.length === 0) {
    $("article, main, #content").find("img").each((_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src") || "";
      if (src && !DECORATIVE_REGEX.test(src)) {
        addCandidate(src, $(el).attr("alt") || "");
      }
    });
  }

  console.log(
    `[3/4] Found ${candidateImages.length} relevant images/attachments on FU Overflow.`
  );

  if (candidateImages.length === 0) {
    console.log("No images found. Exiting.");
    return;
  }

  const downloadedAssets = [];

  // Download each image
  for (let i = 0; i < candidateImages.length; i++) {
    const item = candidateImages[i];
    console.log(
      `  Downloading image [${i + 1}/${candidateImages.length}]: ${item.url}`
    );

    if (item.url.startsWith("data:")) {
      const match = item.url.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const ext = match[1].split("/")[1] || "png";
        const filename = `image_${i + 1}.${ext}`;
        const filePath = path.join(targetDir, filename);
        fs.writeFileSync(filePath, Buffer.from(match[2], "base64"));
        downloadedAssets.push({
          filename,
          filePath,
          mimeType: match[1],
          base64Data: match[2],
          caption: item.caption,
        });
      }
      continue;
    }

    const downloaded = await downloadImage(item.url, baseUrl);
    if (downloaded) {
      let ext = downloaded.mimeType.split("/")[1] || "webp";
      if (ext === "jpeg") ext = "jpg";
      const filename = item.rawFilename || `q${i + 1}.${ext}`;
      const filePath = path.join(targetDir, filename);

      fs.writeFileSync(filePath, downloaded.buffer);
      console.log(`    -> Saved to: ${filePath}`);

      downloadedAssets.push({
        filename,
        filePath,
        mimeType: downloaded.mimeType,
        base64Data: downloaded.base64Data,
        caption: item.caption,
      });
    }
  }

  // [4/4] Generate QnA-ready Inlined HTML file
  if (generateInlineHtml && downloadedAssets.length > 0) {
    console.log(
      "\n[4/4] Assembling ready-to-use HTML file for QnA Generator..."
    );

    const questionBlocksHtml = downloadedAssets
      .map((asset, idx) => {
        const qTitle = asset.caption ? `Question ${idx + 1} (${asset.caption}):` : `Question ${idx + 1}:`;
        return `
  <div class="question" style="margin-bottom: 24px; padding: 16px; border: 1px solid #0f172a; background-color: #ffffff;">
    <p><strong>${qTitle}</strong> Examine the question/diagram below and solve.</p>
    <img src="data:${asset.mimeType};base64,${
          asset.base64Data
        }" alt="FU Overflow Question ${
          idx + 1
        }" style="max-width: 100%; height: auto; display: block; margin: 12px 0;" />
  </div>`;
      })
      .join("\n");

    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${pageTitle}</title>
</head>
<body style="font-family: sans-serif; max-width: 800px; margin: 20px auto; padding: 0 16px;">
  <h1>${pageTitle}</h1>
  <p style="color: #64748b; font-size: 14px;">Source: FU Overflow (${baseUrl})</p>
  <hr style="margin: 20px 0; border: 1px solid #0f172a;" />
${questionBlocksHtml}
</body>
</html>`;

    const htmlOutputPath = path.join(targetDir, `${cleanTitle}_ready.html`);
    fs.writeFileSync(htmlOutputPath, fullHtml, "utf8");

    const rootSamplePath = path.resolve(`fuoverflow_latest_ready.html`);
    fs.writeFileSync(rootSamplePath, fullHtml, "utf8");

    // Generate JSON file with structured question image assets
    const quizJson = {
      title: pageTitle,
      subjectCode: subjectCode || undefined,
      sourceUrl: baseUrl,
      retrievedAt: new Date().toISOString(),
      totalQuestions: downloadedAssets.length,
      questions: downloadedAssets.map((asset, idx) => ({
        questionNumber: idx + 1,
        filename: asset.filename,
        caption: asset.caption || `Question ${idx + 1}`,
        mimeType: asset.mimeType,
        filePath: asset.filePath,
        dataUrl: `data:${asset.mimeType};base64,${asset.base64Data}`,
      })),
    };

    const jsonOutputPath = path.join(targetDir, `${cleanTitle}_ready.json`);
    fs.writeFileSync(jsonOutputPath, JSON.stringify(quizJson, null, 2), "utf8");

    const rootJsonPath = path.resolve(`fuoverflow_latest_ready.json`);
    fs.writeFileSync(rootJsonPath, JSON.stringify(quizJson, null, 2), "utf8");

    console.log("\n=======================================================");
    console.log("SUCCESSFULLY RETRIEVED FU OVERFLOW IMAGES!");
    console.log(
      `- Downloaded Images: ${downloadedAssets.length} saved in ${targetDir}`
    );
    console.log(`- HTML File (QnA Ready): ${htmlOutputPath}`);
    console.log(`- JSON File (Direct Data): ${jsonOutputPath}`);
    console.log(`- Quick Access HTML: ${rootSamplePath}`);
    console.log(`- Quick Access JSON: ${rootJsonPath}`);
    console.log("=======================================================");
    console.log(
      "\nYou can now use 'fuoverflow_latest_ready.html' or 'fuoverflow_latest_ready.json'!"
    );
  }
}

run().catch((err) => {
  console.error("FATAL ERROR in FU Overflow retriever:", err);
  process.exit(1);
});
