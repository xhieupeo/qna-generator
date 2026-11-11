import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { ExtractedUnit, ExtractedImage } from "@/lib/types";
import { enhanceQuestionImage } from "@/lib/image-enhancer";
import { parseHtmlContent } from "@/lib/html-parser";
import { hydrateRemoteImages } from "@/lib/file-ingest";
import { assertSafePublicUrl } from "@/lib/url-security";
import sharp from "sharp";

export const maxDuration = 60; // Safe maximum for Vercel Serverless Functions

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

/**
 * Custom fetch that handles redirects manually while strictly preserving and accumulating
 * Cookie, User-Agent, and Referer headers (Node fetch by default drops cookies on 302 redirects).
 */
async function fetchWithCookies(
  url: string,
  initialHeaders: Record<string, string>,
  maxRedirects = 5
): Promise<Response> {
  let currentUrl = url;
  const initialOrigin = assertSafePublicUrl(url).origin;
  const currentHeaders = { ...initialHeaders };

  // Parse existing cookies into a map
  const cookieMap = new Map<string, string>();
  if (currentHeaders["Cookie"]) {
    currentHeaders["Cookie"].split(";").forEach((pair) => {
      const [k, ...v] = pair.trim().split("=");
      if (k && v.length) cookieMap.set(k.trim(), v.join("=").trim());
    });
  }

  for (let i = 0; i < maxRedirects; i++) {
    const parsedHop = assertSafePublicUrl(currentUrl);
    const sameOrigin = parsedHop.origin === initialOrigin;

    // Only attach cookies on same-origin requests; never leak session cookies to third-party redirects
    if (sameOrigin && cookieMap.size > 0) {
      currentHeaders["Cookie"] = Array.from(cookieMap.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    } else {
      delete currentHeaders["Cookie"];
    }

    const res = await fetch(currentUrl, {
      headers: currentHeaders,
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
    });

    // Capture and accumulate Set-Cookie headers only for same-origin responses
    if (sameOrigin) {
      const setCookies = (res.headers as any).getSetCookie
        ? (res.headers as any).getSetCookie()
        : [res.headers.get("set-cookie")].filter(Boolean);

      for (const sc of setCookies) {
        if (typeof sc === "string") {
          const firstPart = sc.split(";")[0];
          const [k, ...v] = firstPart.trim().split("=");
          if (k && v.length) {
            cookieMap.set(k.trim(), v.join("=").trim());
          }
        }
      }
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) break;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return res;
  }

  const finalParsed = assertSafePublicUrl(currentUrl);
  if (finalParsed.origin !== initialOrigin) {
    delete currentHeaders["Cookie"];
  }
  return await fetch(currentUrl, {
    headers: currentHeaders,
    signal: AbortSignal.timeout(6000),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url, cookie, limit } = body;

    if (!url || !url.startsWith("http")) {
      return NextResponse.json(
        { error: "A valid exam webpage or thread URL is required (e.g., https://fuexam.me/threads/... or https://fuoverflow.com/threads/...)." },
        { status: 400 }
      );
    }

    let parsedUrl: URL;
    try {
      parsedUrl = assertSafePublicUrl(url);
    } catch (urlErr: any) {
      return NextResponse.json(
        { error: urlErr?.message || "Invalid or blocked URL." },
        { status: 400 }
      );
    }
    const origin = parsedUrl.origin;

    const headers: Record<string, string> = {
      "User-Agent": DEFAULT_USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
      Referer: `${origin}/`,
    };

    const allowEnvFallback = process.env.ALLOW_SERVER_KEY_FALLBACK === "true";
    let cookieString = (
      cookie ||
      (allowEnvFallback ? process.env.FUO_COOKIE : "") ||
      ""
    ).trim();
    if (cookieString) {
      // Auto-normalize if user pasted with colons or newlines: "xf_user:val\nxf_session:val" -> "xf_user=val; xf_session=val"
      cookieString = cookieString
        .split(/[\r\n;]+/)
        .map((p: string) => p.trim())
        .filter(Boolean)
        .map((p: string) => {
          if (!p.includes("=") && p.includes(":")) {
            const idx = p.indexOf(":");
            return `${p.slice(0, idx).trim()}=${p.slice(idx + 1).trim()}`;
          }
          return p;
        })
        .join("; ");

      headers["Cookie"] = cookieString;
    }

    // 1. Fetch Thread HTML using custom cookie-preserving fetch
    const pageRes = await fetchWithCookies(url, headers);
    if (!pageRes.ok) {
      if (pageRes.status === 403) {
        return NextResponse.json(
          {
            error:
              "Blocked by target site (HTTP 403 Forbidden). Sites behind Cloudflare or anti-bot firewalls block requests from Vercel server IPs and reject IP-bound cookies. Workaround: open the thread in your own browser, export it via the Tampermonkey script (scripts/fuo-extension.user.js) or Save As 'Webpage, Complete' (.zip), then upload it in the [ UPLOAD HTML / ZIP FILE ] tab.",
          },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: `Failed to fetch exam page: HTTP ${pageRes.status} ${pageRes.statusText}` },
        { status: 400 }
      );
    }

    const html = await pageRes.text();
    const $ = cheerio.load(html);

    // Check if session cookie is authenticated
    const isLoggedIn =
      $("html").attr("data-logged-in") === "true" ||
      $("a[href*='/account/']").length > 0 ||
      $(".p-navgroup-link--user").length > 0;
    let authWarning: string | null = null;
    if (cookieString && !isLoggedIn) {
      authWarning =
        "Notice: The provided session cookie was not recognized as logged in by FU Overflow. Full-HD images might be restricted to guest thumbnails. Make sure your cookie string contains valid 'xf_user' and 'xf_session'.";
    }

    // 2. Extract Title & Subject Code
    const h1 = $("h1.p-title-value");
    h1.find(".label, .label-append").remove();
    let title = h1.text().replace(/\s+/g, " ").trim();
    if (!title) {
      title = $("title").text().trim() || "FU Overflow Exam";
    }

    let subjectCode = "GENERAL";
    $("ul.p-breadcrumbs li a").each((_, el) => {
      const text = $(el).text().trim();
      const match = text.match(/\b([A-Za-z]{2,4}\d{2,4}[A-Za-z]?)\b/);
      if (match) {
        subjectCode = match[1].toUpperCase();
      }
    });

    if (subjectCode === "GENERAL") {
      const match = title.match(/\b([A-Za-z]{2,4}\d{2,4}[A-Za-z]?)\b/);
      if (match) {
        subjectCode = match[1].toUpperCase();
      }
    }

    // 3. Extract Candidate Image Items
    interface CandidateItem {
      rawFilename: string;
      fullImageUrl: string;
      thumbnailUrl: string;
      mediaUrl: string;
    }

    const candidateItems: CandidateItem[] = [];
    const seenUrls = new Set<string>();

    function resolveUrl(href: string): string {
      if (!href) return "";
      try {
        return new URL(href, url).toString();
      } catch {
        return "";
      }
    }

    // Check standard attachment cards: <li class="file">
    $("li.file").each((_, el) => {
      const li = $(el);
      const aPreview = li.find("a.file-preview");
      const img = li.find("img");
      const nameEl = li.find(".file-name");

      // In XenForo, full-resolution attachment is href on a.file-preview
      const fullHref = aPreview.attr("href") || "";
      let mediaHref = aPreview.attr("data-lb-sidebar-href") || "";
      if (!mediaHref) {
        const extraHtml = aPreview.attr("data-lb-caption-extra-html") || "";
        const m = extraHtml.match(/href="(\/media\/[^"]+)"/);
        if (m) mediaHref = m[1];
      }

      const fullUrl = resolveUrl(fullHref);
      const thumbUrl = resolveUrl(img.attr("src") || img.attr("data-url") || "");
      const mediaUrl = resolveUrl(mediaHref.split("?")[0]);
      const filename =
        nameEl.attr("title") || nameEl.text().trim() || img.attr("alt") || "";

      const key = mediaUrl || fullUrl || thumbUrl;
      if (key && !seenUrls.has(key)) {
        seenUrls.add(key);
        candidateItems.push({
          rawFilename: filename || `Q${candidateItems.length + 1}.jpg`,
          fullImageUrl: fullUrl,
          thumbnailUrl: thumbUrl,
          mediaUrl,
        });
      }
    });

    // Check inline body images: .bbWrapper a.js-lbImage
    $(".bbWrapper a.js-lbImage, .bbWrapper a[data-lb-sidebar-href]").each((_, el) => {
      const a = $(el);
      const img = a.find("img");
      const fullHref = a.attr("href") || "";
      const mediaHref = a.attr("data-lb-sidebar-href") || "";

      const fullUrl = resolveUrl(fullHref);
      const thumbUrl = resolveUrl(img.attr("data-url") || img.attr("src") || "");
      const mediaUrl = resolveUrl(mediaHref.split("?")[0]);
      const filename = img.attr("alt") || img.attr("title") || "";

      const key = mediaUrl || fullUrl || thumbUrl;
      if (key && !seenUrls.has(key)) {
        seenUrls.add(key);
        candidateItems.push({
          rawFilename: filename || `Q${candidateItems.length + 1}.jpg`,
          fullImageUrl: fullUrl,
          thumbnailUrl: thumbUrl,
          mediaUrl,
        });
      }
    });

    // Fallback if no cards found
    if (candidateItems.length === 0) {
      $(".bbWrapper img, .message-body img").each((_, el) => {
        const img = $(el);
        const src = resolveUrl(img.attr("src") || img.attr("data-url") || "");
        if (src && !seenUrls.has(src) && !src.includes("avatar") && !src.includes("smilie")) {
          seenUrls.add(src);
          candidateItems.push({
            rawFilename: `Q${candidateItems.length + 1}.jpg`,
            fullImageUrl: src,
            thumbnailUrl: src,
            mediaUrl: "",
          });
        }
      });
    }

    // 3B. Fallback for generic open exam sites (non-XenForo pages)
    if (candidateItems.length === 0) {
      const genericParsed = parseHtmlContent(html, { baseUrl: url });
      if (genericParsed.units.length > 0) {
        let genericUnits = genericParsed.units;
        const parsedLimit = typeof limit === "number" ? limit : parseInt(String(limit || ""), 10);
        if (!isNaN(parsedLimit) && parsedLimit > 0) {
          genericUnits = genericUnits.slice(0, parsedLimit);
        }
        await hydrateRemoteImages(genericUnits, headers);
        const validUnits = genericUnits.filter(
          (u) => u.images.length > 0 || u.rawText.trim().length > 15
        );
        if (validUnits.length > 0) {
          return NextResponse.json({
            success: true,
            title: genericParsed.title || title,
            subjectCode,
            isLoggedIn,
            warning: authWarning,
            totalFound: validUnits.length,
            totalExtracted: validUnits.length,
            units: validUnits,
          });
        }
      }

      return NextResponse.json(
        { error: "No question images, attachments, or readable exam blocks were found on this URL." },
        { status: 404 }
      );
    }

    // Helper: Scrape comments for community answer votes
    async function scrapeMediaAnswer(mediaUrl: string): Promise<string | null> {
      if (!mediaUrl) return null;
      try {
        const mRes = await fetchWithCookies(mediaUrl, headers);
        if (!mRes.ok) return null;
        const mHtml = await mRes.text();
        const m$ = cheerio.load(mHtml);

        const votes: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
        m$("article.js-comment, div.js-comment, .comment-body").each((_, el) => {
          const text = m$(el).text().trim().toUpperCase();
          const match = text.match(/\b([A-D])\b/);
          if (match) {
            votes[match[1]] = (votes[match[1]] || 0) + 1;
          }
        });

        let topChoice: string | null = null;
        let maxVotes = 0;
        for (const [choice, count] of Object.entries(votes)) {
          if (count > maxVotes) {
            maxVotes = count;
            topChoice = choice;
          }
        }
        return topChoice;
      } catch {
        return null;
      }
    }

    // Helper to download image buffer with redirect cookie retention and resolution checks
    async function downloadImageBuffer(item: CandidateItem): Promise<ExtractedImage | null> {
      const targetUrls = [item.fullImageUrl, item.thumbnailUrl].filter(Boolean);

      for (const imgUrl of targetUrls) {
        try {
          const res = await fetchWithCookies(imgUrl, headers);
          if (res.ok) {
            const contentType = res.headers.get("content-type") || "image/jpeg";
            if (contentType.includes("image")) {
              const arrayBuffer = await res.arrayBuffer();
              const rawBuffer = Buffer.from(arrayBuffer);

              if (rawBuffer.length > 500) {
                // Inspect resolution
                let isThumbnail = false;
                try {
                  const meta = await sharp(rawBuffer).metadata();
                  // Check if this is a tiny preview thumbnail (FU Overflow guest watermark)
                  if (meta.width && meta.width < 500 && meta.height && meta.height < 250) {
                    isThumbnail = true;
                  }
                } catch {
                  // ignore
                }

                // If this is full-res or the only available version, process it
                const enhanced = await enhanceQuestionImage(rawBuffer, {
                  // If it's a guest thumbnail, do not over-sharpen the pixelated blur
                  sharpen: !isThumbnail,
                  contrastNormalize: true,
                  targetWidth: isThumbnail ? 1200 : 1800,
                });

                return {
                  id: `img_${Date.now()}`,
                  mimeType: enhanced.mimeType,
                  base64Data: enhanced.buffer.toString("base64"),
                  src: imgUrl,
                };
              }
            }
          }
        } catch (e) {
          console.warn(`Failed to fetch from ${imgUrl}:`, e);
        }
      }
      return null;
    }

    // Apply requested question limit before downloading images
    const parsedLimit = typeof limit === "number" ? limit : parseInt(String(limit || ""), 10);
    const itemsToProcess =
      !isNaN(parsedLimit) && parsedLimit > 0
        ? candidateItems.slice(0, parsedLimit)
        : candidateItems;

    // 4. Download images in controlled concurrency (preserving Q1..QN alignment)
    const units: ExtractedUnit[] = [];
    const shouldScrapeMedia = origin.includes("fuoverflow") && itemsToProcess.length <= 30;

    for (let i = 0; i < itemsToProcess.length; i += 6) {
      const chunk = itemsToProcess.slice(i, i + 6);
      const results = await Promise.allSettled(
        chunk.map(async (item, chunkIdx) => {
          const globalIdx = i + chunkIdx;
          const [imgData, communityAnswer] = await Promise.all([
            downloadImageBuffer(item),
            shouldScrapeMedia && item.mediaUrl
              ? scrapeMediaAnswer(item.mediaUrl)
              : Promise.resolve(null),
          ]);

          return {
            id: `unit_${globalIdx + 1}`,
            questionNumber: globalIdx + 1,
            rawText: `Question ${globalIdx + 1} (${item.rawFilename})`,
            images: imgData ? [imgData] : [],
            communityAnswer,
            imageError: imgData
              ? undefined
              : `Could not download image for Question ${globalIdx + 1} (${item.rawFilename}). Check your session cookie or retry.`,
          } as ExtractedUnit;
        })
      );

      for (const res of results) {
        if (res.status === "fulfilled" && res.value) {
          units.push(res.value);
        }
      }
    }

    return NextResponse.json({
      success: true,
      title,
      subjectCode,
      isLoggedIn,
      warning: authWarning,
      totalFound: candidateItems.length,
      totalExtracted: units.length,
      units,
    });
  } catch (err: any) {
    console.error("FU Overflow scrape API error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to retrieve images from FU Overflow." },
      { status: 500 }
    );
  }
}
