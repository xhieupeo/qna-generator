# QnA Generator: HTML & Image-to-MCQ Platform

A modern fullstack web platform that turns HTML documents and **FU Overflow (`fuoverflow.com`)** exam threads into structured, verified Multiple Choice Questions (MCQs) with automated answer resolution and pedagogical explanations powered by Google Gemini Multimodal AI.

Adheres strictly to the **Precision Technical / Modern Brutalist** design system (`styles.md`): **Zero Gradients**, **Zero Border Radius** (`rounded-none`), solid color tokens, and hard offset shadows.

---

## 🚀 Key Features

### 1. Zero-Screenshot FU Overflow Ingestion
* **Direct URL Tab**: Paste any FU Overflow thread link (e.g. `https://fuoverflow.com/threads/mad101-sp26-re.6332/`) directly into the web interface.
* **Automated Image & Attachment Extraction**: Automatically pulls all full-resolution question attachments (`li.file a.file-preview` and `a.js-lbImage`).
* **Community Consensus Cross-Check**: Scrapes student discussion answers (`/media/...`) and passes them to Gemini as hints to cross-verify against traps.
* **1-Click Tampermonkey Userscript** (`scripts/fuo-extension.user.js`): Adds a `[ ⚡ EXPORT TO QNA GENERATOR ]` button directly to `fuoverflow.com` threads.
* **Standalone CLI Retriever** (`scripts/retrieve-fuoverflow.mjs`): Scrape threads via terminal into an instant drag-and-drop HTML file.

### 2. Multi-Format File Ingestion
* Accepts `.html`, `.htm`, or `.zip` bundles (HTML file + image assets directory).
* Automatically extracts and normalizes inline Base64 images, relative paths, and remote URLs.

### 3. Automated AI Solving & Distractor Generation
* If the source lacks answers or options, **Google Gemini Multimodal AI** (`gemini-1.5-flash`, `gemini-1.5-pro`, or `gemini-2.5-flash`) solves the problem directly from visual diagrams, circuits, geometry, or code screenshots.
* Formulates 4 plausible options (1 verified correct answer + 3 realistic distractors).
* Supplies detailed step-by-step pedagogical explanations.

### 4. Live Question Studio (Review & Edit)
* Inspect each question, preview attached diagrams/figures (with zoom lightbox), and edit text or options inline.
* Change correct option via radio buttons or delete questions.

### 5. Interactive Practice Quiz Mode
* Built-in student practice mode with instant scoring, question jump palette, score percentage, and step-by-step solution reveals.

### 6. Supabase Database & Cloud Storage
* Persists quizzes and questions in **PostgreSQL**.
* Extracted images are automatically uploaded to Supabase Storage (`quiz-images` bucket).
* **Saved Quizzes Library** (`/library`) to review, retake, or export past quizzes.

### 7. Multi-Format Exporters
* **Moodle GIFT** (`.txt`)
* **Canvas Aiken** (`.txt`)
* **Excel / CSV** (`.csv`)
* **Raw JSON** (`.json`)

---

## 🛠️ Getting Started

### 1. Configure Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Fill in your API keys:
```env
# Gemini API Key (Can also be entered directly in the web UI)
GEMINI_API_KEY=your_gemini_api_key_here

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Optional: Session cookie for FU Overflow full-HD attachments
FUO_COOKIE="xf_user=...; xf_session=..."
```

### 2. Set Up Supabase Database
Run the provided SQL script in your Supabase SQL Editor:
* File: `supabase/schema.sql`
* This creates the `quizzes`, `questions`, and `quiz_attempts` tables, and configures the `quiz-images` storage bucket.

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 💻 FU Overflow Tools

### Option A: Direct Web UI (Recommended)
1. Open [http://localhost:3000](http://localhost:3000)
2. Click the **[ 🌐 DIRECT FU OVERFLOW URL ]** tab.
3. Paste the thread URL and click **[ RETRIEVE FROM FU OVERFLOW & SOLVE ]**.

### Option B: 1-Click Tampermonkey Userscript
1. Install Tampermonkey in Chrome/Edge/Firefox.
2. Create a new script and paste the code from [`scripts/fuo-extension.user.js`](file:///c:/Users/3Unde/Desktop/SE2107_FA26/qna-generator/scripts/fuo-extension.user.js).
3. Browse any thread on `fuoverflow.com` and click the floating **[ ⚡ EXPORT TO QNA GENERATOR ]** button in the top right.

### Option C: CLI Retriever Script
```powershell
node scripts/retrieve-fuoverflow.mjs --url "https://fuoverflow.com/threads/mad101-sp26-re.6332/"
```
Generates `fuoverflow_latest_ready.html` which you can drag and drop into the generator.
