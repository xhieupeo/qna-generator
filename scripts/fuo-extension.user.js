// ==UserScript==
// @name         FU Overflow & FuExam to QnA Generator (1-Click Exporter)
// @namespace    https://github.com/xhieupeo/qna-generator
// @version      2.0.0
// @description  Extract all exam question Full-HD images & community answers from FU Overflow / FuExam threads using proven fuo-downloader selectors and CORS-bypass stream.
// @author       QnA Generator Team
// @match        https://fuoverflow.com/threads/*
// @match        http://fuoverflow.com/threads/*
// @match        https://fuexam.me/threads/*
// @match        http://fuexam.me/threads/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      *
// ==/UserScript==

(function () {
  "use strict";

  const DECORATIVE_REGEX = /(avatar|smilie|smiley|emoji|reaction|badge|logo|icon|favicon)/i;

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function resolveUrl(href) {
    if (!href) return "";
    try {
      return new URL(href, window.location.href).toString();
    } catch {
      return "";
    }
  }

  function parseHeaderContentType(rawHeaders) {
    if (!rawHeaders) return "";
    const match = String(rawHeaders).match(/^content-type:\s*([^\r\n;]+)/im);
    return match ? match[1].trim().toLowerCase() : "";
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("FileReader failed"));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * GM_xmlhttpRequest authenticated fetch.
   * Crucial: passes document.cookie and withCredentials to maintain logged-in XenForo session.
   */
  function gmRequest(url, { responseType = "blob", anonymous = false, timeout = 25000 } = {}) {
    return new Promise((resolve) => {
      if (typeof GM_xmlhttpRequest === "function") {
        const headers = {
          "Referer": window.location.href,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        };

        if (!anonymous && document.cookie) {
          headers["Cookie"] = document.cookie;
        }

        GM_xmlhttpRequest({
          method: "GET",
          url,
          responseType,
          anonymous,
          timeout,
          headers,
          withCredentials: !anonymous,
          onload: (res) => {
            resolve({
              ok: res.status >= 200 && res.status < 300,
              status: res.status,
              contentType: parseHeaderContentType(res.responseHeaders),
              response: res.response,
              text: typeof res.responseText === "string" ? res.responseText : "",
              finalUrl: res.finalUrl || url,
            });
          },
          onerror: (err) => {
            resolve({ ok: false, status: 0, contentType: "", response: null, text: "", error: "Network error" });
          },
          ontimeout: () => {
            resolve({ ok: false, status: 0, contentType: "", response: null, text: "", error: "Timeout" });
          },
        });
        return;
      }

      // Fallback if GM_xmlhttpRequest is not granted
      fetch(url, { credentials: anonymous ? "omit" : "include" })
        .then(async (res) => {
          const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
          const data = responseType === "blob" ? await res.blob() : await res.text();
          return {
            ok: res.ok,
            status: res.status,
            contentType,
            response: responseType === "blob" ? data : null,
            text: responseType === "text" ? data : "",
            finalUrl: res.url || url,
          };
        })
        .catch((err) => ({
          ok: false,
          status: 0,
          contentType: "",
          response: null,
          text: "",
          error: err?.message || "Fetch error",
        }))
        .then(resolve);
    });
  }

  /**
   * Downloads and validates an image, returning a base64 Data URL.
   */
  async function fetchValidImageDataUrl(url) {
    if (!url) return { ok: false, reason: "empty URL", dataUrl: null };
    if (url.startsWith("data:image/") && !url.startsWith("data:image/svg")) {
      return { ok: true, reason: "inline data URI", dataUrl: url };
    }

    // Try authenticated first (with cookies), then anonymous (for CDN redirects like Cloudflare R2 / AWS S3)
    let lastReason = "unknown";
    for (const anonymous of [false, true]) {
      const res = await gmRequest(url, { responseType: "blob", anonymous });
      if (!res.ok) {
        lastReason = `HTTP ${res.status}`;
        continue;
      }

      const blob = res.response;
      const mime = ((blob && blob.type) || res.contentType || "").toLowerCase();
      if (!blob || !mime.startsWith("image/") || mime.includes("svg") || blob.size < 400) {
        lastReason = `Non-image payload (${mime || "unknown"}, ${blob ? blob.size : 0}B)`;
        continue;
      }

      try {
        const dataUrl = await blobToDataUrl(blob);
        if (dataUrl.startsWith("data:image/")) {
          return { ok: true, reason: `HTTP ${res.status} (${mime}, ${Math.round(blob.size / 1024)}KB)`, dataUrl };
        }
      } catch (e) {
        lastReason = e?.message || "Blob conversion error";
      }
    }

    return { ok: false, reason: lastReason, dataUrl: null };
  }

  /**
   * Resolves the full image from XenForo Media Gallery (/media/...).
   * Follows fuo-downloader's approach with ?lightbox=1 fallback.
   */
  async function resolveMediaPageImageUrl(mediaUrl) {
    if (!mediaUrl) return { ok: false, reason: "no mediaUrl", imageUrl: "" };
    const cleanMediaUrl = mediaUrl.split("?")[0];

    // Try normal media URL first, then ?lightbox=1 fallback
    const urlsToTry = [cleanMediaUrl, `${cleanMediaUrl.replace(/\/+$/, "")}/?lightbox=1`];
    for (const tryUrl of urlsToTry) {
      const res = await gmRequest(tryUrl, { responseType: "text", anonymous: false });
      if (!res.ok || !res.text) continue;

      try {
        const doc = new DOMParser().parseFromString(res.text, "text/html");
        const selectors = [
          ".xfmgMedia-content img",
          ".media-container img",
          ".p-body-pageContent .media img",
          "a.xfmg-media-view img",
          'a[href*="/media/"][href*="/full"]',
          'meta[property="og:image"]',
        ];
        for (const sel of selectors) {
          const el = doc.querySelector(sel);
          if (!el) continue;
          const raw =
            el.getAttribute("content") ||
            el.getAttribute("href") ||
            el.getAttribute("src") ||
            el.getAttribute("data-src") ||
            "";
          const resolved = resolveUrl(raw);
          if (resolved && !DECORATIVE_REGEX.test(resolved)) {
            return { ok: true, reason: "resolved from /media/", imageUrl: resolved };
          }
        }
      } catch {
        // ignore parse error
      }
    }

    return { ok: false, reason: "no media img tag found", imageUrl: "" };
  }

  /**
   * Community answer extraction ported from fuo-downloader's comment_parser.py
   */
  const FILLER_WORDS_REGEX = /\b(?:nhé|nhe|nha|ạ|ạ|nhỉ|nhi|đúng\s*không|đúng\s*ko|đúng\s*rồi|đúng|chuẩn|chắc\s*chắn|chắc\s*luôn|100%|ơi|mọi\s*người|mn|các\s*bạn|bạn\s*ơi|anh\s*em|ae)\b/gi;
  const VIETNAMESE_STOPWORDS = new Set(["ca", "ba", "da", "ac", "ad", "be", "de", "fa", "fe", "cf", "cc", "dc"]);

  function normalizeAnswerString(raw) {
    if (!raw) return "";
    const cleaned = raw.replace(/\b(?:và|va|với|voi|and)\b/gi, ",");
    const letters = cleaned.match(/[A-Fa-f]/g);
    if (!letters) return "";
    return Array.from(new Set(letters.map((l) => l.toUpperCase()))).sort().join("");
  }

  function extractAnswerFromComment(text) {
    if (!text) return null;
    let clean = text.replace(/https?:\/\/\S+/g, " ").replace(/@\w+/g, " ");
    clean = clean.replace(/^\s*(?:câu|cau|q|question)?\s*\d+\s*[:.)-]?\s*/i, "").trim();
    if (!clean) return null;

    const stripped = clean.replace(FILLER_WORDS_REGEX, " ").replace(/[.!?:;~()[\]"'`❤️👍🔥]+/g, " ").trim();

    // Pattern A: Contiguous letters like A, B, ACD, BC
    if (/^[A-Fa-f]{1,6}$/.test(stripped)) {
      const lower = stripped.toLowerCase();
      if (lower === "dc" || lower === "cc") return null;
      if (stripped.length >= 2 && stripped === lower && VIETNAMESE_STOPWORDS.has(lower)) {
        if (["ca", "ba", "da", "be", "de", "fa", "fe"].includes(lower)) return null;
      }
      return normalizeAnswerString(stripped);
    }

    // Pattern B: Separated letters like A, C or A B C or A/B
    if (/^[A-Fa-f](?:\s*(?:,|\/|\+|&|-|\bvà\b|\bva\b|\bvới\b|\band\b|\s)\s*[A-Fa-f]){1,5}$/i.test(stripped)) {
      return normalizeAnswerString(stripped);
    }

    // Pattern C: Keyword pattern like "Đáp án: ACD", "Chọn B", "Ans: C"
    const mKw = clean.match(/(?:đáp\s*án|dap\s*an|chọn|chon|câu\s*này|theo\s*mình|ans(?:wer)?|kết\s*quả)\s*(?:là|la|chọn|chon)?\s*[:=-]?\s*([A-Fa-f](?:\s*(?:,|\/|\+|&|\bvà\b|\band\b)\s*[A-Fa-f])+|[A-Fa-f]{1,5})\b/i);
    if (mKw && !VIETNAMESE_STOPWORDS.has(mKw[1].toLowerCase())) {
      return normalizeAnswerString(mKw[1]);
    }

    // Pattern D: Leading letter followed by explanation like "A vì...", "B - do..."
    const mLead = clean.match(/^\s*([A-F](?:\s*(?:,|\/|\+|&|\bvà\b)\s*[A-F])+|[A-F]{1,5})\s*(?:[-:.,!()]|\b(?:nhé|nhe|nha|vì|vi|do|bởi|đúng|chuẩn)\b)/i);
    if (mLead) {
      return normalizeAnswerString(mLead[1]);
    }

    return null;
  }

  async function scrapeCommunityAnswerForMedia(mediaUrl) {
    if (!mediaUrl) return null;
    const cleanUrl = mediaUrl.split("?")[0];
    const res = await gmRequest(cleanUrl, { responseType: "text", anonymous: false });
    if (!res.ok || !res.text) return null;

    try {
      const doc = new DOMParser().parseFromString(res.text, "text/html");
      const commentNodes = doc.querySelectorAll("article.js-comment, div.js-comment, article.message--simple, div.comment");
      const votes = {};

      commentNodes.forEach((node) => {
        const clone = node.cloneNode(true);
        clone.querySelectorAll(".message-responses, .js-replyNewMessageContainer, blockquote, .bbCodeBlock--quote").forEach((el) => el.remove());
        const bodyEl = clone.querySelector(".bbWrapper, .comment-body, .message-body");
        if (!bodyEl) return;
        const text = bodyEl.textContent.trim();
        const ans = extractAnswerFromComment(text);
        if (ans) {
          votes[ans] = (votes[ans] || 0) + 1;
        }
      });

      const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
      if (sorted.length === 0) return null;

      const totalVotes = Object.values(votes).reduce((s, v) => s + v, 0);
      const topAnswer = sorted[0][0];
      const topCount = sorted[0][1];
      const ratio = Math.round((topCount / totalVotes) * 100);

      return {
        topAnswer,
        topCount,
        totalVotes,
        ratio,
        distribution: votes,
      };
    } catch {
      return null;
    }
  }

  /**
   * Canvas capture as final fallback for DOM loaded images.
   */
  async function captureViaCanvas(imgEl) {
    if (!imgEl) return { ok: false, reason: "no DOM img", dataUrl: null };

    if (!imgEl.complete || !imgEl.naturalWidth) {
      try {
        imgEl.loading = "eager";
        const lazySrc = imgEl.getAttribute("data-src") || imgEl.getAttribute("data-url");
        if (lazySrc && !imgEl.src) {
          imgEl.src = lazySrc;
        }
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 1500);
          imgEl.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
          imgEl.addEventListener("error", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      } catch {
        // ignore
      }
    }

    if (!imgEl.complete || !imgEl.naturalWidth || !imgEl.naturalHeight) {
      return { ok: false, reason: "DOM img not loaded (0x0)", dataUrl: null };
    }

    try {
      const canvas = document.createElement("canvas");
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return { ok: false, reason: "no 2D canvas context", dataUrl: null };
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imgEl, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.94);
      if (dataUrl.startsWith("data:image/")) {
        return { ok: true, reason: `Canvas captured (${canvas.width}x${canvas.height})`, dataUrl };
      }
      return { ok: false, reason: "empty canvas output", dataUrl: null };
    } catch (err) {
      return { ok: false, reason: `Canvas tainted (${err?.name || "security error"})`, dataUrl: null };
    }
  }

  // Modern Brutalist floating button
  const button = document.createElement("button");
  button.textContent = "⚡ EXPORT TO QNA GENERATOR";
  button.style.position = "fixed";
  button.style.top = "16px";
  button.style.right = "16px";
  button.style.zIndex = "999999";
  button.style.backgroundColor = "#0f172a";
  button.style.color = "#ffffff";
  button.style.border = "2px solid #0f172a";
  button.style.borderRadius = "0px";
  button.style.padding = "10px 16px";
  button.style.fontFamily = "monospace";
  button.style.fontSize = "12px";
  button.style.fontWeight = "bold";
  button.style.cursor = "pointer";
  button.style.boxShadow = "3px 3px 0px #2563eb";
  button.style.textTransform = "uppercase";

  button.addEventListener("mouseenter", () => {
    if (!button.disabled) button.style.backgroundColor = "#2563eb";
  });
  button.addEventListener("mouseleave", () => {
    if (!button.disabled) button.style.backgroundColor = "#0f172a";
  });

  button.addEventListener("click", async () => {
    button.textContent = "⏳ SCANNING THREAD...";
    button.disabled = true;

    try {
      // 1. Extract Clean Title & Subject Code (fuo-downloader parse_thread_metadata logic)
      const h1 = document.querySelector("h1.p-title-value");
      let title = document.title;
      let subjectCode = "EXAM";

      if (h1) {
        const clone = h1.cloneNode(true);
        clone.querySelectorAll(".label, .label-append").forEach((el) => el.remove());
        title = clone.textContent.replace(/\s+/g, " ").trim() || document.title;
      }

      // Detect Subject Code from breadcrumbs or title (e.g. DBI202, PRO192, MAD101)
      const breadcrumbLinks = document.querySelectorAll("ul.p-breadcrumbs li a");
      for (const bc of breadcrumbLinks) {
        const txt = bc.textContent.trim().toUpperCase();
        if (/^[A-Z]{2,4}\d{2,4}[A-Z]?$/.test(txt)) {
          subjectCode = txt;
          break;
        }
      }
      if (subjectCode === "EXAM") {
        const m = title.match(/\b([A-Za-z]{2,4}\d{2,4}[A-Za-z]?)\b/);
        if (m) subjectCode = m[1].toUpperCase();
      }

      // 2. Collect Candidate Items (fuo-downloader extract_question_items_from_page logic)
      const candidates = [];
      const seenKeys = new Set();

      function extractMediaHref(anchor) {
        if (!anchor) return "";
        let mediaHref = anchor.getAttribute("data-lb-sidebar-href") || "";
        if (!mediaHref) {
          const extraHtml = anchor.getAttribute("data-lb-caption-extra-html") || "";
          const m = extraHtml.match(/href="([^"]*\/media\/[^"]+)"/i);
          if (m) mediaHref = m[1];
        }
        return resolveUrl(mediaHref);
      }

      function addCandidate(fullUrl, mediaUrl, thumbUrl, imgEl, rawFilename) {
        const key = mediaUrl || fullUrl || thumbUrl;
        if (!key || seenKeys.has(key)) return;
        if (DECORATIVE_REGEX.test(key)) return;
        seenKeys.add(key);
        candidates.push({ fullUrl, mediaUrl, thumbUrl, imgEl, rawFilename });
      }

      // Priority 1: XenForo Attachment Cards (<li class="file">)
      document.querySelectorAll("li.file").forEach((li, idx) => {
        const a = li.querySelector("a.file-preview, a[href*='attachments/']");
        const img = li.querySelector("img");
        const nameEl = li.querySelector(".file-name");

        const fullUrl = a ? resolveUrl(a.getAttribute("href") || a.href) : "";
        const mediaUrl = extractMediaHref(a);
        const thumbUrl = img
          ? resolveUrl(img.getAttribute("data-src") || img.getAttribute("data-url") || img.getAttribute("src") || img.src || "")
          : "";
        const rawFilename =
          (nameEl && (nameEl.getAttribute("title") || nameEl.textContent.trim())) ||
          (img && img.getAttribute("alt")) ||
          `Q${idx + 1}.jpg`;

        addCandidate(fullUrl, mediaUrl, thumbUrl, img, rawFilename);
      });

      // Priority 2: Inline lightbox images (.bbWrapper a.js-lbImage)
      document.querySelectorAll(".bbWrapper a.js-lbImage, .bbWrapper a[href*='attachments/']").forEach((a, idx) => {
        const img = a.querySelector("img");
        const fullUrl = resolveUrl(a.getAttribute("href") || a.href || "");
        const mediaUrl = extractMediaHref(a);
        const thumbUrl = img
          ? resolveUrl(img.getAttribute("data-src") || img.getAttribute("data-url") || img.getAttribute("src") || img.src || "")
          : "";
        const rawFilename = (img && (img.getAttribute("alt") || img.getAttribute("title"))) || `Q${idx + 1}.jpg`;

        addCandidate(fullUrl, mediaUrl, thumbUrl, img, rawFilename);
      });

      // Priority 3: Fallback DOM images
      if (candidates.length === 0) {
        document.querySelectorAll(".bbWrapper img, .message-body img").forEach((img, idx) => {
          const src = resolveUrl(
            img.getAttribute("data-src") || img.getAttribute("data-url") || img.getAttribute("src") || img.src || ""
          );
          addCandidate("", "", src, img, img.getAttribute("alt") || `Q${idx + 1}.jpg`);
        });
      }

      if (candidates.length === 0) {
        alert("No question images found on this thread.");
        button.textContent = "⚡ EXPORT TO QNA GENERATOR";
        button.disabled = false;
        return;
      }

      // 3. Multi-Strategy Image & Community Answer Fetching
      const questionBlocks = [];
      const diagnosticErrors = [];
      let successCount = 0;

      for (let i = 0; i < candidates.length; i++) {
        const item = candidates[i];
        const qNum = i + 1;
        button.textContent = `📥 FETCHING (${qNum}/${candidates.length})...`;

        let dataUrl = null;
        let successNote = "";
        const stepErrors = [];

        // Tier 1: Direct Full-HD Attachment URL with session cookies
        if (item.fullUrl) {
          const fullRes = await fetchValidImageDataUrl(item.fullUrl);
          if (fullRes.ok) {
            dataUrl = fullRes.dataUrl;
            successNote = "Full-HD Attachment";
          } else {
            stepErrors.push(`full(${fullRes.reason})`);
          }
        }

        // Tier 2: /media/ page resolution (with ?lightbox=1 fallback)
        if (!dataUrl && item.mediaUrl) {
          const mediaPage = await resolveMediaPageImageUrl(item.mediaUrl);
          if (mediaPage.ok && mediaPage.imageUrl) {
            const mediaImgRes = await fetchValidImageDataUrl(mediaPage.imageUrl);
            if (mediaImgRes.ok) {
              dataUrl = mediaImgRes.dataUrl;
              successNote = "Full-HD Media Gallery";
            } else {
              stepErrors.push(`mediaImg(${mediaImgRes.reason})`);
            }
          } else {
            stepErrors.push(`mediaPage(${mediaPage.reason})`);
          }
        }

        // Tier 3: Thumbnail URL with session cookies
        if (!dataUrl && item.thumbUrl && item.thumbUrl !== item.fullUrl) {
          const thumbRes = await fetchValidImageDataUrl(item.thumbUrl);
          if (thumbRes.ok) {
            dataUrl = thumbRes.dataUrl;
            successNote = "Thumbnail (Preview)";
          } else {
            stepErrors.push(`thumb(${thumbRes.reason})`);
          }
        }

        // Tier 4: Force-load offscreen image & Canvas render
        if (!dataUrl && item.imgEl) {
          const canvasRes = await captureViaCanvas(item.imgEl);
          if (canvasRes.ok) {
            dataUrl = canvasRes.dataUrl;
            successNote = "Canvas DOM Capture";
          } else {
            stepErrors.push(`canvas(${canvasRes.reason})`);
          }
        }

        if (dataUrl) {
          successCount++;

          // Extract Community Answer if mediaUrl is available
          let commAnsHtml = "";
          if (item.mediaUrl) {
            try {
              const commInfo = await scrapeCommunityAnswerForMedia(item.mediaUrl);
              if (commInfo && commInfo.topAnswer) {
                commAnsHtml = `
    <div class="community-answer" style="margin: 8px 0; padding: 6px 12px; background-color: #fef9c3; border-left: 4px solid #ca8a04; color: #854d0e; font-family: monospace; font-size: 13px;">
      <strong>[ COMMUNITY CONSENSUS ANSWER ]: ${escapeHtml(commInfo.topAnswer)}</strong> (${commInfo.topCount}/${commInfo.totalVotes} votes, ${commInfo.ratio}% agreement)
    </div>`;
              }
            } catch {
              // ignore comment fetch failure
            }
          }

          const safeFilename = escapeHtml(item.rawFilename ? ` (${item.rawFilename})` : "");
          questionBlocks.push(`
  <div class="question" style="margin-bottom: 28px; padding: 18px; border: 2px solid #0f172a; background-color: #ffffff;">
    <p style="font-size: 16px; margin-top: 0;"><strong>Question ${qNum}${safeFilename}:</strong> Solve the question shown in the diagram/screenshot below.</p>
    ${commAnsHtml}
    <img src="${dataUrl}" alt="Question ${qNum}" style="max-width: 100%; height: auto; display: block; margin: 14px 0; border: 1px solid #cbd5e1;" />
    <span style="font-size: 11px; color: #64748b; font-family: monospace;">Source: ${escapeHtml(successNote)}</span>
  </div>`);
        } else {
          diagnosticErrors.push(`Q${qNum} [${item.rawFilename}]: ${stepErrors.join(" | ")}`);
        }

        if (i < candidates.length - 1) {
          await new Promise((r) => setTimeout(r, 80));
        }
      }

      if (successCount === 0) {
        alert(
          `Could not capture any valid images (0/${candidates.length}).\n\n` +
            `Diagnostics:\n${diagnosticErrors.slice(0, 4).join("\n")}\n\n` +
            `Tip: Make sure you are logged in to FuOverflow and that your Tampermonkey script has '@connect *' granted.`
        );
        button.textContent = "⚡ EXPORT TO QNA GENERATOR";
        button.disabled = false;
        return;
      }

      // 4. Build Standalone HTML File
      const finalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
</head>
<body style="font-family: sans-serif; max-width: 840px; margin: 24px auto; padding: 0 16px; background-color: #f8fafc; color: #0f172a;">
  <div style="background-color: #0f172a; color: #ffffff; padding: 18px 24px; margin-bottom: 24px; border: 2px solid #0f172a;">
    <h1 style="margin: 0; font-size: 20px; font-family: monospace; text-transform: uppercase;">${escapeHtml(title)}</h1>
    <p style="margin: 6px 0 0; color: #94a3b8; font-size: 13px;">Subject: ${escapeHtml(subjectCode)} | Captured: ${successCount}/${candidates.length} Questions | Source: ${escapeHtml(window.location.href)}</p>
  </div>
${questionBlocks.join("\n")}
</body>
</html>`;

      const blob = new Blob([finalHtml], { type: "text/html;charset=utf-8" });
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dlUrl;
      const cleanName = title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
      a.download = `${cleanName}_ready_for_qna.html`;
      a.click();
      URL.revokeObjectURL(dlUrl);

      button.textContent = `✓ EXPORTED ${successCount}/${candidates.length} IMAGES!`;
      button.style.backgroundColor = "#059669";
      setTimeout(() => {
        button.textContent = "⚡ EXPORT TO QNA GENERATOR";
        button.style.backgroundColor = "#0f172a";
        button.disabled = false;
      }, 5000);
    } catch (err) {
      console.error("Export error:", err);
      alert(`Export failed: ${err.message}`);
      button.textContent = "⚡ EXPORT TO QNA GENERATOR";
      button.disabled = false;
    }
  });

  document.body.appendChild(button);
})();
