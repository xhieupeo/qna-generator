// ==UserScript==
// @name         FU Overflow & FuExam to QnA Generator (1-Click Exporter)
// @namespace    https://github.com/xhieupeo/qna-generator
// @version      1.2.0
// @description  Extract all exam question images from FU Overflow / FuExam threads via GM_xmlhttpRequest (CORS bypass), /media/ fallback, and canvas capture.
// @author       QnA Generator Team
// @match        https://fuoverflow.com/threads/*
// @match        http://fuoverflow.com/threads/*
// @match        https://fuexam.me/threads/*
// @match        http://fuexam.me/threads/*
// @grant        GM_xmlhttpRequest
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
   * Cross-origin capable fetch backed by Tampermonkey's GM_xmlhttpRequest (bypasses CDN/R2/S3 CORS).
   */
  function gmRequest(url, { responseType = "blob", anonymous = false, timeout = 12000 } = {}) {
    if (typeof GM_xmlhttpRequest === "function") {
      return new Promise((resolve) => {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          responseType,
          anonymous,
          timeout,
          headers: {
            Referer: window.location.href,
          },
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
          onerror: () => {
            resolve({ ok: false, status: 0, contentType: "", response: null, text: "", error: "GM network error" });
          },
          ontimeout: () => {
            resolve({ ok: false, status: 0, contentType: "", response: null, text: "", error: "Timeout" });
          },
        });
      });
    }

    // Fallback to browser fetch if GM_xmlhttpRequest is unavailable
    return fetch(url, { credentials: anonymous ? "omit" : "include" })
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
        error: err?.message || "Fetch CORS/Network error",
      }));
  }

  async function fetchValidImageDataUrl(url) {
    if (!url) return { ok: false, reason: "empty URL", dataUrl: null };
    if (url.startsWith("data:image/") && !url.startsWith("data:image/svg")) {
      return { ok: true, reason: "inline data URI", dataUrl: url };
    }

    // Try with cookies first, then anonymous (for pre-signed S3/R2 CDNs that reject cookies)
    let lastReason = "unknown";
    for (const anonymous of [false, true]) {
      const res = await gmRequest(url, { responseType: "blob", anonymous });
      if (!res.ok) {
        lastReason = res.error ? `${res.error}` : `HTTP ${res.status}`;
        // If server explicitly returned 403/401 with cookies, only try anonymous if host differs (CDN)
        const sameHost = (() => {
          try {
            return new URL(res.finalUrl || url).hostname === window.location.hostname;
          } catch {
            return true;
          }
        })();
        if (sameHost && (res.status === 401 || res.status === 403)) {
          break;
        }
        continue;
      }

      const blob = res.response;
      const mime = ((blob && blob.type) || res.contentType || "").toLowerCase();
      if (!blob || !mime.startsWith("image/") || mime.includes("svg") || blob.size < 400) {
        lastReason = `HTTP ${res.status} non-image (${mime || "unknown"}, ${blob ? blob.size : 0}B)`;
        break;
      }

      try {
        const dataUrl = await blobToDataUrl(blob);
        if (dataUrl.startsWith("data:image/")) {
          return { ok: true, reason: `HTTP ${res.status} (${mime})`, dataUrl };
        }
        lastReason = "invalid dataUrl prefix";
      } catch (e) {
        lastReason = e?.message || "FileReader error";
      }
    }

    return { ok: false, reason: lastReason, dataUrl: null };
  }

  async function resolveMediaPageImageUrl(mediaUrl) {
    if (!mediaUrl) return { ok: false, reason: "no mediaUrl", imageUrl: "" };
    const cleanMediaUrl = mediaUrl.split("?")[0];
    const res = await gmRequest(cleanMediaUrl, { responseType: "text", anonymous: false });
    if (!res.ok || !res.text) {
      return { ok: false, reason: res.error || `HTTP ${res.status}`, imageUrl: "" };
    }

    try {
      const doc = new DOMParser().parseFromString(res.text, "text/html");
      const selectors = [
        ".media-container img",
        ".xfmgMedia-content img",
        ".p-body-pageContent .media img",
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
      return { ok: false, reason: "no media img tag found", imageUrl: "" };
    } catch {
      return { ok: false, reason: "HTML parse failed", imageUrl: "" };
    }
  }

  async function captureViaCanvas(imgEl) {
    if (!imgEl) return { ok: false, reason: "no DOM img", dataUrl: null };

    // Force eager loading if lazy-loaded offscreen
    if (!imgEl.complete || !imgEl.naturalWidth) {
      try {
        imgEl.loading = "eager";
        const lazySrc = imgEl.getAttribute("data-src") || imgEl.getAttribute("data-url");
        if (lazySrc && !imgEl.src) {
          imgEl.src = lazySrc;
        }
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 1200);
          imgEl.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
          imgEl.addEventListener("error", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      } catch {
        // ignore
      }
    }

    if (!imgEl.complete || !imgEl.naturalWidth || !imgEl.naturalHeight) {
      return { ok: false, reason: "DOM img 0x0 / not loaded", dataUrl: null };
    }

    try {
      const canvas = document.createElement("canvas");
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return { ok: false, reason: "no 2D context", dataUrl: null };
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imgEl, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.94);
      if (dataUrl.startsWith("data:image/")) {
        return { ok: true, reason: "canvas capture", dataUrl };
      }
      return { ok: false, reason: "empty canvas output", dataUrl: null };
    } catch (err) {
      return { ok: false, reason: `canvas error (${err?.name || err?.message || "tainted"})`, dataUrl: null };
    }
  }

  // Create floating brutalist button adhering to styles.md (zero radius, no gradients)
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
      // 1. Extract Clean Title
      const h1 = document.querySelector("h1.p-title-value");
      let title = document.title;
      if (h1) {
        const clone = h1.cloneNode(true);
        clone.querySelectorAll(".label, .label-append").forEach((el) => el.remove());
        title = clone.textContent.replace(/\s+/g, " ").trim() || document.title;
      }

      // 2. Collect candidate items with fullUrl, mediaUrl, thumbUrl, and DOM imgEl
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

      function addCandidate(fullUrl, mediaUrl, thumbUrl, imgEl, label) {
        const key = mediaUrl || fullUrl || thumbUrl;
        if (!key || seenKeys.has(key)) return;
        if (DECORATIVE_REGEX.test(key)) return;
        seenKeys.add(key);
        candidates.push({ fullUrl, mediaUrl, thumbUrl, imgEl, label });
      }

      // A. XenForo Attachment Cards (<li class="file">)
      document.querySelectorAll("li.file").forEach((li) => {
        const a = li.querySelector("a.file-preview, a[href*='attachments/']");
        const img = li.querySelector("img");
        const nameEl = li.querySelector(".file-name");
        const fullUrl = a ? resolveUrl(a.getAttribute("href") || a.href) : "";
        const mediaUrl = extractMediaHref(a);
        const thumbUrl = img
          ? resolveUrl(img.getAttribute("data-src") || img.getAttribute("data-url") || img.getAttribute("src") || img.src || "")
          : "";
        const label =
          (nameEl && (nameEl.getAttribute("title") || nameEl.textContent.trim())) ||
          (img && img.getAttribute("alt")) ||
          "";
        addCandidate(fullUrl, mediaUrl, thumbUrl, img, label);
      });

      // B. Inline lightbox images inside posts (.bbWrapper a.js-lbImage)
      document.querySelectorAll(".bbWrapper a.js-lbImage, .bbWrapper a[href*='attachments/']").forEach((a) => {
        const img = a.querySelector("img");
        const fullUrl = resolveUrl(a.getAttribute("href") || a.href || "");
        const mediaUrl = extractMediaHref(a);
        const thumbUrl = img
          ? resolveUrl(img.getAttribute("data-src") || img.getAttribute("data-url") || img.getAttribute("src") || img.src || "")
          : "";
        const label = (img && (img.getAttribute("alt") || img.getAttribute("title"))) || "";
        addCandidate(fullUrl, mediaUrl, thumbUrl, img, label);
      });

      // C. Fallback raw images inside post body
      if (candidates.length === 0) {
        document.querySelectorAll(".bbWrapper img, .message-body img").forEach((img) => {
          const src = resolveUrl(
            img.getAttribute("data-src") || img.getAttribute("data-url") || img.getAttribute("src") || img.src || ""
          );
          addCandidate("", "", src, img, img.getAttribute("alt") || "");
        });
      }

      if (candidates.length === 0) {
        alert("No question images found on this thread.");
        button.textContent = "⚡ EXPORT TO QNA GENERATOR";
        button.disabled = false;
        return;
      }

      // 3. Multi-strategy image capture (GM full -> /media/ -> GM thumb -> Canvas)
      const questionBlocks = [];
      const diagnosticSamples = [];
      let successCount = 0;
      let skipFullUrl = false;
      let consecutiveFullFails = 0;
      let skipMediaUrl = false;
      let consecutiveMediaFails = 0;

      for (let i = 0; i < candidates.length; i++) {
        const item = candidates[i];
        button.textContent = `📥 FETCHING (${i + 1}/${candidates.length})...`;

        let dataUrl = null;
        const stepErrors = [];

        // Strategy 1: Direct full attachment URL via GM_xmlhttpRequest
        if (!skipFullUrl && item.fullUrl) {
          const fullRes = await fetchValidImageDataUrl(item.fullUrl);
          if (fullRes.ok) {
            dataUrl = fullRes.dataUrl;
            consecutiveFullFails = 0;
          } else {
            stepErrors.push(`full(${fullRes.reason})`);
            consecutiveFullFails++;
          }
        }

        // Strategy 2: /media/ item page resolution -> GM_xmlhttpRequest image fetch
        if (!dataUrl && !skipMediaUrl && item.mediaUrl) {
          const mediaPage = await resolveMediaPageImageUrl(item.mediaUrl);
          if (mediaPage.ok && mediaPage.imageUrl) {
            const mediaImgRes = await fetchValidImageDataUrl(mediaPage.imageUrl);
            if (mediaImgRes.ok) {
              dataUrl = mediaImgRes.dataUrl;
              consecutiveMediaFails = 0;
            } else {
              stepErrors.push(`mediaImg(${mediaImgRes.reason})`);
              consecutiveMediaFails++;
            }
          } else {
            stepErrors.push(`mediaPage(${mediaPage.reason})`);
            consecutiveMediaFails++;
          }
        }

        // Strategy 3: Thumbnail URL via GM_xmlhttpRequest (bypasses CDN CORS)
        if (!dataUrl && item.thumbUrl && item.thumbUrl !== item.fullUrl) {
          const thumbRes = await fetchValidImageDataUrl(item.thumbUrl);
          if (thumbRes.ok) {
            dataUrl = thumbRes.dataUrl;
          } else {
            stepErrors.push(`thumb(${thumbRes.reason})`);
          }
        }

        // Strategy 4: Force-load lazy DOM <img> and capture pixels via Canvas
        if (!dataUrl && item.imgEl) {
          const canvasRes = await captureViaCanvas(item.imgEl);
          if (canvasRes.ok) {
            dataUrl = canvasRes.dataUrl;
          } else {
            stepErrors.push(`canvas(${canvasRes.reason})`);
          }
        }

        // Only enable fast-skip on fullUrl/mediaUrl if an alternative fallback actually succeeded
        if (dataUrl) {
          if (consecutiveFullFails >= 3) skipFullUrl = true;
          if (consecutiveMediaFails >= 3) skipMediaUrl = true;
          successCount++;

          const safeLabel = escapeHtml(item.label ? ` (${item.label})` : "");
          questionBlocks.push(`
  <div class="question" style="margin-bottom: 24px; padding: 16px; border: 1px solid #0f172a;">
    <p><strong>Question ${i + 1}${safeLabel}:</strong> Solve the question shown in the diagram/screenshot below.</p>
    <img src="${dataUrl}" alt="Question ${i + 1}" style="max-width: 100%; height: auto; display: block; margin: 12px 0;" />
  </div>`);
        } else {
          const diag = `Q${i + 1} [${item.label || "img"}]: ${stepErrors.join(" | ")}`;
          console.warn("[QnA Exporter]", diag, item);
          if (diagnosticSamples.length < 3) {
            diagnosticSamples.push(diag);
          }
        }

        if (i < candidates.length - 1) {
          await new Promise((r) => setTimeout(r, 60));
        }
      }

      if (successCount === 0) {
        const gmActive = typeof GM_xmlhttpRequest === "function" ? "YES" : "NO";
        alert(
          `Could not capture any valid images (0/${candidates.length}).\n` +
            `GM_xmlhttpRequest active: ${gmActive}\n\n` +
            `Sample diagnostics:\n${diagnosticSamples.join("\n")}\n\n` +
            `Note: If full attachments return HTTP 403 even while logged in, the thread may require Membership/reaction or Tampermonkey permission for cross-origin @connect.`
        );
        button.textContent = "⚡ EXPORT TO QNA GENERATOR";
        button.disabled = false;
        return;
      }

      const finalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
</head>
<body style="font-family: sans-serif; max-width: 800px; margin: 20px auto; padding: 0 16px;">
  <h1>${escapeHtml(title)}</h1>
  <p style="color: #64748b; font-size: 14px;">Source: ${escapeHtml(window.location.href)} (${successCount}/${candidates.length} images captured)</p>
  <hr style="margin: 20px 0; border: 1px solid #0f172a;" />
${questionBlocks.join("\n")}
</body>
</html>`;

      const blob = new Blob([finalHtml], { type: "text/html" });
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
      }, 4500);
    } catch (err) {
      console.error("Export error:", err);
      alert(`Export failed: ${err.message}`);
      button.textContent = "⚡ EXPORT TO QNA GENERATOR";
      button.disabled = false;
    }
  });

  document.body.appendChild(button);
})();
