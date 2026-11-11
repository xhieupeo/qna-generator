// ==UserScript==
// @name         FU Overflow to QnA Generator (1-Click Exporter)
// @namespace    https://github.com/xhieupeo/qna-generator
// @version      1.0.0
// @description  Instantly extract all exam question images from FU Overflow threads and send to QnA Generator without screenshots!
// @author       QnA Generator Team
// @match        https://fuoverflow.com/threads/*
// @match        http://fuoverflow.com/threads/*
// @match        https://fuexam.me/threads/*
// @match        http://fuexam.me/threads/*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// ==/UserScript==

(function () {
  "use strict";

  // Create floating brutalist button adhering to styles.md (zero radius, no gradients)
  const button = document.createElement("button");
  button.innerHTML = "⚡ EXPORT TO QNA GENERATOR";
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
    button.style.backgroundColor = "#2563eb";
  });
  button.addEventListener("mouseleave", () => {
    button.style.backgroundColor = "#0f172a";
  });

  button.addEventListener("click", async () => {
    button.innerText = "⏳ EXTRACTING IMAGES...";
    button.disabled = true;

    try {
      // 1. Extract Title
      const h1 = document.querySelector("h1.p-title-value");
      const title = h1 ? h1.innerText.trim() : document.title;

      // 2. Extract image links
      const imageLinks = [];
      const seen = new Set();

      // Check standard attachment cards (<li class="file">)
      document.querySelectorAll("li.file a.file-preview, li.file a[href*='attachments/']").forEach((a) => {
        const href = a.href;
        if (href && !seen.has(href)) {
          seen.add(href);
          imageLinks.push(href);
        }
      });

      // Check inline body images
      document.querySelectorAll(".bbWrapper a.js-lbImage, .bbWrapper a[href*='attachments/']").forEach((a) => {
        const href = a.href;
        if (href && !seen.has(href)) {
          seen.add(href);
          imageLinks.push(href);
        }
      });

      // Fallback
      if (imageLinks.length === 0) {
        document.querySelectorAll(".bbWrapper img").forEach((img) => {
          const src = img.src || img.getAttribute("data-url");
          if (src && !seen.has(src) && !src.includes("avatar") && !src.includes("smilies")) {
            seen.add(src);
            imageLinks.push(src);
          }
        });
      }

      if (imageLinks.length === 0) {
        alert("No question images found on this thread.");
        button.innerText = "⚡ EXPORT TO QNA GENERATOR";
        button.disabled = false;
        return;
      }

      button.innerText = `📦 DOWNLOADING ${imageLinks.length} IMAGES...`;

      // Helper to fetch blob as base64
      async function fetchImageAsBase64(url) {
        const res = await fetch(url);
        const blob = await res.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve({ mimeType: blob.type, base64: reader.result });
          reader.readAsDataURL(blob);
        });
      }

      const questionBlocks = [];
      for (let i = 0; i < imageLinks.length; i++) {
        button.innerText = `DOWNLOADING (${i + 1}/${imageLinks.length})...`;
        const { mimeType, base64 } = await fetchImageAsBase64(imageLinks[i]);
        questionBlocks.push(`
  <div class="question" style="margin-bottom: 24px; padding: 16px; border: 1px solid #0f172a;">
    <p><strong>Question ${i + 1}:</strong> Solve the question shown in the diagram/screenshot below.</p>
    <img src="${base64}" alt="FU Overflow Question ${i + 1}" style="max-width: 100%; height: auto; display: block; margin: 12px 0;" />
  </div>`);
      }

      const finalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
</head>
<body style="font-family: sans-serif; max-width: 800px; margin: 20px auto; padding: 0 16px;">
  <h1>${title}</h1>
  <p style="color: #64748b; font-size: 14px;">Source: ${window.location.href}</p>
  <hr style="margin: 20px 0; border: 1px solid #0f172a;" />
${questionBlocks.join("\n")}
</body>
</html>`;

      // Trigger instant download of self-contained HTML file
      const blob = new Blob([finalHtml], { type: "text/html" });
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dlUrl;
      const cleanName = title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 50);
      a.download = `${cleanName}_ready_for_qna.html`;
      a.click();
      URL.revokeObjectURL(dlUrl);

      button.innerText = "✓ DOWNLOADED! READY FOR QNA";
      button.style.backgroundColor = "#059669";
      setTimeout(() => {
        button.innerText = "⚡ EXPORT TO QNA GENERATOR";
        button.style.backgroundColor = "#0f172a";
        button.disabled = false;
      }, 4000);
    } catch (err) {
      console.error("Export error:", err);
      alert(`Export failed: ${err.message}`);
      button.innerText = "⚡ EXPORT TO QNA GENERATOR";
      button.disabled = false;
    }
  });

  document.body.appendChild(button);
})();

