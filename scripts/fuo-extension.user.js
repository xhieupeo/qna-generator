// ==UserScript==
// @name         FU Overflow & FuExam to QnA Generator (1-Click Exporter)
// @namespace    https://github.com/xhieupeo/qna-generator
// @version      2.3.0
// @description  Extract all exam question Full-HD images & community answers from FU Overflow / FuExam threads with CSP-safe In-Browser OCR, async lightbox blob capture, and AI JSON export.
// @author       QnA Generator Team
// @match        https://fuoverflow.com/threads/*
// @match        http://fuoverflow.com/threads/*
// @match        https://fuexam.me/threads/*
// @match        http://fuexam.me/threads/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @require      https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js
// @connect      *
// ==/UserScript==

(function () {
  "use strict";

  const DECORATIVE_REGEX = /(avatar|smilie|smiley|emoji|reaction|badge|logo|icon|favicon|sidebar|study-icon|presets)/i;

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

  function gmFetchAnonymous(url, responseType = "text", timeout = 30000) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          responseType,
          anonymous: true,
          timeout,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300) {
              resolve(responseType === "text" ? res.responseText : res.response);
            } else {
              reject(new Error(`HTTP ${res.status} fetching ${url}`));
            }
          },
          onerror: () => reject(new Error(`Network error fetching ${url}`)),
          ontimeout: () => reject(new Error(`Timeout fetching ${url}`)),
        });
        return;
      }
      fetch(url, { credentials: "omit" })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
          return responseType === "text" ? res.text() : res.arrayBuffer();
        })
        .then(resolve)
        .catch(reject);
    });
  }

  function getImageDimensions(dataUrl) {
    return new Promise((resolve) => {
      if (!dataUrl || !dataUrl.startsWith("data:image/")) {
        resolve({ width: 0, height: 0 });
        return;
      }
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || img.width || 0, height: img.naturalHeight || img.height || 0 });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = dataUrl;
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

      // Extract question text from Schema.org metadata if present
      let questionStem = "";
      const ldScripts = doc.querySelectorAll('script[type="application/ld+json"]');
      for (const s of ldScripts) {
        try {
          const ld = JSON.parse(s.textContent);
          if (ld.mainEntity?.text || ld.mainEntity?.name) {
            questionStem = ld.mainEntity.text || ld.mainEntity.name;
            break;
          }
        } catch {
          // ignore parse error
        }
      }

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
      const totalVotes = Object.values(votes).reduce((s, v) => s + v, 0);
      const topAnswer = sorted.length > 0 ? sorted[0][0] : null;
      const topCount = sorted.length > 0 ? sorted[0][1] : 0;
      const ratio = totalVotes > 0 ? Math.round((topCount / totalVotes) * 100) : 0;

      return {
        topAnswer,
        topCount,
        totalVotes,
        ratio,
        distribution: votes,
        questionStem: questionStem || "",
      };
    } catch {
      return null;
    }
  }

  /**
   * Synthesize 4 plausible options if OCR returns fewer than 2.
   */
  function synthesizeOptions(questionText, explanation, qNum) {
    const cleanExpl = String(explanation || "").trim();
    const sentences = cleanExpl.split(/(?<=[.?!])\s+/).filter((s) => s.length > 10);
    const correctStem = sentences[0] || `Correct response for Question ${qNum}`;
    const truncatedCorrect = correctStem.length > 120 ? correctStem.slice(0, 117) + "..." : correctStem;

    return [
      `A. ${truncatedCorrect}`,
      "B. Standard alternative condition that does not apply here",
      "C. Inverted logic contradictory to the verified rule",
      "D. Unrelated distractor parameter",
    ];
  }

  const TESS_CDN = {
    worker: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
    coreSimd: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core-simd-lstm.wasm.js",
    coreFallback: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core-lstm.wasm.js",
    langs: {
      jpn: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz",
      eng: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
      vie: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/vie/4.0.0_best_int/vie.traineddata.gz",
    },
  };

  function supportsWasmSimd() {
    try {
      return (
        typeof WebAssembly === "object" &&
        WebAssembly.validate(
          new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])
        )
      );
    } catch {
      return false;
    }
  }

  function sanitizeAndValidateOcrText(rawText, subjectCode = "EXAM") {
    if (!rawText) return "";
    let cleaned = String(rawText)
      .replace(/\[Note:\s*the\s*'helloworld'\s*demo\s*key[^\]]*\]/gi, " ")
      .replace(/There are \d+ questions[^.\r\n]*\.?/gi, " ")
      .replace(/^\s*(?:Answer|Back\s*Next|Back|Next|FUO(?:\s*Overflow)?|fuoverflow\.com)\s*$/gim, " ")
      .replace(/^\s*\d{1,2}:\d{2}\s*$/gm, " ")
      .replace(/\r\n/g, "\n")
      .trim();

    if (!cleaned) return "";

    const meaningful = cleaned.replace(/[^\p{L}\p{N}]/gu, "");
    if (meaningful.length < 6) return "";

    if (/JPD|JPN|JAP/i.test(subjectCode)) {
      const hasThaiOrCyrillic = /[\u0E00-\u0E7F\u0400-\u04FF]/.test(cleaned);
      const hasJapanese = /[\u3040-\u30ff\u4e00-\u9faf]/.test(cleaned);
      if (hasThaiOrCyrillic && !hasJapanese) return "";
    }

    return cleaned;
  }

  function normalizeOptionMarkers(text) {
    let normalized = String(text || "")
      .replace(/[Ａ]/g, "A")
      .replace(/[Ｂ]/g, "B")
      .replace(/[Ｃ]/g, "C")
      .replace(/[Ｄ]/g, "D")
      .replace(/．/g, ".")
      .replace(/[（(]\s*([A-D])\s*[）)]/gi, (_, l) => `${l.toUpperCase()}. `);

    // Split inline options like "A. foo B. bar" or Japanese "A.なん B.だれ" onto separate lines (exclude ":" so A:/B: dialogues stay intact)
    normalized = normalized.replace(/([^\n])\s+([A-D])([.)])\s*(?=\S)/g, "$1\n$2$3 ");
    return normalized;
  }

  /**
   * Parses raw OCR text into a structured Question object with 4 clean options.
   */
  function parseOcrTextToQuestion(rawText, qNum, defaultStem = "", communityAns = null, meta = {}) {
    const cleanDefaultStem = String(defaultStem || "").trim();
    const resolution = meta.width && meta.height ? `${meta.width}x${meta.height}` : undefined;
    const isLowResLocked = Boolean(meta.isLowResLocked);

    const validatedText = sanitizeAndValidateOcrText(rawText, meta.subjectCode || "EXAM");
    if (!validatedText) {
      const status = isLowResLocked
        ? "locked_thumbnail_low_res"
        : meta.rateLimited
          ? "rate_limited"
          : "no_text_detected";
      return {
        questionNumber: qNum,
        question: cleanDefaultStem || `Question ${qNum}`,
        options: ["A. Option A", "B. Option B", "C. Option C", "D. Option D"],
        correctAnswer: 0,
        explanation: isLowResLocked
          ? "Locked 304x160 member preview thumbnail (Schema.org stem preserved)"
          : "No text detected by OCR",
        communityAnswer: communityAns || null,
        resolution,
        ocrStatus: status,
      };
    }

    const normalized = normalizeOptionMarkers(validatedText);
    const lines = normalized.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
    // Prefer strict dot/paren option prefixes (A. / A)) so Japanese dialogue lines ("A: ... B: ...") stay in question text
    const strictOptionRegex = /^([A-D])[.)]\s*(.+)$/i;
    const looseOptionRegex = /^([A-D])[.:)\s-]\s*(.+)$/i;
    const hasStrictOptions = lines.some((l) => strictOptionRegex.test(l));
    const optionRegex = hasStrictOptions ? strictOptionRegex : looseOptionRegex;

    const options = [];
    const questionLines = [];
    let foundFirstOption = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(optionRegex);
      const isQuestionPrefix = /^(?:câu|question|q)?\s*\d+\s*[:.)-]\s*(.*)$/i.exec(line);
      const looksLikeDialogueTurn = !hasStrictOptions && /^[A-B]:/i.test(line) && /\b[A-B]:/i.test(line.slice(2));

      if (match && !looksLikeDialogueTurn && (!isQuestionPrefix || foundFirstOption || /^[A-D]\s*[.)]/i.test(line))) {
        foundFirstOption = true;
        const letter = match[1].toUpperCase();
        options.push(`${letter}. ${match[2].trim()}`);
      } else if (!foundFirstOption) {
        if (isQuestionPrefix && isQuestionPrefix[1]) {
          questionLines.push(isQuestionPrefix[1].trim());
        } else {
          questionLines.push(line);
        }
      } else if (options.length > 0) {
        options[options.length - 1] += ` ${line}`;
      }
    }

    let questionText = questionLines.join(" ").trim();
    const stemWithoutEllipsis = cleanDefaultStem.replace(/…+$/, "").trim();
    if (!questionText) {
      questionText = cleanDefaultStem || `Question ${qNum}`;
    } else if (cleanDefaultStem && questionText.length < 18 && stemWithoutEllipsis.length > questionText.length) {
      questionText = cleanDefaultStem;
    }

    const cleanOptions = [];
    const letters = ["A", "B", "C", "D"];
    for (let i = 0; i < 4; i++) {
      if (i < options.length) {
        cleanOptions.push(options[i]);
      } else {
        cleanOptions.push(`${letters[i]}. Option ${letters[i]}`);
      }
    }

    let correctIndex = 0;
    if (communityAns) {
      const char = String(communityAns).trim().toUpperCase().charAt(0);
      const idx = letters.indexOf(char);
      if (idx !== -1) correctIndex = idx;
    }

    const hasRealOptions = options.length >= 2;
    const ocrStatus = hasRealOptions
      ? "ok"
      : isLowResLocked
        ? "locked_thumbnail_low_res"
        : "partial_stem_only";

    return {
      questionNumber: qNum,
      question: questionText,
      options: cleanOptions,
      correctAnswer: correctIndex,
      explanation: communityAns
        ? `Community Consensus Answer: ${communityAns}`
        : hasRealOptions
          ? `Extracted via ${meta.engineName || "Free OCR"}`
          : isLowResLocked
            ? "Partial OCR on locked 304x160 preview thumbnail; Schema.org stem preserved"
            : `Partial OCR via ${meta.engineName || "Free OCR"} (options missing)`,
      communityAnswer: communityAns || null,
      resolution,
      ocrStatus,
    };
  }

  /**
   * Preprocess image for OCR: trims trailing dead whitespace & corner FUO watermarks,
   * upscales low-res thumbnails cleanly, stretches contrast, and outputs lossless PNG.
   */
  async function preprocessImageForFreeOcr(dataUrl, { binarizeForTesseract = false } = {}) {
    if (!dataUrl || !dataUrl.startsWith("data:image/")) return dataUrl;
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => {
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          if (!w || !h) {
            resolve(dataUrl);
            return;
          }

          // Draw raw source to analyze whitespace & corner watermarks
          const srcCanvas = document.createElement("canvas");
          srcCanvas.width = w;
          srcCanvas.height = h;
          const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
          if (!srcCtx) {
            resolve(dataUrl);
            return;
          }
          srcCtx.fillStyle = "#ffffff";
          srcCtx.fillRect(0, 0, w, h);
          srcCtx.drawImage(img, 0, 0, w, h);

          let cropH = h;
          try {
            const imgData = srcCtx.getImageData(0, 0, w, h);
            const px = imgData.data;

            // 1. Detect trailing empty white canyon while skipping bottom 15% watermark zone
            if (h >= 120 && w >= 200) {
              let lastContentY = 0;
              const scanLimit = Math.floor(h * 0.85);
              for (let y = 0; y < scanLimit; y++) {
                let darkCount = 0;
                for (let x = Math.floor(w * 0.05); x < Math.floor(w * 0.95); x += 2) {
                  const idx = (y * w + x) * 4;
                  if (px[idx] < 220 || px[idx + 1] < 220 || px[idx + 2] < 220) {
                    darkCount++;
                    if (darkCount > 3) break;
                  }
                }
                if (darkCount > 3) lastContentY = y;
              }
              if (lastContentY > Math.round(h * 0.18) && lastContentY < Math.round(h * 0.65)) {
                cropH = Math.min(h, lastContentY + Math.max(12, Math.round(h * 0.08)));
              }
            }

            // 2. If full height kept, mask dark corner FUO/timer badges only if center is white
            if (cropH === h && w >= 200 && h >= 120) {
              const sampleAvgLum = (x0, y0, x1, y1) => {
                let sum = 0;
                let cnt = 0;
                for (let y = y0; y < y1; y += 2) {
                  for (let x = x0; x < x1; x += 2) {
                    const idx = (y * w + x) * 4;
                    sum += 0.299 * px[idx] + 0.587 * px[idx + 1] + 0.114 * px[idx + 2];
                    cnt++;
                  }
                }
                return cnt > 0 ? sum / cnt : 255;
              };
              const centerLum = sampleAvgLum(
                Math.floor(w * 0.25),
                Math.floor(h * 0.25),
                Math.floor(w * 0.75),
                Math.floor(h * 0.65)
              );
              if (centerLum > 225) {
                const blLum = sampleAvgLum(0, Math.floor(h * 0.86), Math.floor(w * 0.12), h);
                if (blLum < 165) {
                  srcCtx.fillStyle = "#ffffff";
                  srcCtx.fillRect(0, Math.floor(h * 0.85), Math.ceil(w * 0.14), Math.ceil(h * 0.15));
                }
                const brLum = sampleAvgLum(Math.floor(w * 0.9), Math.floor(h * 0.88), w, h);
                if (brLum < 165) {
                  srcCtx.fillStyle = "#ffffff";
                  srcCtx.fillRect(Math.floor(w * 0.88), Math.floor(h * 0.87), Math.ceil(w * 0.12), Math.ceil(h * 0.13));
                }
              }
            }
          } catch {
            // ignore pixel scan issues
          }

          const scale = w < 1400 ? Math.max(1.0, Math.min(4.5, 1400 / w)) : 1.0;
          const outW = Math.round(w * scale);
          const outH = Math.round(cropH * scale);

          const outCanvas = document.createElement("canvas");
          outCanvas.width = outW;
          outCanvas.height = outH;
          const outCtx = outCanvas.getContext("2d", { willReadFrequently: true });
          if (!outCtx) {
            resolve(dataUrl);
            return;
          }
          outCtx.fillStyle = "#ffffff";
          outCtx.fillRect(0, 0, outW, outH);
          outCtx.imageSmoothingEnabled = true;
          outCtx.imageSmoothingQuality = "high";
          outCtx.drawImage(srcCanvas, 0, 0, w, cropH, 0, 0, outW, outH);

          if (binarizeForTesseract) {
            try {
              const outImg = outCtx.getImageData(0, 0, outW, outH);
              const d = outImg.data;
              for (let i = 0; i < d.length; i += 4) {
                const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                // Soft contrast stretch: crisp black strokes, clean white background
                const stretched = lum >= 215 ? 255 : lum <= 115 ? 0 : Math.round(((lum - 115) / 100) * 255);
                d[i] = stretched;
                d[i + 1] = stretched;
                d[i + 2] = stretched;
              }
              outCtx.putImageData(outImg, 0, 0);
            } catch {
              // keep grayscale/upscaled result
            }
          }

          resolve(outCanvas.toDataURL("image/png"));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      } catch {
        resolve(dataUrl);
      }
    });
  }

  /**
   * Builds a CSP-safe persistent Tesseract.js v5 worker by fetching core/worker/traineddata
   * via GM_xmlhttpRequest and bundling core + worker into a single same-origin Blob Worker.
   */
  async function createPersistentTesseractWorker(subjectCode = "EXAM") {
    if (typeof Tesseract === "undefined" || !Tesseract.createWorker) {
      throw new Error("Tesseract.js library not loaded");
    }

    let langCodes = ["eng"];
    if (/JPD|JPN|JAP/i.test(subjectCode)) langCodes = ["jpn", "eng"];
    else if (/VIE|VNM/i.test(subjectCode)) langCodes = ["vie", "eng"];
    const langString = langCodes.join("+");

    const coreUrl = supportsWasmSimd() ? TESS_CDN.coreSimd : TESS_CDN.coreFallback;
    const blobUrlsToRevoke = [];

    const [coreJs, workerJs, ...langBuffers] = await Promise.all([
      gmFetchAnonymous(coreUrl, "text", 45000),
      gmFetchAnonymous(TESS_CDN.worker, "text", 30000),
      ...langCodes.map((code) => gmFetchAnonymous(TESS_CDN.langs[code], "arraybuffer", 60000)),
    ]);

    const langBlobMap = {};
    langCodes.forEach((code, i) => {
      const blob = new Blob([langBuffers[i]], { type: "application/gzip" });
      const bUrl = URL.createObjectURL(blob);
      blobUrlsToRevoke.push(bUrl);
      langBlobMap[`${code}.traineddata.gz`] = bUrl;
    });

    const workerHeader = `
      (function() {
        var __origFetch = self.fetch.bind(self);
        var __langBlobMap = ${JSON.stringify(langBlobMap)};
        self.fetch = function(input, init) {
          var u = typeof input === "string" ? input : (input && input.url) || "";
          for (var suffix in __langBlobMap) {
            if (Object.prototype.hasOwnProperty.call(__langBlobMap, suffix) && u.indexOf(suffix) !== -1) {
              return __origFetch(__langBlobMap[suffix]);
            }
          }
          return __origFetch(input, init);
        };
      })();
    `;

    const combinedWorkerBlob = new Blob(
      [
        workerHeader,
        "\n;\n",
        coreJs,
        '\n;if (typeof TesseractCore !== "undefined") { self.TesseractCore = TesseractCore; }\n',
        workerJs,
      ],
      { type: "application/javascript" }
    );
    const workerBlobUrl = URL.createObjectURL(combinedWorkerBlob);
    blobUrlsToRevoke.push(workerBlobUrl);

    let worker = null;
    try {
      const initPromise = Tesseract.createWorker(langString, 1, {
        workerBlobURL: false,
        workerPath: workerBlobUrl,
        errorHandler: (err) => console.warn("[FUO Tesseract Worker Notice]", err),
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Tesseract worker initialization timeout (45s)")), 45000)
      );
      worker = await Promise.race([initPromise, timeoutPromise]);
    } catch (err) {
      blobUrlsToRevoke.forEach((u) => {
        try {
          URL.revokeObjectURL(u);
        } catch {}
      });
      throw err;
    }

    return {
      worker,
      cleanup: async () => {
        try {
          if (worker) await worker.terminate();
        } catch {}
        blobUrlsToRevoke.forEach((u) => {
          try {
            URL.revokeObjectURL(u);
          } catch {}
        });
      },
    };
  }

  /**
   * Free OCR.space fallback (supports optional user free key via GM_getValue,
   * fixes MIME spoofing, strips demo banners, and enforces a 429 circuit breaker).
   */
  async function ocrSpaceFree(dataUrl, subjectCode = "EXAM", ocrState = {}) {
    if (ocrState.rateLimited) {
      return { ok: false, rateLimited: true, text: "" };
    }

    const customKey = typeof GM_getValue === "function" ? GM_getValue("OCR_SPACE_API_KEY", "").trim() : "";
    const apiKey = customKey || "helloworld";
    const isJapanese = /JPD|JPN|JAP/i.test(subjectCode);

    const mimeMatch = String(dataUrl || "").match(/^data:(image\/[a-z0-9+.-]+);base64,/i);
    const actualMime = mimeMatch ? mimeMatch[1].toLowerCase() : "image/png";
    const filetype = actualMime.includes("png")
      ? "PNG"
      : actualMime.includes("webp")
        ? "WEBP"
        : "JPG";

    return new Promise((resolve) => {
      const formData = new FormData();
      formData.append("base64Image", dataUrl);
      formData.append("language", isJapanese ? "auto" : "eng");
      formData.append("OCREngine", "2");
      formData.append("scale", "true");
      formData.append("isOverlayRequired", "false");
      formData.append("filetype", filetype);

      GM_xmlhttpRequest({
        method: "POST",
        url: "https://api.ocr.space/parse/image",
        headers: { apikey: apiKey },
        data: formData,
        timeout: 30000,
        onload: (res) => {
          if (res.status === 429) {
            ocrState.rateLimited = true;
            resolve({ ok: false, rateLimited: true, text: "" });
            return;
          }
          try {
            const json = JSON.parse(res.responseText);
            const rawErr = String(json?.error || json?.ErrorMessage || "");
            if (/E581|rate limit/i.test(rawErr)) {
              ocrState.rateLimited = true;
              resolve({ ok: false, rateLimited: true, text: "" });
              return;
            }
            if (json?.IsErroredOnProcessing || (typeof json?.OCRExitCode === "number" && json.OCRExitCode > 2)) {
              resolve({ ok: false, rateLimited: false, text: "" });
              return;
            }
            const parsedText = String(json?.ParsedResults?.[0]?.ParsedText || "")
              .replace(/\[Note:\s*the\s*'helloworld'\s*demo\s*key[^\]]*\]/gi, " ")
              .trim();
            resolve({ ok: Boolean(parsedText), rateLimited: false, text: parsedText });
          } catch {
            resolve({ ok: false, rateLimited: false, text: "" });
          }
        },
        onerror: () => resolve({ ok: false, rateLimited: false, text: "" }),
        ontimeout: () => resolve({ ok: false, rateLimited: false, text: "" }),
      });
    });
  }

  /**
   * Batch Free OCR orchestrator:
   * 1) Preprocesses each image (whitespace/watermark clean + upscale + PNG),
   * 2) Runs 1 persistent CSP-safe Tesseract.js worker across all questions,
   * 3) Falls back to OCR.space (with 429 circuit breaker) only if Tesseract yielded empty/noise.
   */
  async function runFreeOcrBatch(capturedQuestions, subjectCode = "EXAM", activeBtn = null) {
    let workerHandle = null;
    const ocrState = { rateLimited: false };

    if (activeBtn) activeBtn.textContent = "⏳ LOADING OCR ENGINE...";
    try {
      workerHandle = await createPersistentTesseractWorker(subjectCode);
    } catch (err) {
      console.warn("CSP-safe Tesseract init failed; falling back to OCR.space:", err);
    }

    const solvedList = [];
    try {
      for (let idx = 0; idx < capturedQuestions.length; idx++) {
        const item = capturedQuestions[idx];
        if (activeBtn) {
          activeBtn.textContent = `🆓 OCR (${idx + 1}/${capturedQuestions.length})...`;
        }

        const preprocessedPng = await preprocessImageForFreeOcr(item.dataUrl, {
          binarizeForTesseract: true,
        });

        let rawText = "";
        let engineName = "Tesseract.js (In-Browser)";

        if (workerHandle && workerHandle.worker) {
          try {
            const ret = await workerHandle.worker.recognize(preprocessedPng);
            rawText = sanitizeAndValidateOcrText(ret?.data?.text || "", subjectCode);
          } catch (err) {
            console.warn(`Tesseract recognize error Q${item.questionNumber}:`, err);
          }
        }

        if (!rawText && !ocrState.rateLimited) {
          const ocrSpacePng = await preprocessImageForFreeOcr(item.dataUrl, {
            binarizeForTesseract: false,
          });
          const ocrRes = await ocrSpaceFree(ocrSpacePng, subjectCode, ocrState);
          if (ocrRes.ok && ocrRes.text) {
            rawText = sanitizeAndValidateOcrText(ocrRes.text, subjectCode);
            if (rawText) engineName = "OCR.space (Engine 2)";
          }
          await new Promise((r) => setTimeout(r, 1000));
        }

        const parsed = parseOcrTextToQuestion(
          rawText,
          item.questionNumber,
          item.questionStem || "",
          item.communityAnswer || null,
          {
            subjectCode,
            width: item.imageWidth || 0,
            height: item.imageHeight || 0,
            isLowResLocked: Boolean(item.isLowResLocked),
            rateLimited: ocrState.rateLimited && !rawText,
            engineName,
          }
        );

        solvedList.push({
          ...parsed,
          filename: item.filename,
        });

        if (idx < capturedQuestions.length - 1) {
          await new Promise((r) => setTimeout(r, 60));
        }
      }
    } finally {
      if (workerHandle) {
        await workerHandle.cleanup();
      }
    }

    return solvedList;
  }

  /**
   * Super-resolve and sharpen image base64 on Canvas before AI Vision OCR.
   */
  async function upscaleImageForOcr(dataUrl) {
    return preprocessImageForFreeOcr(dataUrl, { binarizeForTesseract: false });
  }

  /**
   * Canvas capture as final fallback for DOM loaded images with 2.5x upscaling.
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
      // Scale up if it is a thumbnail (< 600px)
      const scale = imgEl.naturalWidth < 600 ? Math.max(2.0, Math.min(3.5, 900 / imgEl.naturalWidth)) : 1.0;
      canvas.width = Math.round(imgEl.naturalWidth * scale);
      canvas.height = Math.round(imgEl.naturalHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return { ok: false, reason: "no 2D canvas context", dataUrl: null };
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.94);
      if (dataUrl.startsWith("data:image/")) {
        return { ok: true, reason: `Canvas captured (${canvas.width}x${canvas.height})`, dataUrl };
      }
      return { ok: false, reason: "empty canvas output", dataUrl: null };
    } catch (err) {
      return { ok: false, reason: `Canvas tainted (${err?.name || "security error"})`, dataUrl: null };
    }
  }

  /**
   * Transcribe question image using Google Gemini (with multi-model fallback cascade) or OpenRouter.
   */
  async function transcribeQuestionWithGemini(
    apiKey,
    base64Data,
    mimeType,
    qNum,
    questionStem = "",
    communityAns = null,
    subjectCode = "EXAM"
  ) {
    // 1. Upscale low-res thumbnails before sending to AI
    const enhancedDataUrl = await upscaleImageForOcr(base64Data);
    const cleanBase64 = String(enhancedDataUrl || "").replace(/^data:[^;]+;base64,/, "");
    const cleanMime = enhancedDataUrl.startsWith("data:image/jpeg") ? "image/jpeg" : (mimeType || "image/webp");

    const stemContext = questionStem
      ? `\nExact question stem from metadata: "${questionStem}"`
      : "";
    const commContext = communityAns
      ? `\nCommunity consensus answer: "${communityAns}"`
      : "";

    const prompt = `You are an expert exam analyzer and OCR extractor.
Exam Subject: ${subjectCode}
Read this exam question screenshot carefully.${stemContext}${commContext}

CRITICAL OCR INSTRUCTIONS:
1. Extract the full question text.
2. Extract all 4 multiple-choice options (A, B, C, D).
   - If this is a Japanese exam (such as JPD113), transcribe Japanese kanji, hiragana, and grammar readings accurately even if image is slightly compressed.
   - Each option MUST start with its letter (e.g. "A. ...", "B. ...", "C. ...", "D. ...").
3. Determine the correct answer index (0 for A, 1 for B, 2 for C, 3 for D).
4. Provide a clear, factual explanation of why this answer is correct.

Return STRICT JSON format with this exact structure:
{
  "questionNumber": ${qNum},
  "question": "The complete transcribed question text",
  "options": [
    "A. Option 1 text",
    "B. Option 2 text",
    "C. Option 3 text",
    "D. Option 4 text"
  ],
  "correctAnswer": 0,
  "explanation": "Clear explanation of the answer"
}`;

    // Branch A: OpenRouter if key starts with sk-or-
    const isOpenRouter = apiKey.startsWith("sk-or-");
    if (isOpenRouter) {
      return new Promise((resolve) => {
        GM_xmlhttpRequest({
          method: "POST",
          url: "https://openrouter.ai/api/v1/chat/completions",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "HTTP-Referer": window.location.href,
            "X-Title": "FUO Exam Extractor",
          },
          data: JSON.stringify({
            model: "google/gemini-2.0-flash-001",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  {
                    type: "image_url",
                    image_url: { url: `data:${cleanMime};base64,${cleanBase64}` },
                  },
                ],
              },
            ],
            response_format: { type: "json_object" },
          }),
          timeout: 45000,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300) {
              try {
                const resJson = JSON.parse(res.responseText);
                const content = resJson.choices?.[0]?.message?.content;
                const parsed = JSON.parse(content);
                const options = (Array.isArray(parsed.options) && parsed.options.length >= 2)
                  ? parsed.options
                  : synthesizeOptions(parsed.question || questionStem, parsed.explanation, qNum);
                resolve({
                  questionNumber: parsed.questionNumber || qNum,
                  question: parsed.question || questionStem || `Question ${qNum}`,
                  options,
                  correctAnswer: typeof parsed.correctAnswer === "number" ? parsed.correctAnswer : 0,
                  explanation: parsed.explanation || "Transcribed via OpenRouter Gemini 2.0 Flash",
                });
                return;
              } catch (e) {
                // fall through
              }
            }
            resolve({
              questionNumber: qNum,
              question: questionStem || `Question ${qNum}`,
              options: synthesizeOptions(questionStem, "OpenRouter error", qNum),
              correctAnswer: 0,
              explanation: `OpenRouter HTTP ${res.status}: ${res.responseText.slice(0, 100)}`,
            });
          },
          onerror: () => {
            resolve({
              questionNumber: qNum,
              question: questionStem || `Question ${qNum}`,
              options: synthesizeOptions(questionStem, "Network error", qNum),
              correctAnswer: 0,
              explanation: "Network error calling OpenRouter",
            });
          },
        });
      });
    }

    // Branch B: Google Gemini Direct API with Multi-Model Fallback Cascade
    const GEMINI_MODELS = [
      "gemini-2.0-flash",
      "gemini-2.5-flash",
      "gemini-1.5-flash-latest",
      "gemini-1.5-flash",
    ];

    for (const model of GEMINI_MODELS) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const requestBody = {
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: cleanMime,
                  data: cleanBase64,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.1,
        },
      };

      const result = await new Promise((resolve) => {
        GM_xmlhttpRequest({
          method: "POST",
          url: endpoint,
          headers: {
            "Content-Type": "application/json",
          },
          data: JSON.stringify(requestBody),
          timeout: 40000,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300) {
              try {
                const resJson = JSON.parse(res.responseText);
                const text = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                  const parsed = JSON.parse(text);
                  const options = (Array.isArray(parsed.options) && parsed.options.length >= 2)
                    ? parsed.options
                    : synthesizeOptions(parsed.question || questionStem, parsed.explanation, qNum);
                  resolve({
                    ok: true,
                    data: {
                      questionNumber: parsed.questionNumber || qNum,
                      question: parsed.question || questionStem || `Question ${qNum}`,
                      options,
                      correctAnswer: typeof parsed.correctAnswer === "number" ? parsed.correctAnswer : 0,
                      explanation: parsed.explanation || "",
                    },
                  });
                  return;
                }
              } catch (e) {
                // fall through
              }
            }
            let errDetail = `HTTP ${res.status}`;
            try {
              const errObj = JSON.parse(res.responseText);
              if (errObj.error?.message) {
                errDetail += `: ${errObj.error.message.slice(0, 120)}`;
              }
            } catch {}
            resolve({ ok: false, status: res.status, errDetail });
          },
          onerror: () => resolve({ ok: false, status: 0, errDetail: "Network error calling Gemini API" }),
          ontimeout: () => resolve({ ok: false, status: 408, errDetail: "Gemini API request timed out" }),
        });
      });

      if (result.ok && result.data) {
        return result.data;
      }
      // If 404 (model not found), proceed to next model in GEMINI_MODELS
      if (result.status !== 404 && result.status !== 400) {
        // If 403 or 429, don't loop endlessly
        return {
          questionNumber: qNum,
          question: questionStem || `Question ${qNum}`,
          options: synthesizeOptions(questionStem, result.errDetail, qNum),
          correctAnswer: 0,
          explanation: `Gemini OCR Failed (${result.errDetail})`,
        };
      }
    }

    // All models exhausted
    return {
      questionNumber: qNum,
      question: questionStem || `Question ${qNum}`,
      options: synthesizeOptions(questionStem, "All models returned 404/400", qNum),
      correctAnswer: 0,
      explanation: "Gemini OCR Failed: models not accessible with current API key. Please check your key at https://aistudio.google.com/apikey",
    };
  }

  // Modern Brutalist floating container with HTML and JSON buttons
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "16px";
  container.style.right = "16px";
  container.style.zIndex = "999999";
  container.style.display = "flex";
  container.style.gap = "8px";

  function createBrutalistButton(text, shadowColor = "#2563eb") {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.style.backgroundColor = "#0f172a";
    btn.style.color = "#ffffff";
    btn.style.border = "2px solid #0f172a";
    btn.style.borderRadius = "0px";
    btn.style.padding = "10px 14px";
    btn.style.fontFamily = "monospace";
    btn.style.fontSize = "12px";
    btn.style.fontWeight = "bold";
    btn.style.cursor = "pointer";
    btn.style.boxShadow = `3px 3px 0px ${shadowColor}`;
    btn.style.textTransform = "uppercase";
    btn.addEventListener("mouseenter", () => {
      if (!btn.disabled) btn.style.backgroundColor = shadowColor;
    });
    btn.addEventListener("mouseleave", () => {
      if (!btn.disabled) btn.style.backgroundColor = "#0f172a";
    });
    return btn;
  }

  const btnHtml = createBrutalistButton("⚡ EXPORT HTML", "#2563eb");
  const btnFreeJson = createBrutalistButton("🆓 FREE OCR JSON", "#10b981");
  const btnAiJson = createBrutalistButton("📦 AI JSON", "#8b5cf6");
  const btnKey = createBrutalistButton("🔑 API KEYS", "#64748b");

  container.appendChild(btnHtml);
  container.appendChild(btnFreeJson);
  container.appendChild(btnAiJson);
  container.appendChild(btnKey);

  btnHtml.addEventListener("click", () => startExport("html"));
  btnFreeJson.addEventListener("click", () => startExport("free_json"));
  btnAiJson.addEventListener("click", () => startExport("ai_json"));

  btnKey.addEventListener("click", () => {
    const currentAi = typeof GM_getValue === "function" ? GM_getValue("GEMINI_API_KEY", "") : "";
    const updatedAi = prompt(
      "Enter Google Gemini or OpenRouter API Key (for [AI JSON], optional):\n(Free key at: https://aistudio.google.com/apikey)",
      currentAi
    );
    if (updatedAi !== null && typeof GM_setValue === "function") {
      GM_setValue("GEMINI_API_KEY", updatedAi.trim());
    }

    const currentOcrSpace = typeof GM_getValue === "function" ? GM_getValue("OCR_SPACE_API_KEY", "") : "";
    const updatedOcrSpace = prompt(
      "Optional: Enter personal FREE OCR.space API Key (25,000 req/month, avoids shared demo key limits):\n(Get free key at: https://ocr.space/ocrapi/freekey — leave empty to use local Tesseract.js)",
      currentOcrSpace
    );
    if (updatedOcrSpace !== null && typeof GM_setValue === "function") {
      GM_setValue("OCR_SPACE_API_KEY", updatedOcrSpace.trim());
    }

    if (updatedAi !== null || updatedOcrSpace !== null) {
      alert("API key settings updated!");
    }
  });

  async function startExport(format = "html") {
    let activeBtn = btnHtml;
    if (format === "free_json") activeBtn = btnFreeJson;
    else if (format === "ai_json" || format === "json") activeBtn = btnAiJson;

    btnHtml.disabled = true;
    btnFreeJson.disabled = true;
    btnAiJson.disabled = true;
    btnKey.disabled = true;
    activeBtn.textContent = "⏳ SCANNING THREAD...";

    try {
      // 1. Extract Clean Title & Subject Code (Next.js & XenForo support)
      const h1 = document.querySelector("h1.p-title-value") || document.querySelector("h1");
      let title = document.title;
      let subjectCode = "EXAM";

      if (h1) {
        const clone = h1.cloneNode(true);
        clone.querySelectorAll(".label, .label-append").forEach((el) => el.remove());
        title = clone.textContent.replace(/\s+/g, " ").trim() || document.title;
      }
      title = title.replace(/\s*\|\s*FuOverflow.*$/i, "").trim() || title;

      // Detect Subject Code from breadcrumbs or title (e.g. DBI202, PRO192, MAD101, JPD113)
      const breadcrumbLinks = document.querySelectorAll(
        "ul.p-breadcrumbs li a, nav ol li a, nav a, [aria-label*='breadcrumb' i] a"
      );
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

      // 2. Collect Candidate Items (Next.js Grid + XenForo fallbacks)
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

      function addCandidate(fullUrl, mediaUrl, thumbUrl, imgEl, rawFilename, anchorEl = null, isLockedCard = false) {
        const key = mediaUrl || fullUrl || thumbUrl;
        if (!key || seenKeys.has(key)) return;
        if (DECORATIVE_REGEX.test(key)) return;
        seenKeys.add(key);
        candidates.push({ fullUrl, mediaUrl, thumbUrl, imgEl, rawFilename, anchorEl, isLockedCard });
      }

      // Expand hidden gallery items (>= 24) if FuOverflow "Xem thêm" button is collapsed
      const expandBtn = document.querySelector(
        "ul[aria-label*='Ảnh đính kèm' i] ~ button[aria-expanded='false'], button[aria-expanded='false'][aria-label*='ảnh' i]"
      );
      if (expandBtn) {
        try {
          expandBtn.click();
          await new Promise((r) => setTimeout(r, 120));
        } catch {}
      }

      // Priority 1: Next.js Attachment Grid (FU Overflow modern layout)
      const gridLis = document.querySelectorAll("ul[aria-label*='Ảnh đính kèm' i] li");
      const priority1Nodes = gridLis.length > 0 ? gridLis : document.querySelectorAll("a[href*='/media/']");
      priority1Nodes.forEach((container, idx) => {
        const a = container.tagName === "A" ? container : container.querySelector("a[href*='/media/']");
        const img = container.querySelector("img");
        if (!img) return;

        const thumbUrl = resolveUrl(
          img.getAttribute("data-src") || img.getAttribute("data-url") || img.getAttribute("src") || img.src || ""
        );
        const mediaUrl = a ? resolveUrl(a.getAttribute("href") || a.href || "") : "";
        const ariaLabel = (a && a.getAttribute("aria-label")) || "";
        const alt = img.getAttribute("alt") || "";
        const isLockedCard =
          /dành cho thành viên/i.test(ariaLabel) ||
          Boolean(a && a.querySelector("svg.lucide-lock"));

        let rawFilename = "";
        const mFile = ariaLabel.match(/:\s*([^\s—–-]+(?:\.webp|\.png|\.jpe?g))/i);
        if (mFile) {
          rawFilename = mFile[1];
        } else {
          const mQ = ariaLabel.match(/(q\d+(?:\.webp|\.png|\.jpe?g)?)/i) || alt.match(/(ảnh\s*\d+\/\d+)/i);
          if (mQ) rawFilename = mQ[1];
          else rawFilename = `Q${idx + 1}.webp`;
        }

        addCandidate("", mediaUrl, thumbUrl, img, rawFilename, a, isLockedCard);
      });

      // Priority 2: XenForo Attachment Cards (<li class="file">)
      if (candidates.length === 0) {
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

          addCandidate(fullUrl, mediaUrl, thumbUrl, img, rawFilename, a);
        });
      }

      // Priority 3: Inline lightbox images (.bbWrapper a.js-lbImage)
      if (candidates.length === 0) {
        document.querySelectorAll(".bbWrapper a.js-lbImage, .bbWrapper a[href*='attachments/']").forEach((a, idx) => {
          const img = a.querySelector("img");
          const fullUrl = resolveUrl(a.getAttribute("href") || a.href || "");
          const mediaUrl = extractMediaHref(a);
          const thumbUrl = img
            ? resolveUrl(img.getAttribute("data-src") || img.getAttribute("data-url") || img.getAttribute("src") || img.src || "")
            : "";
          const rawFilename = (img && (img.getAttribute("alt") || img.getAttribute("title"))) || `Q${idx + 1}.jpg`;

          addCandidate(fullUrl, mediaUrl, thumbUrl, img, rawFilename, a);
        });
      }

      // Priority 4: Direct exam images inside article cards
      if (candidates.length === 0) {
        document.querySelectorAll("article.fuo-card img, article img").forEach((img, idx) => {
          const src = resolveUrl(
            img.getAttribute("data-src") || img.getAttribute("data-url") || img.getAttribute("src") || img.src || ""
          );
          if (src && (src.includes("cdn.fuoverflow.com/exam") || src.includes("/attachments/"))) {
            addCandidate("", "", src, img, img.getAttribute("alt") || `Q${idx + 1}.webp`);
          }
        });
      }

      // Priority 5: Fallback DOM images in post bodies
      if (candidates.length === 0) {
        document.querySelectorAll(".bbWrapper img, .message-body img, main img").forEach((img, idx) => {
          const src = resolveUrl(
            img.getAttribute("data-src") || img.getAttribute("data-url") || img.getAttribute("src") || img.src || ""
          );
          if (src && !DECORATIVE_REGEX.test(src)) {
            addCandidate("", "", src, img, img.getAttribute("alt") || `Q${idx + 1}.jpg`);
          }
        });
      }

      if (candidates.length === 0) {
        alert("No question images found on this thread.");
        btnHtml.textContent = "⚡ EXPORT HTML";
        btnFreeJson.textContent = "🆓 FREE OCR JSON";
        btnAiJson.textContent = "📦 AI JSON";
        btnHtml.disabled = false;
        btnFreeJson.disabled = false;
        btnAiJson.disabled = false;
        btnKey.disabled = false;
        return;
      }

      async function captureViaLightboxModal(item) {
        const trigger = item.anchorEl || item.imgEl;
        if (!trigger) return { ok: false, locked: false, dataUrl: null };

        let locked = false;
        let resultDataUrl = null;
        let note = "";

        try {
          if (typeof trigger.scrollIntoView === "function" && !trigger.closest("li[hidden]")) {
            trigger.scrollIntoView({ behavior: "instant", block: "center" });
          }
          trigger.click();

          const deadline = Date.now() + 4500;
          const openStart = Date.now();
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
            const dialog = document.querySelector(
              "[role='dialog'], .xfmgMedia-view, .media-viewer, .pswp--open, .fancybox__container, .modal"
            );
            if (!dialog) continue;

            const lockNote = dialog.querySelector("[role='note'][aria-label*='thành viên' i], [role='alert']");
            if (lockNote) {
              locked = true;
              break;
            }

            const dlAnchor = dialog.querySelector("a[aria-label='Tải ảnh gốc'][href^='blob:']");
            const lbImg =
              dialog.querySelector("img[data-lightbox-img]") ||
              Array.from(dialog.querySelectorAll("img")).find(
                (el) => !DECORATIVE_REGEX.test(el.src || "") && el.naturalWidth >= 400
              );

            const blobSrc =
              (dlAnchor && dlAnchor.getAttribute("href")) ||
              (lbImg && (lbImg.currentSrc || lbImg.src || "").startsWith("blob:") && lbImg.complete && lbImg.naturalWidth > 400
                ? lbImg.currentSrc || lbImg.src
                : "");

            if (blobSrc && blobSrc.startsWith("blob:")) {
              try {
                const res = await fetch(blobSrc);
                const blob = await res.blob();
                const dUrl = await blobToDataUrl(blob);
                if (dUrl.startsWith("data:image/")) {
                  resultDataUrl = dUrl;
                  note = "Lightbox Decrypted Full-HD";
                  break;
                }
              } catch {
                // fall back to canvas capture below
              }
            }

            const elapsed = Date.now() - openStart;
            if (
              lbImg &&
              !/\/exam-xs\//i.test(lbImg.currentSrc || lbImg.src || "") &&
              lbImg.complete &&
              lbImg.naturalWidth >= 600 &&
              elapsed >= 700
            ) {
              const canvasRes = await captureViaCanvas(lbImg);
              if (canvasRes.ok) {
                resultDataUrl = canvasRes.dataUrl;
                note = "Clicked Modal High-Res";
                break;
              }
            }
          }
        } catch {
          // ignore modal click error
        } finally {
          try {
            const closeBtn = document.querySelector(
              "[role='dialog'] button[aria-label='Đóng xem ảnh'], [aria-label*='close' i], [data-action='close'], .modal-close, button.close, .pswp__button--close"
            );
            if (closeBtn) {
              closeBtn.click();
            } else {
              document.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true })
              );
            }
            const closeDeadline = Date.now() + 1200;
            while (Date.now() < closeDeadline) {
              if (!document.querySelector("[role='dialog'], .pswp--open, .fancybox__container")) break;
              await new Promise((r) => setTimeout(r, 80));
            }
          } catch {}
        }

        return { ok: Boolean(resultDataUrl), locked, dataUrl: resultDataUrl, note };
      }

      // 3. Multi-Strategy Image & Community Answer Fetching
      const questionBlocks = [];
      const capturedQuestions = [];
      const diagnosticErrors = [];
      let successCount = 0;
      let confirmedLockedModal = false;

      for (let i = 0; i < candidates.length; i++) {
        const item = candidates[i];
        const qNum = i + 1;
        activeBtn.textContent = `📥 FETCHING (${qNum}/${candidates.length})...`;

        let dataUrl = null;
        let successNote = "";
        let commInfo = null;
        let modalLockedDetected = false;
        const stepErrors = [];

        // Tier 0: Async lightbox modal capture (skips clicking locked cards after lock confirmed)
        if (!dataUrl && (item.anchorEl || item.imgEl) && !(confirmedLockedModal && item.isLockedCard)) {
          const modalRes = await captureViaLightboxModal(item);
          if (modalRes.ok && modalRes.dataUrl) {
            dataUrl = modalRes.dataUrl;
            successNote = modalRes.note || "Clicked Modal High-Res";
          } else if (modalRes.locked) {
            modalLockedDetected = true;
            if (item.isLockedCard) confirmedLockedModal = true;
            stepErrors.push("modal(locked member preview)");
          }
        }

        // Tier 1: Direct Full-HD Attachment URL with session cookies (never overwrite Tier 0)
        if (!dataUrl && item.fullUrl) {
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
              successNote = /\/exam-xs\//i.test(mediaPage.imageUrl)
                ? "Thumbnail (Media Preview)"
                : "Full-HD Media Gallery";
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
          const dims = await getImageDimensions(dataUrl);
          const isLowResLocked =
            modalLockedDetected ||
            Boolean(item.isLockedCard) ||
            (dims.width > 0 && dims.width <= 400 && dims.height > 0 && dims.height <= 220);

          // Extract Community Answer if mediaUrl is available
          let commAnsHtml = "";
          commInfo = null;
          if (item.mediaUrl) {
            try {
              commInfo = await scrapeCommunityAnswerForMedia(item.mediaUrl);
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
          const dimLabel = dims.width && dims.height ? ` (${dims.width}x${dims.height})` : "";
          questionBlocks.push(`
  <div class="question" style="margin-bottom: 28px; padding: 18px; border: 2px solid #0f172a; background-color: #ffffff;">
    <p style="font-size: 16px; margin-top: 0;"><strong>Question ${qNum}${safeFilename}:</strong> Solve the question shown in the diagram/screenshot below.</p>
    ${commAnsHtml}
    <img src="${dataUrl}" alt="Question ${qNum}" style="max-width: 100%; height: auto; display: block; margin: 14px 0; border: 1px solid #cbd5e1;" />
    <span style="font-size: 11px; color: #64748b; font-family: monospace;">Source: ${escapeHtml(successNote + dimLabel)}</span>
  </div>`);

          capturedQuestions.push({
            questionNumber: qNum,
            filename: item.rawFilename || `q${qNum}.webp`,
            caption: `Question ${qNum}${item.rawFilename ? ` (${item.rawFilename})` : ""}`,
            communityAnswer: commInfo?.topAnswer || null,
            questionStem: commInfo?.questionStem || "",
            dataUrl,
            imageWidth: dims.width,
            imageHeight: dims.height,
            isLowResLocked,
            sourceNote: successNote,
          });
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
        btnHtml.textContent = "⚡ EXPORT HTML";
        btnFreeJson.textContent = "🆓 FREE OCR JSON";
        btnAiJson.textContent = "📦 AI JSON";
        btnHtml.disabled = false;
        btnFreeJson.disabled = false;
        btnAiJson.disabled = false;
        btnKey.disabled = false;
        return;
      }

      // 4. Download Export File (HTML or JSON)
      const cleanName = title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);

      if (format === "free_json" || format === "ai_json" || format === "json") {
        let finalQuestions = [];

        if (format === "free_json") {
          // 100% Free In-Browser OCR (CSP-safe persistent Tesseract.js with OCR.space fallback)
          finalQuestions = await runFreeOcrBatch(capturedQuestions, subjectCode, activeBtn);
        } else {
          // AI JSON path (Gemini / OpenRouter)
          let geminiKey = typeof GM_getValue === "function" ? GM_getValue("GEMINI_API_KEY", "") : "";
          if (!geminiKey) {
            const wantFree = confirm(
              "No AI API Key is configured.\n\nClick OK to export using 100% FREE In-Browser OCR (No API key needed)!\n\nClick Cancel to enter a Gemini / OpenRouter API Key."
            );
            if (wantFree) {
              finalQuestions = await runFreeOcrBatch(capturedQuestions, subjectCode, activeBtn);
            } else {
              const input = prompt(
                "Enter your Google Gemini API Key or OpenRouter Key:\n(Free key at: https://aistudio.google.com/apikey)"
              );
              if (input && input.trim()) {
                geminiKey = input.trim();
                if (typeof GM_setValue === "function") {
                  GM_setValue("GEMINI_API_KEY", geminiKey);
                }
              }
            }
          }

          if (geminiKey && finalQuestions.length === 0) {
            const solvedList = [];
            for (let idx = 0; idx < capturedQuestions.length; idx++) {
              const item = capturedQuestions[idx];
              activeBtn.textContent = `🧠 AI OCR (${idx + 1}/${capturedQuestions.length})...`;
              const solved = await transcribeQuestionWithGemini(
                geminiKey,
                item.dataUrl,
                "image/webp",
                item.questionNumber,
                item.questionStem || "",
                item.communityAnswer || null,
                subjectCode
              );
              solvedList.push({
                questionNumber: item.questionNumber,
                question: solved.question,
                options: solved.options,
                correctAnswer: solved.correctAnswer,
                explanation: solved.explanation,
                communityAnswer: item.communityAnswer,
                filename: item.filename,
              });
              if (idx < capturedQuestions.length - 1) {
                await new Promise((r) => setTimeout(r, 400));
              }
            }
            finalQuestions = solvedList;
          }

          if (finalQuestions.length === 0) {
            finalQuestions = capturedQuestions;
          }
        }

        const quizJson = {
          title,
          subjectCode,
          sourceUrl: window.location.href,
          retrievedAt: new Date().toISOString(),
          totalQuestions: finalQuestions.length,
          questions: finalQuestions,
        };
        const blob = new Blob([JSON.stringify(quizJson, null, 2)], {
          type: "application/json;charset=utf-8",
        });
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = dlUrl;
        const prefix = format === "free_json" ? "free_ocr_" : "solved_";
        a.download = `${cleanName}_${prefix}questions.json`;
        a.click();
        URL.revokeObjectURL(dlUrl);

        if (format === "free_json") {
          const lockedLowResCount = finalQuestions.filter((q) => q.ocrStatus === "locked_thumbnail_low_res").length;
          if (lockedLowResCount > 0) {
            alert(
              `Exported ${finalQuestions.length} questions, but ${lockedLowResCount}/${finalQuestions.length} images were locked 304x160 previews ("dành cho thành viên có gói").\n\n` +
                `At 304x160 resolution, A/B/C/D options are only ~2px tall and unreadable by local OCR, so clean Schema.org question stems were preserved instead of noise.\n\n` +
                `To extract full options:\n` +
                `1. Log in with an unlocked FuOverflow package (script will capture 1920x1012 Full-HD automatically), OR\n` +
                `2. Try [ 📦 AI JSON ] with a Gemini/OpenRouter key.`
            );
          }
        }
      } else {
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
        a.download = `${cleanName}_ready_for_qna.html`;
        a.click();
        URL.revokeObjectURL(dlUrl);
      }

      activeBtn.textContent = `✓ EXPORTED ${successCount} QUESTIONS!`;
      activeBtn.style.backgroundColor = "#059669";
      setTimeout(() => {
        btnHtml.textContent = "⚡ EXPORT HTML";
        btnFreeJson.textContent = "🆓 FREE OCR JSON";
        btnAiJson.textContent = "📦 AI JSON";
        btnHtml.style.backgroundColor = "#0f172a";
        btnFreeJson.style.backgroundColor = "#0f172a";
        btnAiJson.style.backgroundColor = "#0f172a";
        btnHtml.disabled = false;
        btnFreeJson.disabled = false;
        btnAiJson.disabled = false;
        btnKey.disabled = false;
      }, 5000);
    } catch (err) {
      console.error("Export error:", err);
      alert(`Export failed: ${err.message}`);
      btnHtml.textContent = "⚡ EXPORT HTML";
      btnFreeJson.textContent = "🆓 FREE OCR JSON";
      btnAiJson.textContent = "📦 AI JSON";
      btnHtml.disabled = false;
      btnFreeJson.disabled = false;
      btnAiJson.disabled = false;
      btnKey.disabled = false;
    }
  }

  document.body.appendChild(container);
})();
