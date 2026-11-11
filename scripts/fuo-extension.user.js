// ==UserScript==
// @name         FU Overflow & FuExam to QnA Generator (1-Click Exporter)
// @namespace    https://github.com/xhieupeo/qna-generator
// @version      1.1.0
// @description  Extract all exam question images from FU Overflow / FuExam threads with automatic thumbnail/canvas fallback and save a self-contained HTML file for QnA Generator.
// @author       QnA Generator Team
// @match        https://fuoverflow.com/threads/*
// @match        http://fuoverflow.com/threads/*
// @match        https://fuexam.me/threads/*
// @match        http://fuexam.me/threads/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("FileReader failed"));
      reader.readAsDataURL(blob);
    });
  }

  function canvasFallbackFromImg(imgEl) {
    try {
      if (!imgEl || !imgEl.complete || !imgEl.naturalWidth || !imgEl.naturalHeight) {
        return null;
      }
      const canvas = document.createElement("canvas");
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imgEl, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.94);
      return dataUrl.startsWith("data:image/") ? dataUrl : null;
    } catch {
      return null;
    }
  }

  async function fetchValidImageDataUrl(url) {
    if (!url) return { ok: false, status: 0, dataUrl: null };
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        return { ok: false, status: res.status, dataUrl: null };
      }
      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      const blob = await res.blob();
      const mime = (blob.type || contentType).toLowerCase();
      // Reject HTML error pages (e.g. login prompt or Cloudflare/403 page) & empty blobs
      if (!mime.startsWith("image/") || mime.includes("svg") || blob.size < 500) {
        return { ok: false, status: res.status, dataUrl: null };
      }
      const dataUrl = await blobToDataUrl(blob);
      if (!dataUrl.startsWith("data:image/")) {
        return { ok: false, status: res.status, dataUrl: null };
      }
      return { ok: true, status: res.status, dataUrl };
    } catch {
      return { ok: false, status: 0, dataUrl: null };
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

      // 2. Collect candidate items with BOTH full attachment URL and thumbnail <img> fallback
      const candidates = [];
      const seenKeys = new Set();

      function addCandidate(fullUrl, thumbUrl, imgEl, label) {
        const key = fullUrl || thumbUrl;
        if (!key || seenKeys.has(key)) return;
        if (/(avatar|smilie|smiley|emoji|reaction|badge|logo|icon)/i.test(key)) return;
        seenKeys.add(key);
        candidates.push({ fullUrl, thumbUrl, imgEl, label });
      }

      // A. XenForo Attachment Cards (<li class="file">)
      document.querySelectorAll("li.file").forEach((li) => {
        const a = li.querySelector("a.file-preview, a[href*='attachments/']");
        const img = li.querySelector("img");
        const nameEl = li.querySelector(".file-name");
        const fullUrl = a ? a.href : "";
        const thumbUrl = img
          ? img.getAttribute("data-src") || img.getAttribute("data-url") || img.src || ""
          : "";
        const label =
          (nameEl && (nameEl.getAttribute("title") || nameEl.textContent.trim())) ||
          (img && img.getAttribute("alt")) ||
          "";
        addCandidate(fullUrl, thumbUrl, img, label);
      });

      // B. Inline lightbox images inside posts (.bbWrapper a.js-lbImage)
      document.querySelectorAll(".bbWrapper a.js-lbImage, .bbWrapper a[href*='attachments/']").forEach((a) => {
        const img = a.querySelector("img");
        const fullUrl = a.href || "";
        const thumbUrl = img
          ? img.getAttribute("data-src") || img.getAttribute("data-url") || img.src || ""
          : "";
        const label = (img && (img.getAttribute("alt") || img.getAttribute("title"))) || "";
        addCandidate(fullUrl, thumbUrl, img, label);
      });

      // C. Fallback raw images inside post body
      if (candidates.length === 0) {
        document.querySelectorAll(".bbWrapper img, .message-body img").forEach((img) => {
          const src = img.getAttribute("data-src") || img.getAttribute("data-url") || img.src || "";
          addCandidate("", src, img, img.getAttribute("alt") || "");
        });
      }

      if (candidates.length === 0) {
        alert("No question images found on this thread.");
        button.textContent = "⚡ EXPORT TO QNA GENERATOR";
        button.disabled = false;
        return;
      }

      // 3. Download valid images (with automatic thumbnail/canvas fallback if fullUrl is 403/HTML)
      const questionBlocks = [];
      let successCount = 0;
      let skipFullUrl = false;
      let consecutiveFullFails = 0;

      for (let i = 0; i < candidates.length; i++) {
        const item = candidates[i];
        button.textContent = `📥 FETCHING (${i + 1}/${candidates.length})...`;

        let dataUrl = null;

        if (!skipFullUrl && item.fullUrl) {
          const fullRes = await fetchValidImageDataUrl(item.fullUrl);
          if (fullRes.ok) {
            dataUrl = fullRes.dataUrl;
            consecutiveFullFails = 0;
          } else {
            consecutiveFullFails++;
            // If full attachments consistently return 403/non-image (e.g. guest permissions), skip straight to thumbnails
            if (consecutiveFullFails >= 2 && item.thumbUrl) {
              skipFullUrl = true;
            }
          }
        }

        if (!dataUrl && item.thumbUrl && item.thumbUrl !== item.fullUrl) {
          const thumbRes = await fetchValidImageDataUrl(item.thumbUrl);
          if (thumbRes.ok) {
            dataUrl = thumbRes.dataUrl;
          }
        }

        if (!dataUrl && item.imgEl) {
          dataUrl = canvasFallbackFromImg(item.imgEl);
        }

        if (dataUrl) {
          successCount++;
          const safeLabel = escapeHtml(item.label ? ` (${item.label})` : "");
          questionBlocks.push(`
  <div class="question" style="margin-bottom: 24px; padding: 16px; border: 1px solid #0f172a;">
    <p><strong>Question ${i + 1}${safeLabel}:</strong> Solve the question shown in the diagram/screenshot below.</p>
    <img src="${dataUrl}" alt="Question ${i + 1}" style="max-width: 100%; height: auto; display: block; margin: 12px 0;" />
  </div>`);
        }

        // Gentle pacing to avoid triggering Cloudflare rate limits
        if (i < candidates.length - 1) {
          await new Promise((r) => setTimeout(r, 80));
        }
      }

      if (successCount === 0) {
        alert(
          "Could not capture any valid images (the site returned non-image/403 responses for both full attachments and thumbnails). Try logging in first or scrolling down so images load before clicking Export."
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

      // Trigger instant download of self-contained HTML file
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
