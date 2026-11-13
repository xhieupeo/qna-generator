"use client";

import React, { useState, useEffect } from "react";
import { Question, ExtractedUnit } from "@/lib/types";
import { QuestionCard } from "@/components/studio/QuestionCard";
import { QuizPlayer } from "@/components/quiz/QuizPlayer";
import { exportToGift, exportToAiken, exportToCsv, exportToJson } from "@/lib/exporters";
import {
  UploadCloud,
  FileCode,
  Key,
  Settings,
  Sparkles,
  Database,
  Play,
  Download,
  Plus,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Globe,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";

/** Safely parse a fetch Response as JSON, returning a readable error object for plain-text/HTML errors (e.g. Vercel timeouts). */
async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.slice(0, 200).trim();
    if (
      res.status === 504 ||
      snippet.toLowerCase().includes("timeout") ||
      snippet.toLowerCase().includes("task timed out")
    ) {
      return {
        error: "Server timed out while processing. Please retry or reduce question count.",
      };
    }
    return {
      error: snippet || `Server returned HTTP ${res.status} with a non-JSON response.`,
    };
  }
}

const GEMINI_CASCADE = [
  "gemini-3.8-flash",
  "gemini-3.1-flash",
  "gemini-3.0-flash",
  "gemini-3.5-flash-lite",
];

const PRESET_MODELS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (Active Subscription / Recommended)" },
  { id: "gemini-3.1-flash", label: "Gemini 3.1 Flash" },
  { id: "gemini-3.0-flash", label: "Gemini 3.0 Flash" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
];

const OPENROUTER_MODELS = [
  { id: "openrouter/free", label: "OpenRouter Free Router (Auto-selects active free vision model / Recommended)" },
  { id: "nvidia/nemotron-3.5-super-vl:free", label: "NVIDIA Nemotron 3.5 Super VL (Free / 1M Context / OCR & Charts)" },
  { id: "meta-llama/llama-3.2-11b-vision-instruct:free", label: "Llama 3.2 11B Vision Instruct (Free)" },
  { id: "qwen/qwen2.5-vl-72b-instruct", label: "Qwen 2.5 VL 72B (Flagship Math OCR & Diagrams)" },
];

export default function HomePage() {
  // Provider: 'gemini' | 'openrouter'
  const [aiProvider, setAiProvider] = useState<"gemini" | "openrouter">("gemini");

  // Gemini State
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("gemini-3.8-flash");
  const [customModel, setCustomModel] = useState("");

  // OpenRouter State
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [openRouterModel, setOpenRouterModel] = useState("openrouter/free");
  const [customOrModel, setCustomOrModel] = useState("");
  const [isOpenRouterTesting, setIsOpenRouterTesting] = useState(false);
  const [openRouterTestMessage, setOpenRouterTestMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [language, setLanguage] = useState("English");
  const [showSettings, setShowSettings] = useState(false);

  // Auto-detected models from Google AI Studio
  const [isDetectingModels, setIsDetectingModels] = useState(false);
  const [detectedModels, setDetectedModels] = useState<Array<{ id: string; displayName: string }>>([]);
  const [keyTestMessage, setKeyTestMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Active resolved model name sent to API
  const activeModelName = modelName === "custom" ? (customModel.trim() || "gemini-3.8-flash") : modelName;
  const effectiveApiKey = aiProvider === "gemini" ? apiKey : openRouterKey;
  const effectiveModelName =
    aiProvider === "gemini"
      ? activeModelName
      : openRouterModel === "custom"
      ? customOrModel.trim() || "openrouter/free"
      : openRouterModel;

  // Input Mode: 'file' | 'url'
  const [inputMode, setInputMode] = useState<"url" | "file">("url");

  // FU Overflow URL State
  const [fuoUrl, setFuoUrl] = useState("");
  const [fuoCookie, setFuoCookie] = useState("");
  const [questionLimit, setQuestionLimit] = useState<string>("all");
  const [showCookieGuide, setShowCookieGuide] = useState(false);

  // File state
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Processing state
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressMsg, setProgressMsg] = useState("");
  const [progressPct, setProgressPct] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);

  // Result state
  const [quizTitle, setQuizTitle] = useState("Generated Quiz");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isPracticeMode, setIsPracticeMode] = useState(false);

  // Supabase save state
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Credential persistence preference (false = sessionStorage only, cleared on tab close)
  const [rememberCredentials, setRememberCredentials] = useState(false);

  const persistSecret = (storageKey: string, value: string, persist = rememberCredentials) => {
    const trimmed = value;
    if (persist) {
      if (trimmed) localStorage.setItem(storageKey, trimmed);
      else localStorage.removeItem(storageKey);
      sessionStorage.removeItem(storageKey);
    } else {
      if (trimmed) sessionStorage.setItem(storageKey, trimmed);
      else sessionStorage.removeItem(storageKey);
      localStorage.removeItem(storageKey);
    }
  };

  // Load API Keys, FUO Cookie & Models from browser storage
  useEffect(() => {
    const savedProvider = localStorage.getItem("ai_provider") as "gemini" | "openrouter" | null;
    if (savedProvider) setAiProvider(savedProvider);

    const persist = localStorage.getItem("remember_credentials") === "true";
    setRememberCredentials(persist);

    const readSecret = (key: string): string => {
      if (persist) {
        return localStorage.getItem(key) || "";
      }
      const sessionVal = sessionStorage.getItem(key);
      if (sessionVal) return sessionVal;
      // Migrate any legacy plaintext key out of localStorage into sessionStorage
      const legacyLocalVal = localStorage.getItem(key);
      if (legacyLocalVal) {
        sessionStorage.setItem(key, legacyLocalVal);
        localStorage.removeItem(key);
        return legacyLocalVal;
      }
      return "";
    };

    const savedKey = readSecret("gemini_api_key");
    if (savedKey) setApiKey(savedKey);

    const savedOrKey = readSecret("openrouter_api_key");
    if (savedOrKey) setOpenRouterKey(savedOrKey);

    const savedOrModel = localStorage.getItem("openrouter_model_name");
    if (savedOrModel) {
      if (
        savedOrModel.includes("gemini") ||
        savedOrModel.includes("1.5") ||
        savedOrModel.includes("2.0") ||
        savedOrModel.includes("flash")
      ) {
        setOpenRouterModel("openrouter/free");
        localStorage.setItem("openrouter_model_name", "openrouter/free");
      } else {
        setOpenRouterModel(savedOrModel);
      }
    } else {
      setOpenRouterModel("openrouter/free");
    }

    const savedFuoCookie = readSecret("fuo_cookie");
    if (savedFuoCookie) setFuoCookie(savedFuoCookie);

    const savedModel = localStorage.getItem("gemini_model_name");
    if (savedModel) {
      if (PRESET_MODELS.some((m) => m.id === savedModel)) {
        setModelName(savedModel);
      } else {
        setModelName("custom");
        setCustomModel(savedModel);
      }
    }
  }, []);

  const handleProviderChange = (provider: "gemini" | "openrouter") => {
    setAiProvider(provider);
    localStorage.setItem("ai_provider", provider);
  };

  const handleSaveApiKey = (key: string) => {
    setApiKey(key);
    persistSecret("gemini_api_key", key);
  };

  const handleSaveOpenRouterKey = (key: string) => {
    setOpenRouterKey(key);
    persistSecret("openrouter_api_key", key);
  };

  const handleOpenRouterModelChange = (model: string) => {
    setOpenRouterModel(model);
    localStorage.setItem("openrouter_model_name", model);
  };

  const handleSaveFuoCookie = (cookieVal: string) => {
    setFuoCookie(cookieVal);
    persistSecret("fuo_cookie", cookieVal);
  };

  const handleToggleRememberCredentials = (nextPersist: boolean) => {
    setRememberCredentials(nextPersist);
    if (nextPersist) {
      localStorage.setItem("remember_credentials", "true");
    } else {
      localStorage.removeItem("remember_credentials");
    }
    persistSecret("gemini_api_key", apiKey, nextPersist);
    persistSecret("openrouter_api_key", openRouterKey, nextPersist);
    persistSecret("fuo_cookie", fuoCookie, nextPersist);
  };

  const handleClearSavedCredentials = () => {
    setApiKey("");
    setOpenRouterKey("");
    setFuoCookie("");
    setRememberCredentials(false);
    setKeyTestMessage(null);
    setOpenRouterTestMessage(null);
    ["gemini_api_key", "openrouter_api_key", "fuo_cookie", "remember_credentials"].forEach((k) => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
    setWarningMsg("All API keys and session cookies have been cleared from this browser.");
  };

  const handleModelChange = (model: string) => {
    setModelName(model);
    if (model !== "custom") {
      localStorage.setItem("gemini_model_name", model);
    } else if (customModel) {
      localStorage.setItem("gemini_model_name", customModel);
    }
  };

  const handleCustomModelChange = (val: string) => {
    setCustomModel(val);
    localStorage.setItem("gemini_model_name", val);
  };

  const handleTestKeyAndDetectModels = async () => {
    if (!apiKey.trim()) {
      setKeyTestMessage({ type: "error", text: "Please enter your Gemini API key first." });
      return;
    }
    setIsDetectingModels(true);
    setKeyTestMessage(null);

    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });

      const data = await safeJson(res);
      if (!res.ok) {
        throw new Error(data.error || "Failed to verify API key with Google.");
      }

      if (data.models && data.models.length > 0) {
        setDetectedModels(data.models);
        const ids = data.models.map((m: any) => m.id);
        if (!ids.includes(modelName)) {
          const preferred = ids.find((id: string) => id === "gemini-3.8-flash") || ids[0];
          setModelName(preferred);
          localStorage.setItem("gemini_model_name", preferred);
        }
        setKeyTestMessage({
          type: "success",
          text: `Key Verified! Detected ${data.models.length} active Gemini models for your account.`,
        });
      } else {
        setKeyTestMessage({
          type: "error",
          text: "Key is valid, but no models with generateContent permission were found.",
        });
      }
    } catch (err: any) {
      setKeyTestMessage({
        type: "error",
        text: err?.message || "Failed to connect to Google API.",
      });
    } finally {
      setIsDetectingModels(false);
    }
  };

  const handleCustomOrModelChange = (val: string) => {
    setCustomOrModel(val);
    localStorage.setItem("openrouter_model_name", val);
  };

  const handleTestOpenRouterKey = async () => {
    if (!openRouterKey.trim()) {
      setOpenRouterTestMessage({
        type: "error",
        text: "Please enter your OpenRouter API key first.",
      });
      return;
    }
    setIsOpenRouterTesting(true);
    setOpenRouterTestMessage(null);

    try {
      const res = await fetch("/api/openrouter/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: openRouterKey }),
      });

      const data = await safeJson(res);
      if (!res.ok) {
        throw new Error(data.error || "Failed to verify OpenRouter key.");
      }

      setOpenRouterTestMessage({
        type: "success",
        text: `OpenRouter Key Verified! ${
          data.keyInfo?.isFreeTier ? "(Free Tier)" : "(Account Active)"
        } Free multimodal vision models are ready.`,
      });
    } catch (err: any) {
      setOpenRouterTestMessage({
        type: "error",
        text: err?.message || "Failed to connect to OpenRouter.",
      });
    } finally {
      setIsOpenRouterTesting(false);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const dropped = e.dataTransfer.files[0];
      const name = dropped.name.toLowerCase();
      if (name.endsWith(".html") || name.endsWith(".htm") || name.endsWith(".zip")) {
        setFile(dropped);
        setErrorMsg(null);
      } else {
        setErrorMsg("Please upload a valid .html, .htm, or .zip archive.");
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setErrorMsg(null);
    }
  };

  // Progressive unit-by-unit solver to prevent Vercel serverless timeouts & support live 429 cascade
  const solveUnitsProgressively = async (units: ExtractedUnit[], resolvedTitle: string) => {
    setQuizTitle(resolvedTitle);
    setQuestions([]);
    setProgressPct(5);

    const detectedIds = detectedModels.map((m) => m.id);
    const fallbackModels = aiProvider === "gemini" ? [...detectedIds, ...GEMINI_CASCADE] : [];
    let currentModel = effectiveModelName;
    const switchNotices: string[] = [];

    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      const qNum = i + 1;
      setProgressMsg(
        `Solving question ${qNum} of ${units.length} with ${
          aiProvider === "gemini" ? "Gemini" : "OpenRouter"
        } (${currentModel})...`
      );

      let solvedQuestion: Question | null = null;
      let unitErrorMsg = "";

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: resolvedTitle,
            unit,
            apiKey: effectiveApiKey,
            modelName: currentModel,
            provider: aiProvider,
            language,
            fallbackModels,
          }),
        });

        const data = await safeJson(res);
        if (!res.ok) {
          unitErrorMsg = data.error || `HTTP ${res.status}`;
        } else {
          if (data.usedModel && data.usedModel !== currentModel) {
            const note = `Rate limit/unavailable on ${currentModel} -> auto-switched to ${data.usedModel}`;
            if (!switchNotices.includes(note)) {
              switchNotices.push(note);
              setWarningMsg((prev) => (prev ? `${prev} | ${note}` : note));
            }
            currentModel = data.usedModel;
          }
          solvedQuestion = data.question || (data.questions && data.questions[0]) || null;
        }
      } catch (err: any) {
        unitErrorMsg = err?.message || "Network error";
      }

      if (!solvedQuestion) {
        const engineLabel = aiProvider === "gemini" ? "Gemini" : "OpenRouter";
        solvedQuestion = {
          questionNumber: qNum,
          transcribedText:
            unit.rawText ||
            "Transcription unavailable due to API rate limit or error. Click [ RETRY OCR / SOLVE ] to process this question individually.",
          questionText: unit.rawText || "Question extracted from image",
          imageBase64: unit.images[0]?.base64Data || null,
          imageMimeType: unit.images[0]?.mimeType || null,
          options: ["Option A", "Option B", "Option C", "Option D"],
          correctOptionIndex: 0,
          explanation: `Failed to auto-generate answer via ${engineLabel}: ${unitErrorMsg || "Unknown error"}. You can manually edit this question or click [ RETRY OCR / SOLVE ].`,
          difficulty: "Medium",
          topic: "Review Needed",
        };
      } else {
        solvedQuestion.questionNumber = qNum;
      }

      setQuestions((prev) => [...prev, solvedQuestion!]);
      setProgressPct(Math.round(((i + 1) / units.length) * 100));
    }
  };

  // Parse HTML or ZIP directly in the browser to avoid Vercel 4.5MB payload limit errors
  const parseExamFileClientSide = async (
    fileToParse: File
  ): Promise<{ title: string; units: ExtractedUnit[] } | null> => {
    try {
      let htmlContent = "";
      const assetFiles = new Map<string, { mimeType: string; base64Data: string }>();
      const lowerName = fileToParse.name.toLowerCase();

      if (lowerName.endsWith(".zip")) {
        const JSZip = (await import("jszip")).default;
        const arrayBuffer = await fileToParse.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);

        let htmlEntry: any = null;
        for (const [relPath, entry] of Object.entries(zip.files)) {
          if (!entry.dir && (relPath.endsWith(".html") || relPath.endsWith(".htm"))) {
            htmlEntry = entry;
            break;
          }
        }

        if (!htmlEntry) return null;
        htmlContent = await htmlEntry.async("text");

        for (const [relPath, entry] of Object.entries(zip.files)) {
          if (!entry.dir) {
            const lower = relPath.toLowerCase();
            let mimeType = "";
            if (lower.endsWith(".png")) mimeType = "image/png";
            else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mimeType = "image/jpeg";
            else if (lower.endsWith(".webp")) mimeType = "image/webp";
            else if (lower.endsWith(".gif")) mimeType = "image/gif";
            if (mimeType) {
              const base64Data = await entry.async("base64");
              assetFiles.set(relPath, { mimeType, base64Data });
            }
          }
        }
      } else if (lowerName.endsWith(".html") || lowerName.endsWith(".htm")) {
        htmlContent = await fileToParse.text();
      } else {
        return null;
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, "text/html");

      let title = "";
      const h1 = doc.querySelector("h1.p-title-value") || doc.querySelector("h1");
      if (h1) {
        const clone = h1.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(".label, .label-append").forEach((el) => el.remove());
        title = clone.textContent?.replace(/\s+/g, " ").trim() || "";
      }
      if (!title) {
        title = doc.title?.replace(/\s+/g, " ").trim() || fileToParse.name.replace(/\.[^/.]+$/, "");
      }

      const questionBlocks = doc.querySelectorAll(".question");
      if (questionBlocks.length === 0) return null;

      const units: ExtractedUnit[] = [];
      questionBlocks.forEach((block, idx) => {
        const qNum = idx + 1;
        const images: any[] = [];

        block.querySelectorAll("img").forEach((img, imgIdx) => {
          const src = img.getAttribute("src") || "";
          let mimeType = "image/jpeg";
          let base64Data = "";

          if (src.startsWith("data:")) {
            const match = src.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              mimeType = match[1];
              base64Data = match[2];
            }
          } else if (assetFiles.size > 0) {
            const cleanSrc = src.replace(/^\.\//, "").replace(/^\//, "").split("?")[0];
            for (const [filename, asset] of Array.from(assetFiles.entries())) {
              const cleanFile = filename.split("?")[0];
              if (cleanFile.endsWith(cleanSrc) || cleanSrc.endsWith(cleanFile)) {
                mimeType = asset.mimeType;
                base64Data = asset.base64Data;
                break;
              }
            }
          }

          if (base64Data) {
            images.push({
              id: `img_${qNum}_${imgIdx}`,
              mimeType,
              base64Data,
              src: src.slice(0, 100),
            });
          }
        });

        let communityAnswer: string | undefined = undefined;
        const commEl = block.querySelector(".community-answer");
        if (commEl) {
          const commText = commEl.textContent || "";
          const m = commText.match(/\[\s*COMMUNITY CONSENSUS ANSWER\s*\]:\s*([A-F]+)/i);
          if (m) communityAnswer = m[1].toUpperCase();
        }

        const rawText = block.textContent?.replace(/\s+/g, " ").trim() || "";
        units.push({
          id: `unit_${qNum}`,
          questionNumber: qNum,
          rawText,
          images,
          communityAnswer,
        });
      });

      return { title, units };
    } catch (e) {
      console.warn("Client-side parse error, falling back to server:", e);
      return null;
    }
  };

  // Generate from uploaded HTML or ZIP file (pre-parsed first, then solved progressively)
  const handleGenerateFromFile = async () => {
    if (!file) {
      setErrorMsg("Please select an HTML or ZIP file first.");
      return;
    }
    if (!effectiveApiKey) {
      setErrorMsg(
        `${aiProvider === "gemini" ? "Gemini" : "OpenRouter"} API key is required. Click 'API Key / Settings' to enter it.`
      );
      setShowSettings(true);
      return;
    }

    setIsGenerating(true);
    setProgressPct(2);
    setProgressMsg(`Parsing ${file.name} & extracting embedded questions/images...`);
    setErrorMsg(null);
    setWarningMsg(null);
    setSaveSuccessMsg(null);

    try {
      let units: ExtractedUnit[] = [];
      let title = "";

      // 1. Try instant client-side parsing first (bypasses Vercel 4.5MB payload limit completely)
      const clientParsed = await parseExamFileClientSide(file);
      if (clientParsed && clientParsed.units.length > 0) {
        units = clientParsed.units;
        title = clientParsed.title;
      } else {
        // 2. Server fallback if client parse didn't find question classes
        const formData = new FormData();
        formData.append("file", file);

        const parseRes = await fetch("/api/parse", {
          method: "POST",
          body: formData,
        });

        const parseData = await safeJson(parseRes);
        if (!parseRes.ok) {
          throw new Error(parseData.error || "Failed to parse uploaded file");
        }

        units = parseData.units || [];
        const fallbackTitle = file.name.replace(/\.[^/.]+$/, "");
        title =
          parseData.title && parseData.title !== "Generated Quiz" ? parseData.title : fallbackTitle;
      }

      if (questionLimit !== "all") {
        const num = parseInt(questionLimit, 10);
        if (!isNaN(num) && num > 0) {
          units = units.slice(0, num);
        }
      }

      await solveUnitsProgressively(units, title);
      setProgressMsg("");
      setProgressPct(0);
    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected error occurred during generation.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Generate directly from FU Overflow URL (No screenshots required!)
  const handleGenerateFromFuo = async () => {
    if (!fuoUrl.trim()) {
      setErrorMsg("Please enter a valid FU Overflow thread URL (e.g. https://fuoverflow.com/threads/...).");
      return;
    }
    if (!effectiveApiKey) {
      setErrorMsg(
        `${aiProvider === "gemini" ? "Gemini" : "OpenRouter"} API key is required. Click 'API Key / Settings' to enter it.`
      );
      setShowSettings(true);
      return;
    }

    setIsGenerating(true);
    setProgressPct(2);
    setProgressMsg("Connecting to FU Overflow & downloading full-resolution question attachments...");
    setErrorMsg(null);
    setWarningMsg(null);
    setSaveSuccessMsg(null);

    try {
      // 1. Fetch images and metadata from exam URL
      const fuoRes = await fetch("/api/fuoverflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: fuoUrl.trim(),
          cookie: fuoCookie.trim() || undefined,
          limit: questionLimit,
        }),
      });

      const fuoData = await safeJson(fuoRes);
      if (!fuoRes.ok) {
        throw new Error(fuoData.error || "Failed to retrieve images from FU Overflow");
      }

      if (fuoData.warning) {
        setWarningMsg(fuoData.warning);
      }

      let units: ExtractedUnit[] = fuoData.units || [];
      const title = fuoData.title || "FU Overflow Exam";

      // Apply limit if user selected
      if (questionLimit !== "all") {
        const num = parseInt(questionLimit, 10);
        if (!isNaN(num) && num > 0) {
          units = units.slice(0, num);
        }
      }

      // 2. Solve progressively unit-by-unit
      await solveUnitsProgressively(units, title);
      setProgressMsg("");
      setProgressPct(0);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to process FU Overflow exam.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUpdateQuestion = (index: number, updated: Question) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[index] = updated;
      return next;
    });
  };

  const handleDeleteQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRetrySingleQuestion = async (index: number) => {
    const q = questions[index];
    if (!effectiveApiKey) {
      setErrorMsg(
        `${aiProvider === "gemini" ? "Gemini" : "OpenRouter"} API key is required to retry OCR.`
      );
      setShowSettings(true);
      return;
    }

    const unit: ExtractedUnit = {
      id: `unit_retry_${index + 1}`,
      questionNumber: q.questionNumber || index + 1,
      rawText: q.questionText,
      images: q.imageBase64
        ? [
            {
              id: `img_${Date.now()}`,
              mimeType: q.imageMimeType || "image/jpeg",
              base64Data: q.imageBase64,
            },
          ]
        : [],
    };

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: quizTitle,
        unit,
        apiKey: effectiveApiKey,
        modelName: effectiveModelName,
        provider: aiProvider,
        language,
        fallbackModels: aiProvider === "gemini" ? [...detectedModels.map((m) => m.id), ...GEMINI_CASCADE] : [],
      }),
    });

    const data = await safeJson(res);
    if (!res.ok) {
      throw new Error(data.error || "Failed to re-transcribe question.");
    }

    const updatedQ = data.question || (data.questions && data.questions[0]);
    if (updatedQ) {
      if (
        updatedQ.topic === "Review Needed" &&
        updatedQ.explanation &&
        updatedQ.explanation.includes("Failed to auto-generate")
      ) {
        throw new Error(updatedQ.explanation);
      }
      updatedQ.questionNumber = q.questionNumber || index + 1;
      if (!updatedQ.imageBase64 && q.imageBase64) {
        updatedQ.imageBase64 = q.imageBase64;
        updatedQ.imageMimeType = q.imageMimeType;
      }
      handleUpdateQuestion(index, updatedQ);
    }
  };

  const handleAddQuestion = () => {
    const newQ: Question = {
      questionNumber: questions.length + 1,
      questionText: "New Question prompt",
      options: ["Option A", "Option B", "Option C", "Option D"],
      correctOptionIndex: 0,
      explanation: "Add explanation here.",
      difficulty: "Medium",
      topic: "General",
    };
    setQuestions((prev) => [...prev, newQ]);
  };

  const handleSaveToSupabase = async () => {
    if (questions.length === 0) return;
    setIsSaving(true);
    setSaveSuccessMsg(null);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/quizzes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: quizTitle,
          sourceFilename: inputMode === "url" ? fuoUrl : file?.name || "document.html",
          questions,
        }),
      });

      const data = await safeJson(res);
      if (!res.ok) {
        throw new Error(data.error || "Failed to save quiz to Supabase");
      }

      setSaveSuccessMsg(`Successfully saved "${quizTitle}" to Supabase! You can access it anytime in the Library.`);
    } catch (err: any) {
      setErrorMsg(`Supabase save error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleExport = (format: "gift" | "aiken" | "csv" | "json") => {
    if (questions.length === 0) return;

    let content = "";
    let mimeType = "text/plain";
    let extension = "txt";

    if (format === "gift") {
      content = exportToGift(questions);
      extension = "gift.txt";
    } else if (format === "aiken") {
      content = exportToAiken(questions);
      extension = "aiken.txt";
    } else if (format === "csv") {
      content = exportToCsv(questions);
      mimeType = "text/csv";
      extension = "csv";
    } else if (format === "json") {
      content = exportToJson({ title: quizTitle, questions });
      mimeType = "application/json";
      extension = "json";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${quizTitle.toLowerCase().replace(/\s+/g, "_")}.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isPracticeMode) {
    return (
      <QuizPlayer
        title={quizTitle}
        questions={questions}
        onExit={() => setIsPracticeMode(false)}
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Settings / API Key Top Bar */}
      <div className="border-2 border-slate-900 bg-white shadow-hard-sm">
        <div className="p-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <Key className="w-5 h-5 text-slate-900" />
            <div>
              <span className="font-mono text-xs uppercase text-slate-500 font-bold block">
                {aiProvider === "gemini" ? "Google Gemini Engine" : "OpenRouter Multi-Model Engine"}
              </span>
              <span className="text-sm font-semibold text-slate-900">
                {effectiveApiKey ? (
                  <span className="text-emerald-700 flex items-center gap-1 font-mono text-xs">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {aiProvider.toUpperCase()} ACTIVE ({effectiveApiKey.slice(0, 6)}...{effectiveApiKey.slice(-4)}) &bull; Model: {effectiveModelName}
                  </span>
                ) : (
                  <span className="text-amber-700 flex items-center gap-1 font-mono text-xs">
                    <AlertCircle className="w-3.5 h-3.5" /> {aiProvider.toUpperCase()} API KEY REQUIRED
                  </span>
                )}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-900 bg-slate-100 font-mono text-xs font-bold uppercase hover:bg-slate-200"
          >
            <Settings className="w-3.5 h-3.5" />
            [ {showSettings ? "HIDE SETTINGS" : "API KEY / SETTINGS"} ]
          </button>
        </div>

        {/* Expandable Settings Drawer */}
        {showSettings && (
          <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-4">
            {/* AI Provider Switcher */}
            <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-200">
              <span className="text-xs font-mono font-bold uppercase text-slate-600 mr-2">
                Active Provider:
              </span>
              <button
                type="button"
                onClick={() => handleProviderChange("gemini")}
                className={`px-3 py-1.5 font-mono text-xs font-bold uppercase border transition-colors ${
                  aiProvider === "gemini"
                    ? "bg-slate-900 text-white border-slate-900 shadow-hard-sm"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                }`}
              >
                [ GOOGLE GEMINI ]
              </button>
              <button
                type="button"
                onClick={() => handleProviderChange("openrouter")}
                className={`px-3 py-1.5 font-mono text-xs font-bold uppercase border transition-colors ${
                  aiProvider === "openrouter"
                    ? "bg-blue-600 text-white border-blue-600 shadow-hard-sm"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                }`}
              >
                [ OPENROUTER (FREE VISION MODELS) ]
              </button>
            </div>

            {aiProvider === "gemini" ? (
              /* Google Gemini Settings */
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-mono uppercase text-slate-700 font-bold">
                      Gemini API Key:
                    </label>
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-mono text-blue-600 hover:underline"
                    >
                      [ Get Free Key on Google AI Studio &rarr; ]
                    </a>
                  </div>
                  <input
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => handleSaveApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full border-2 border-slate-900 px-3 py-1.5 text-xs font-mono bg-white focus:outline-none"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                    <button
                      type="button"
                      onClick={handleTestKeyAndDetectModels}
                      disabled={isDetectingModels || !apiKey.trim()}
                      className="px-3 py-1 bg-slate-900 text-white font-mono text-[11px] font-bold uppercase hover:bg-blue-600 disabled:opacity-40 flex items-center gap-1.5 transition-colors"
                    >
                      <RefreshCw className={`w-3 h-3 ${isDetectingModels ? "animate-spin" : ""}`} />
                      <span>{isDetectingModels ? "VERIFYING KEY..." : "[ ⚡ TEST KEY & DETECT MODELS ]"}</span>
                    </button>

                    <span className="text-[11px] text-slate-500 font-mono">
                      {rememberCredentials
                        ? "Saved locally on this device only."
                        : "Session-only (cleared when tab closes)."}
                    </span>
                  </div>

                  {keyTestMessage && (
                    <div
                      className={`mt-2 p-2 font-mono text-xs border ${
                        keyTestMessage.type === "success"
                          ? "bg-emerald-50 border-emerald-400 text-emerald-900"
                          : "bg-red-50 border-red-400 text-red-900"
                      }`}
                    >
                      {keyTestMessage.text}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-mono uppercase text-slate-700 font-bold mb-1">
                    Gemini AI Model:
                  </label>
                  <select
                    value={modelName}
                    onChange={(e) => handleModelChange(e.target.value)}
                    className="w-full border-2 border-slate-900 px-3 py-1.5 text-xs font-mono bg-white focus:outline-none"
                  >
                    {detectedModels.length > 0 ? (
                      <>
                        <optgroup label="Verified Models For Your Key">
                          {detectedModels.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.displayName || m.id} ({m.id})
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Other Preset Models">
                          {PRESET_MODELS.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </optgroup>
                      </>
                    ) : (
                      PRESET_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))
                    )}
                    <option value="custom">Custom Model Identifier...</option>
                  </select>

                  {modelName === "custom" && (
                    <div className="mt-2">
                      <input
                        type="text"
                        value={customModel}
                        onChange={(e) => handleCustomModelChange(e.target.value)}
                        placeholder="e.g. gemini-3.8-flash"
                        className="w-full border-2 border-slate-900 px-3 py-1.5 text-xs font-mono bg-white focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">
                        Active model: {activeModelName}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* OpenRouter Settings */
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-mono uppercase text-slate-700 font-bold">
                      OpenRouter API Key:
                    </label>
                    <a
                      href="https://openrouter.ai/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-mono text-blue-600 hover:underline"
                    >
                      [ Get Free OpenRouter Key &rarr; ]
                    </a>
                  </div>
                  <input
                    type="password"
                    autoComplete="off"
                    value={openRouterKey}
                    onChange={(e) => handleSaveOpenRouterKey(e.target.value)}
                    placeholder="sk-or-v1-..."
                    className="w-full border-2 border-slate-900 px-3 py-1.5 text-xs font-mono bg-white focus:outline-none"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                    <button
                      type="button"
                      onClick={handleTestOpenRouterKey}
                      disabled={isOpenRouterTesting || !openRouterKey.trim()}
                      className="px-3 py-1 bg-blue-600 text-white font-mono text-[11px] font-bold uppercase hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1.5 transition-colors"
                    >
                      <RefreshCw className={`w-3 h-3 ${isOpenRouterTesting ? "animate-spin" : ""}`} />
                      <span>{isOpenRouterTesting ? "VERIFYING KEY..." : "[ ⚡ TEST OPENROUTER KEY ]"}</span>
                    </button>

                    <span className="text-[11px] text-slate-500 font-mono">
                      {rememberCredentials
                        ? "Saved locally on this device only."
                        : "Session-only (cleared when tab closes)."}
                    </span>
                  </div>

                  {openRouterTestMessage && (
                    <div
                      className={`mt-2 p-2 font-mono text-xs border ${
                        openRouterTestMessage.type === "success"
                          ? "bg-emerald-50 border-emerald-400 text-emerald-900"
                          : "bg-red-50 border-red-400 text-red-900"
                      }`}
                    >
                      {openRouterTestMessage.text}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-mono uppercase text-slate-700 font-bold mb-1">
                    OpenRouter Model:
                  </label>
                  <select
                    value={openRouterModel}
                    onChange={(e) => handleOpenRouterModelChange(e.target.value)}
                    className="w-full border-2 border-slate-900 px-3 py-1.5 text-xs font-mono bg-white focus:outline-none"
                  >
                    <optgroup label="Recommended Free Vision Models">
                      {OPENROUTER_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </optgroup>
                    <option value="custom">Custom OpenRouter Model...</option>
                  </select>

                  {openRouterModel === "custom" && (
                    <div className="mt-2">
                      <input
                        type="text"
                        value={customOrModel}
                        onChange={(e) => handleCustomOrModelChange(e.target.value)}
                        placeholder="e.g. qwen/qwen-2.5-vl-72b-instruct:free"
                        className="w-full border-2 border-slate-900 px-3 py-1.5 text-xs font-mono bg-white focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">
                        Active model: {effectiveModelName}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-end justify-between gap-4 pt-2 border-t border-slate-200">
              <div>
                <label className="block text-xs font-mono uppercase text-slate-700 font-bold mb-1">
                  Output Language:
                </label>
                <input
                  type="text"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder="English, Vietnamese, French, etc."
                  className="w-full md:w-64 border-2 border-slate-900 px-3 py-1.5 text-xs font-mono bg-white focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs font-mono text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberCredentials}
                    onChange={(e) => handleToggleRememberCredentials(e.target.checked)}
                    className="w-4 h-4 accent-slate-900 cursor-pointer"
                  />
                  <span>Remember keys &amp; cookie on this device</span>
                </label>

                <button
                  type="button"
                  onClick={handleClearSavedCredentials}
                  className="px-3 py-1.5 border border-red-600 bg-red-50 text-red-700 hover:bg-red-600 hover:text-white font-mono text-xs font-bold uppercase flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>[ Clear Saved Keys &amp; Cookie ]</span>
                </button>
              </div>
            </div>

            <p className="text-[11px] font-mono text-slate-500">
              Privacy: Your API keys and cookies never leave your own browser except in direct requests you trigger, are never stored in Supabase, and are never visible to other visitors.
            </p>
          </div>
        )}
      </div>

      {/* Hero / Ingestion Section */}
      <div className="border-2 border-slate-900 bg-white shadow-hard-md">
        {/* Tab Switcher - Strictly Zero Radius */}
        <div className="flex border-b-2 border-slate-900 bg-slate-100 font-mono text-xs font-bold uppercase">
          <button
            type="button"
            onClick={() => setInputMode("url")}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 border-r border-slate-900 transition-colors ${
              inputMode === "url"
                ? "bg-white text-slate-900 border-b-2 border-b-white -mb-[2px]"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Globe className="w-4 h-4 text-blue-600" />
            <span>DIRECT EXAM URL (FUOVERFLOW / FUEXAM / WEB)</span>
          </button>

          <button
            type="button"
            onClick={() => setInputMode("file")}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 border-r border-slate-900 transition-colors ${
              inputMode === "file"
                ? "bg-white text-slate-900 border-b-2 border-b-white -mb-[2px]"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <FileCode className="w-4 h-4 text-emerald-600" />
            <span>UPLOAD HTML / ZIP FILE</span>
          </button>
        </div>

        <div className="p-6">
          {inputMode === "url" ? (
            /* FU Overflow Direct Mode */
            <div className="space-y-4">
              <div>
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
                  Zero-Screenshot Retrieval Engine
                </span>
                <h2 className="text-xl font-bold text-slate-900 mt-0.5">
                  Paste Exam Thread or Webpage URL
                </h2>
                <p className="text-xs text-slate-600 mt-1 max-w-2xl">
                  Automatically detects exam attachments and question blocks from FU Overflow, FuExam.me, or open exam pages. AI solves questions and transcribes formulas into LaTeX.
                </p>
              </div>

              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate-700 font-bold mb-1">
                    Exam Thread / Webpage URL:
                  </label>
                  <input
                    type="url"
                    value={fuoUrl}
                    onChange={(e) => setFuoUrl(e.target.value)}
                    placeholder="https://fuexam.me/threads/dbi202-sp26-b5-fe.348/ or https://fuoverflow.com/threads/..."
                    className="w-full border-2 border-slate-900 px-3 py-2 text-xs font-mono bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-mono uppercase text-slate-700 font-bold">
                      FU Overflow Session Cookie (Required for Full-HD Images):
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowCookieGuide(!showCookieGuide)}
                      className="text-[11px] font-mono text-blue-600 hover:underline flex items-center gap-1"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                      [ {showCookieGuide ? "HIDE GUIDE" : "HOW TO GET COOKIE"} ]
                    </button>
                  </div>

                  <input
                    type="password"
                    autoComplete="off"
                    value={fuoCookie}
                    onChange={(e) => handleSaveFuoCookie(e.target.value)}
                    placeholder="xf_user=12345%2Cabcdef...; xf_session=xyz..."
                    className="w-full border border-slate-400 px-3 py-1.5 text-xs font-mono bg-slate-50 focus:bg-white focus:border-slate-900 focus:outline-none"
                  />
                </div>

                {/* Cookie Guide Accordion */}
                {showCookieGuide && (
                  <div className="bg-slate-100 border border-slate-300 p-3 text-xs font-mono text-slate-700 space-y-1.5">
                    <span className="font-bold uppercase text-slate-900 block">
                      📌 How to copy your FU Overflow Cookie in 10 seconds:
                    </span>
                    <ol className="list-decimal list-inside space-y-1 text-slate-600">
                      <li>Log in to <a href="https://fuoverflow.com" target="_blank" rel="noreferrer" className="text-blue-600 underline">fuoverflow.com</a> in your browser.</li>
                      <li>Press <kbd className="bg-white border px-1">F12</kbd> (or right click -&gt; Inspect).</li>
                      <li>Click the <strong>Application</strong> (or <strong>Storage</strong>) tab in DevTools.</li>
                      <li>In the left sidebar, expand <strong>Cookies</strong> -&gt; select <code>https://fuoverflow.com</code>.</li>
                      <li>Copy the values for <strong>xf_user</strong> and <strong>xf_session</strong> into: <code>xf_user=YOUR_VALUE; xf_session=YOUR_VALUE</code>.</li>
                    </ol>
                  </div>
                )}

                {/* Question Limit Option for testing large 50-question sets */}
                <div className="flex items-center gap-4 pt-1">
                  <label className="text-xs font-mono uppercase text-slate-700 font-bold">
                    Questions to Process:
                  </label>
                  <select
                    value={questionLimit}
                    onChange={(e) => setQuestionLimit(e.target.value)}
                    className="border border-slate-400 bg-white px-2 py-1 text-xs font-mono focus:border-slate-900 focus:outline-none"
                  >
                    <option value="all">All Questions (Full Exam)</option>
                    <option value="10">First 10 Questions (Fast Test)</option>
                    <option value="20">First 20 Questions</option>
                    <option value="30">First 30 Questions</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleGenerateFromFuo}
                  disabled={!fuoUrl.trim() || isGenerating}
                  className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white font-mono text-xs font-bold uppercase border-2 border-slate-900 hover:bg-blue-600 disabled:opacity-40 disabled:pointer-events-none shadow-hard-sm"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>RETRIEVING & GENERATING...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>RETRIEVE FROM FU OVERFLOW & SOLVE</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* File Upload Mode */
            <div className="space-y-4">
              <div>
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
                  Document Ingestion
                </span>
                <h2 className="text-xl font-bold text-slate-900 mt-0.5">
                  Upload HTML File or ZIP Archive
                </h2>
                <p className="text-xs text-slate-600 mt-1 max-w-2xl">
                  Upload an HTML file (with base64 images) or a <code>.zip</code> bundle containing an HTML file with an image assets folder.
                </p>
              </div>

              {/* Dropzone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
                className={`border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
                  isDragging
                    ? "border-slate-900 bg-blue-50"
                    : file
                    ? "border-emerald-600 bg-emerald-50"
                    : "border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-slate-900"
                }`}
                onClick={() => document.getElementById("file-input")?.click()}
              >
                <input
                  id="file-input"
                  type="file"
                  accept=".html,.htm,.zip"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div className="flex flex-col items-center justify-center gap-2">
                  {file ? (
                    <>
                      <FileCode className="w-10 h-10 text-emerald-700" />
                      <span className="font-mono text-sm font-bold text-slate-900">
                        {file.name} ({(file.size / 1024).toFixed(1)} KB)
                      </span>
                      <span className="text-xs font-mono text-emerald-700 uppercase font-semibold">
                        [ FILE READY FOR PROCESSING ]
                      </span>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="w-10 h-10 text-slate-500" />
                      <span className="font-mono text-sm font-bold text-slate-900">
                        DRAG & DROP HTML / ZIP FILE HERE, OR CLICK TO BROWSE
                      </span>
                      <span className="text-xs font-mono text-slate-500 uppercase">
                        Supports .html, .htm, or .zip (HTML + image folder)
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-4">
                <div className="text-xs font-mono text-slate-500">
                  {file && `Selected: ${file.name}`}
                </div>

                <button
                  type="button"
                  onClick={handleGenerateFromFile}
                  disabled={!file || isGenerating}
                  className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white font-mono text-xs font-bold uppercase border-2 border-slate-900 hover:bg-blue-600 disabled:opacity-40 disabled:pointer-events-none shadow-hard-sm"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>PROCESSING MULTIMODAL QNA...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>GENERATE MULTIPLE CHOICE QUESTIONS</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Progress Banner */}
          {isGenerating && (
            <div className="mt-6 p-4 bg-slate-100 border border-slate-900 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono font-bold">
                <span>PIPELINE RUNNING</span>
                <span>{progressPct > 0 ? `${progressPct}% COMPLETE` : "WORKING..."}</span>
              </div>
              <div className="w-full h-2 bg-slate-200 border border-slate-400">
                <div
                  className="h-full bg-slate-900 transition-all duration-300"
                  style={{ width: `${Math.max(progressPct, 10)}%` }}
                ></div>
              </div>
              <p className="text-xs font-mono text-slate-700">{progressMsg}</p>
            </div>
          )}

          {/* Warning Banner */}
          {warningMsg && (
            <div className="mt-6 p-4 bg-amber-50 border-2 border-amber-600 text-amber-950 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-mono text-xs font-bold uppercase block">Session Warning:</span>
                <p className="text-xs">{warningMsg}</p>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMsg && (
            <div className="mt-6 p-4 bg-red-50 border-2 border-red-600 text-red-950 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-mono text-xs font-bold uppercase block">Error:</span>
                <p className="text-xs">{errorMsg}</p>
              </div>
            </div>
          )}

          {/* Save Success Banner */}
          {saveSuccessMsg && (
            <div className="mt-6 p-4 bg-emerald-50 border-2 border-emerald-600 text-emerald-950 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-mono text-xs font-bold uppercase block">Success:</span>
                <p className="text-xs">{saveSuccessMsg}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Step 2: Question Review Studio */}
      {questions.length > 0 && (
        <div className="space-y-6">
          {/* Studio Action Toolbar */}
          <div className="border-2 border-slate-900 bg-white p-4 shadow-hard-sm flex flex-wrap items-center justify-between gap-4 sticky top-16 z-40">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono bg-slate-900 text-white px-2 py-0.5 font-bold">
                  {questions.length} QUESTIONS
                </span>
                <input
                  type="text"
                  value={quizTitle}
                  onChange={(e) => setQuizTitle(e.target.value)}
                  className="font-bold text-base text-slate-900 border-b border-dashed border-slate-400 focus:border-slate-900 focus:outline-none bg-transparent"
                  title="Click to rename quiz"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsPracticeMode(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white font-mono text-xs font-bold uppercase border border-slate-900 hover:bg-emerald-700 shadow-hard-sm"
              >
                <Play className="w-3.5 h-3.5" /> [ PRACTICE QUIZ ]
              </button>

              <button
                type="button"
                onClick={handleSaveToSupabase}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white font-mono text-xs font-bold uppercase border border-slate-900 hover:bg-blue-700 disabled:opacity-50 shadow-hard-sm"
              >
                <Database className="w-3.5 h-3.5" />
                {isSaving ? "[ SAVING... ]" : "[ SAVE TO SUPABASE ]"}
              </button>

              <div className="relative group">
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 text-white font-mono text-xs font-bold uppercase hover:bg-slate-800"
                >
                  <Download className="w-3.5 h-3.5" /> [ EXPORT ]
                </button>
                <div className="hidden group-hover:flex flex-col absolute right-0 mt-0 w-44 bg-white border-2 border-slate-900 shadow-hard-sm z-30">
                  <button
                    type="button"
                    onClick={() => handleExport("gift")}
                    className="text-left px-3 py-2 text-xs font-mono hover:bg-slate-100 border-b border-slate-200"
                  >
                    Moodle GIFT (.txt)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport("aiken")}
                    className="text-left px-3 py-2 text-xs font-mono hover:bg-slate-100 border-b border-slate-200"
                  >
                    Canvas Aiken (.txt)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport("csv")}
                    className="text-left px-3 py-2 text-xs font-mono hover:bg-slate-100 border-b border-slate-200"
                  >
                    Excel / CSV (.csv)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport("json")}
                    className="text-left px-3 py-2 text-xs font-mono hover:bg-slate-100"
                  >
                    Raw JSON (.json)
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={handleAddQuestion}
                className="flex items-center gap-1 px-3 py-2 bg-white text-slate-800 font-mono text-xs font-bold uppercase border border-slate-400 hover:bg-slate-100"
              >
                <Plus className="w-3.5 h-3.5" /> [ ADD QUESTION ]
              </button>
            </div>
          </div>

          {/* Question Cards List */}
          <div>
            {questions.map((q, idx) => (
              <QuestionCard
                key={idx}
                index={idx}
                question={q}
                onUpdate={(updated: Question) => handleUpdateQuestion(idx, updated)}
                onDelete={() => handleDeleteQuestion(idx)}
                onRetry={() => handleRetrySingleQuestion(idx)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
