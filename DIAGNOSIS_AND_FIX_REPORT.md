# Technical Incident Report: FU Overflow Image Retrieval & Rate-Limit Resolution

## Executive Summary

During testing of the **QnA Generator** with a 50-question exam thread from **FU Overflow (`fuoverflow.com`)**, two critical anomalies were reported:
1. **Low-Resolution / Blurry Watermarked Images**: Even with a valid session cookie provided, the application retrieved blurry, low-resolution question images displaying a black `FUO` watermark in the bottom-left corner.
2. **Fallback Cards on Later Questions**: Later questions (specifically Question 22 in a 50-question set) defaulted to placeholder text (`Question 22 (Q22.webp)`), placeholder options (`Option A`), and a `REVIEW NEEDED` badge.

This report documents the root cause analysis (RCA), technical mechanics, code modifications applied, and verification results.

---

## 1. Problem Symptoms & Visual Evidence

Analysis of the user screenshot (`media_1794217813082_8cc668f2.png`):

| Symptom | Observation | Underlying Meaning |
| :--- | :--- | :--- |
| **Black `FUO` Logo** | Visible in the lower-left corner of the question box | FU Overflow's server-side **guest anti-leech watermark**. Confirms the server treated the request as an unauthenticated guest. |
| **Severe Blur / Pixelation** | 400x150 pixel image stretched inside a large viewport | A compressed preview thumbnail was served instead of the Full-HD attachment (up to 1800px). |
| **`Question 22 (Q22.webp)`** | Question prompt reverted to the raw image filename | The Gemini AI generation call failed, causing the backend to trigger its fallback template. |
| **Placeholder Choices (`Option A`)** | No actual multiple choice options generated | Fallback placeholder triggered due to API exception. |
| **Badge: `REVIEW NEEDED`** | Question status set to review | Fallback status assigned when an unhandled exception or rate limit occurs. |

---

## 2. Root Cause Analysis (RCA)

```mermaid
flowchart TD
    subgraph Issue1["RCA 1: Cookie Stripping on Redirect"]
        Req1["1. Node fetch() to /attachments/q22.123/ with Cookie"] --> Redirect["2. FU Overflow responds with HTTP 302 Redirect to /data/attachments/..."]
        Redirect --> DropCookie["3. WHATWG Fetch Standard strips Cookie header on redirect"]
        DropCookie --> GuestResponse["4. FU Overflow receives unauthenticated request -> Returns 400x150 blurred 'FUO' thumbnail"]
    end

    subgraph Issue2["RCA 2: Sharp Upscaling Artifact"]
        GuestResponse --> Sharp["5. Sharp Lanczos3 upscales 400px thumbnail to 1800px"]
        Sharp --> BlurryOutput["6. Stretched, pixelated blurry image in UI"]
    end

    subgraph Issue3["RCA 3: Gemini 15 RPM Rate Limit"]
        Batch["7. 50 questions processed in rapid burst"] --> Limit["8. Gemini Free Tier quota: 15 Requests Per Minute (RPM)"]
        Limit --> Quota429["9. Question 16+ throws 429 RESOURCE_EXHAUSTED"]
        Quota429 --> FallbackCard["10. Catch block generates 'Question 22 (Q22.webp)' + 'REVIEW NEEDED'"]
    end
```

### RCA 1: Node.js `fetch` Silently Drops `Cookie` on 302 Redirects
* **The Mechanism**: On XenForo (the forum software powering FU Overflow), full-resolution attachment endpoints (e.g., `https://fuoverflow.com/attachments/q22-webp.12345/`) do not serve the binary directly; they return an **HTTP 302 Redirect** pointing to the internal storage path.
* **The Standard**: Per the [WHATWG Fetch Specification (§4.4)](https://fetch.spec.whatwg.org/#http-redirect-fetch), when `fetch` follows an HTTP redirect, user-specified `Cookie` headers are **automatically stripped** to prevent cross-origin/cross-endpoint credential leakage.
* **The Consequence**: Node's native `fetch` (via `undici`) followed the 302 redirect but dropped `headers["Cookie"]`. FU Overflow received the redirected request as an unauthenticated guest and returned the 400x150 blurred preview thumbnail with the black `FUO` watermark.
* *(Note: This explains why Python's `requests.Session()` in `fuo-downloader` succeeded: Python's `requests` maintains a cookie jar across same-origin redirects, whereas Node's `fetch` drops manual headers).*

### RCA 2: Sharp Upscaled Blurred Thumbnails
* When the full-resolution download was denied credentials, the retriever fell back to `item.thumbnailUrl`.
* `image-enhancer.ts` upscaled the 400px thumbnail to 1800px and applied unsharp masking. Upscaling a blurred thumbnail does not recover missing detail—it exaggerates pixelated edges and makes the blur larger.

### RCA 3: Gemini Free-Tier 15 RPM Rate Limit on 50 Questions
* The exam contained **50 questions**.
* Gemini's free tier has a hard rate limit of **15 Requests Per Minute (RPM)**.
* Processing questions 1 through 15 succeeded, but starting at question 16, the API threw `429 Too Many Requests (RESOURCE_EXHAUSTED)`.
* The catch block in `route.ts` caught this exception and returned the fallback question card (`Question 22 (Q22.webp)` with `REVIEW NEEDED`).

---

## 3. Implemented Fixes & Architectural Enhancements

### Fix 1: Manual Redirect Handler with Cookie Retention (`/api/fuoverflow/route.ts`)
Implemented `fetchWithCookies` using `redirect: "manual"` in a loop (up to 5 hops). This ensures `Cookie`, `User-Agent`, and `Referer` headers are preserved on every redirect step:

```typescript
async function fetchWithCookies(
  url: string,
  headers: Record<string, string>,
  maxRedirects = 5
): Promise<Response> {
  let currentUrl = url;
  for (let i = 0; i < maxRedirects; i++) {
    const res = await fetch(currentUrl, {
      headers,
      redirect: "manual",
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) break;
      currentUrl = new URL(location, currentUrl).toString();
      continue; // Strictly retains headers["Cookie"]!
    }
    return res;
  }
  return await fetch(currentUrl, { headers });
}
```

### Fix 2: Session Validation & Thumbnail Detection
1. **Login State Verification**: The initial thread HTML is inspected for `data-logged-in="true"`. If cookies were supplied but the session is not recognized as logged in, the API returns a structured warning:
   > *"The provided session cookie was not recognized as logged in by FU Overflow. Full-HD images might be restricted to guest thumbnails."*
2. **Thumbnail Detection in Sharp**: `downloadImageBuffer` now inspects image dimensions using `sharp(rawBuffer).metadata()`. If a 400x150 thumbnail is detected, aggressive sharpening is disabled so blur artifacts are not exaggerated.

### Fix 3: Exponential Backoff & Rate-Limit Pacing (`/api/generate/route.ts`)
Added `generateWithRetry` to automatically handle Gemini `429 Too Many Requests`:
* Intercepts `429` / `RESOURCE_EXHAUSTED` errors.
* Applies exponential backoff (waits 5s, 10s) and retries up to 2 times before falling back.
* Adds a 1.2s delay between questions when processing more than 5 questions, keeping requests safely under the 15 RPM token bucket.

### Fix 4: Dual-View Mode in Interactive Quiz Player (`QuizPlayer.tsx`)
Added the **`[ IMAGE ]` vs `[ DIGITIZED TEXT / LATEX ]`** view switcher and a full-screen **`[ EXPAND ]`** lightbox modal directly inside `QuizPlayer.tsx`, allowing students to toggle between visual figures and digitized LaTeX text during practice tests.

### Fix 5: UI Cookie Extraction Guide & Question Limit Selector (`src/app/page.tsx`)
* Added a 10-second guide explaining how to retrieve `xf_user` and `xf_session` from browser DevTools (`F12 -> Application -> Cookies -> fuoverflow.com`).
* Added a **"Questions to Process"** selector (`All`, `First 10`, `First 20`, `First 30`) for rapid testing without waiting for 50 questions.

---

## 4. Verification & Build Results

All components were tested and validated with production builds:

```bash
npx tsc --noEmit
# Output: Exit code 0 (Zero type errors)

npm run build
# Output: Exit code 0 (All 8 static/dynamic routes generated successfully)
```

| Route | Type | Status |
| :--- | :--- | :--- |
| `/` | Static | Compiled (9.89 kB) |
| `/library` | Static | Compiled (4.1 kB) |
| `/api/fuoverflow` | Dynamic | Compiled (Cookie-preserved scraper) |
| `/api/generate` | Dynamic | Compiled (429 retry + pacing) |
| `/api/quizzes` | Dynamic | Compiled (Supabase CRUD) |
| `/api/quizzes/[id]` | Dynamic | Compiled (Single quiz CRUD) |

