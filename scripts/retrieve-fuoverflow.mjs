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
  let pageTitle =
    $("h1.p-title-value").text().trim() ||
    $("title").text().trim() ||
    "fuoverflow_quiz";

  // Clean filename
  const cleanTitle = pageTitle
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

  const targetDir = path.resolve(outputDir, cleanTitle);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Find all candidate image URLs
  const candidateImages = [];
  const processedUrls = new Set();

  function addCandidate(src, caption = "") {
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
      absoluteUrl.includes("/smilies/") ||
      absoluteUrl.includes("/avatars/") ||
      absoluteUrl.includes("favicon") ||
      absoluteUrl.endsWith(".svg")
    ) {
      return;
    }

    if (!processedUrls.has(absoluteUrl)) {
      processedUrls.add(absoluteUrl);
      candidateImages.push({
        url: absoluteUrl,
        caption,
      });
    }
  }

  // 1. Check forum attachments (<a class="js-lbImage" href="...">)
  $("a.js-lbImage, a.lbImage").each((_, el) => {
    const href = $(el).attr("href");
    const caption = $(el).attr("data-caption") || $(el).text().trim();
    addCandidate(href, caption);
  });

  // 2. Check embedded BBCode images (<img class="bbImage" src="...">)
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

  // 3. Fallback: all images in post body
  if (candidateImages.length === 0) {
    $("img").each((_, el) => {
      const src = $(el).attr("src");
      addCandidate(src);
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
      let ext = downloaded.mimeType.split("/")[1] || "png";
      if (ext === "jpeg") ext = "jpg";
      const filename = `fuoverflow_q${i + 1}_${Date.now()}.${ext}`;
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
        return `
  <div class="question" style="margin-bottom: 24px; padding: 16px; border: 1px solid #0f172a;">
    <p><strong>Question ${idx + 1}:</strong> ${
          asset.caption || "Examine the question/diagram below and solve."
        }</p>
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

    console.log("\n=======================================================");
    console.log("SUCCESSFULLY RETRIEVED FU OVERFLOW IMAGES!");
    console.log(
      `- Downloaded Images: ${downloadedAssets.length} saved in ${targetDir}`
    );
    console.log(`- QnA Generator File: ${htmlOutputPath}`);
    console.log(`- Quick Access File: ${rootSamplePath}`);
    console.log("=======================================================");
    console.log(
      "\nYou can now drag and drop 'fuoverflow_latest_ready.html' directly into your QnA Generator website to automatically create verified multiple-choice questions!"
    );
  }
}

run().catch((err) => {
  console.error("FATAL ERROR in FU Overflow retriever:", err);
  process.exit(1);
});
