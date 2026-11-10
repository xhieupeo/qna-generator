# QnA Generator

**Multimodal HTML & Image-to-MCQ Platform**

> Transform HTML exam documents and FU Overflow threads into verified multiple-choice questions with AI-powered solving, LaTeX math rendering, and interactive practice mode.

🔗 **Live Demo**: [https://qna-generator-eta.vercel.app](https://qna-generator-eta.vercel.app/)

---

## Features

### Dual AI Provider Support
- **Google Gemini** — Direct Google AI API with `gemini-3.8-flash` (default), plus `gemini-3.1-flash`, `gemini-3.0-flash`, and `gemini-3.5-flash-lite`.
- **OpenRouter** — Free vision models via OpenAI-compatible API. Default: `openrouter/free` (auto-routes to the best available free model). Also supports `nvidia/nemotron-3.5-super-vl:free`, `meta-llama/llama-3.2-11b-vision-instruct:free`, and `qwen/qwen2.5-vl-72b-instruct`.
- API keys can be entered directly in the web UI — no `.env` file required for basic usage.

### FU Overflow Integration
- **Direct URL ingestion**: Paste any `fuoverflow.com` thread URL and the app fetches all question images, attachments, and community discussion answers automatically.
- **Community consensus cross-check**: Scraped student answers are passed to the AI as hints to catch common traps.
- **Tampermonkey Userscript** (`scripts/fuo-extension.user.js`): Adds a floating export button directly on `fuoverflow.com` threads.
- **CLI Retriever** (`scripts/retrieve-fuoverflow.mjs`): Scrape threads via terminal into a drag-and-drop HTML file.

### Multi-Format File Ingestion
- Accepts `.html`, `.htm`, or `.zip` bundles (HTML + image assets).
- Automatically extracts and normalizes inline Base64 images, relative paths, and remote URLs.
- Server-side image enhancement via Sharp (flatten transparency, sharpen for OCR).

### AI Solving & Distractor Generation
- Solves problems directly from visual diagrams, circuits, geometry, code screenshots, and mathematical notation.
- Generates 4 plausible options (1 verified correct + 3 realistic distractors).
- Provides detailed step-by-step pedagogical explanations.
- Self-healing model fallback: if a model returns 404, automatically switches to the default.

### LaTeX & Math Rendering
- Full KaTeX support for inline (`$...$`) and display (`$$...$$`) math.
- Renders mathematical notation, equations, and formulas throughout questions, options, and explanations.

### Live Question Studio
- Inspect each question with image zoom lightbox.
- Edit question text, options, correct answer, and explanation inline.
- Retry individual failed questions with a single click.
- Error banners for failed generation/retry attempts.

### Interactive Practice Quiz
- Built-in quiz mode with instant scoring and question jump palette.
- Step-by-step solution reveals after answering.
- Score percentage and progress tracking.

### Supabase Library (Optional)
- Persist quizzes and questions to PostgreSQL.
- Extracted images uploaded to Supabase Storage (`quiz-images` bucket).
- **Library page** (`/library`) to review, retake, or export past quizzes.
- **Supabase is fully optional** — the app works without it for generation, practice, and export.

### Multi-Format Export
| Format | Extension | Use Case |
|--------|-----------|----------|
| Moodle GIFT | `.txt` | Import into Moodle LMS |
| Canvas Aiken | `.txt` | Import into Canvas LMS |
| CSV | `.csv` | Open in Excel / Google Sheets |
| JSON | `.json` | Programmatic use / re-import |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5.9 |
| Styling | Tailwind CSS 3.4 |
| AI (Provider 1) | Google Gemini API (`@google/generative-ai`) |
| AI (Provider 2) | OpenRouter (OpenAI-compatible REST) |
| Math Rendering | KaTeX |
| Image Processing | Sharp |
| HTML Parsing | Cheerio |
| ZIP Handling | JSZip |
| Database | Supabase (PostgreSQL + Storage) |
| Deployment | Vercel |

---

## Getting Started

### Prerequisites
- Node.js 18+
- npm or pnpm

### 1. Clone & Install

```bash
git clone https://github.com/xhieupeo/qna-generator.git
cd qna-generator
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env.local
```

Fill in your keys in `.env.local`:

```env
# Google Gemini API (optional — can also enter in the UI)
GEMINI_API_KEY=your_gemini_api_key_here

# OpenRouter API (optional — can also enter in the UI)
OPENROUTER_API_KEY=your_openrouter_api_key_here

# FU Overflow session cookie (optional — for full-HD attachments)
FUO_COOKIE=your_xf_cookie_here

# Supabase (optional — only needed for Library/cloud save)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
```

> **Note**: All keys are optional for basic usage. You can enter Gemini or OpenRouter API keys directly in the web UI. Supabase is only needed if you want to save quizzes to the cloud.

### 3. Set Up Supabase (Optional)

If you want the Library feature:
1. Create a free project at [supabase.com](https://supabase.com).
2. Run the SQL script in your Supabase SQL Editor: [`supabase/schema.sql`](supabase/schema.sql).
3. This creates the `quizzes`, `questions`, and `quiz_attempts` tables, plus the `quiz-images` storage bucket.

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## FU Overflow Tools

### Option A: Direct Web UI (Recommended)
1. Open the app and click the **[ 🌐 DIRECT FU OVERFLOW URL ]** tab.
2. Paste the thread URL (e.g. `https://fuoverflow.com/threads/mad101-sp26-re.6332/`).
3. Click **[ RETRIEVE FROM FU OVERFLOW & SOLVE ]**.

### Option B: Tampermonkey Userscript
1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Create a new script and paste the code from [`scripts/fuo-extension.user.js`](scripts/fuo-extension.user.js).
3. Browse any thread on `fuoverflow.com` and click the floating **[ ⚡ EXPORT TO QNA GENERATOR ]** button.

### Option C: CLI Retriever
```bash
node scripts/retrieve-fuoverflow.mjs --url "https://fuoverflow.com/threads/mad101-sp26-re.6332/"
```
Generates `fuoverflow_latest_ready.html` — drag and drop it into the generator.

---

## Deploy to Vercel

1. Push your code to GitHub.
2. Import the repository on [vercel.com](https://vercel.com).
3. Add your environment variables in the Vercel project settings.
4. Deploy — Vercel auto-detects Next.js and handles the rest.

---

## Design System

This project follows a **Precision Technical / Modern Brutalist** design system:

- **Zero gradients** — solid colors only
- **Zero border radius** — all elements use `rounded-none`
- **Hard offset shadows** — `3px 3px 0px #0F172A`
- **Monospace accents** — `font-mono` for technical elements

---

## License

MIT
