import { NextRequest, NextResponse } from "next/server";
import { parseUploadedExamFile } from "@/lib/file-ingest";
import { generateQuestionFromUnit } from "@/lib/gemini";
import { generateQuestionFromUnitOpenRouter } from "@/lib/openrouter";
import { isFilenameStubWithoutImage } from "@/lib/ocr-guards";
import { Question, ExtractedUnit } from "@/lib/types";

export const maxDuration = 60; // Safe maximum for Vercel Serverless Functions

const GEMINI_CASCADE = [
  "gemini-3.8-flash",
  "gemini-3.1-flash",
  "gemini-3.0-flash",
  "gemini-3.5-flash-lite",
];

const OPENROUTER_CASCADE = [
  "openrouter/free",
  "nvidia/nemotron-3.5-super-vl:free",
  "meta-llama/llama-3.2-11b-vision-instruct:free",
];

function isRateLimitError(err: any): boolean {
  const msg = String(err?.message || "").toLowerCase();
  return (
    err?.status === 429 ||
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("exhausted")
  );
}

function isModelUnavailableError(err: any): boolean {
  const msg = String(err?.message || "").toLowerCase();
  return (
    err?.status === 404 ||
    msg.includes("404") ||
    msg.includes("not found") ||
    msg.includes("not supported") ||
    msg.includes("no provider") ||
    msg.includes("not available") ||
    msg.includes("deprecated")
  );
}

function isDegenerativeOutputError(err: any): boolean {
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("degenerative") ||
    msg.includes("low-entropy") ||
    msg.includes("malformed or truncated json")
  );
}

function buildModelCascade(
  primaryModel: string,
  provider: "gemini" | "openrouter",
  extraFallbacks: string[] = []
): string[] {
  const defaults = provider === "openrouter" ? OPENROUTER_CASCADE : GEMINI_CASCADE;
  const normalizedPrimary =
    provider === "gemini" && /^gemini-(1\.0|1\.5|2\.0|2\.5)-/i.test(primaryModel)
      ? "gemini-3.8-flash"
      : primaryModel;

  const seen = new Set<string>();
  const cascade: string[] = [];
  for (const m of [normalizedPrimary, ...extraFallbacks, ...defaults]) {
    const trimmed = (m || "").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    // Skip deprecated Gemini models if passed via detected/cached list
    if (provider === "gemini" && /^gemini-(1\.0|1\.5|2\.0|2\.5)-/i.test(trimmed)) continue;
    seen.add(trimmed);
    cascade.push(trimmed);
  }
  return cascade;
}

/**
 * Generates a single MCQ with automatic model cascade when rate-limited (429) or
 * when a model is unavailable (404).
 */
async function generateWithCascade(
  unit: ExtractedUnit,
  options: { apiKey: string; modelName: string; language: string; fallbackModels?: string[] },
  provider: "gemini" | "openrouter" = "gemini"
): Promise<{ question: Question; usedModel: string; switchedFromModel?: string }> {
  const isOR =
    provider === "openrouter" || (options.apiKey && options.apiKey.startsWith("sk-or-"));
  const resolvedProvider: "gemini" | "openrouter" = isOR ? "openrouter" : "gemini";
  const solver = isOR ? generateQuestionFromUnitOpenRouter : generateQuestionFromUnit;

  const cascade = buildModelCascade(
    options.modelName,
    resolvedProvider,
    options.fallbackModels || []
  );

  let lastErr: any = null;
  const initialModel = cascade[0];
  let temperatureOverride: number | undefined;

  for (let i = 0; i < cascade.length; i++) {
    const candidateModel = cascade[i];
    try {
      const question = await solver(unit, {
        apiKey: options.apiKey,
        modelName: candidateModel,
        language: options.language,
        temperature: temperatureOverride,
      });
      return {
        question,
        usedModel: candidateModel,
        switchedFromModel: candidateModel !== initialModel ? initialModel : undefined,
      };
    } catch (err: any) {
      lastErr = err;
      const isLoop = isDegenerativeOutputError(err);
      if (isLoop) {
        temperatureOverride = 0.35;
      }
      const canCascade = isRateLimitError(err) || isModelUnavailableError(err) || isLoop;

      if (canCascade && i < cascade.length - 1) {
        console.warn(
          `[Auto-Cascade] Model '${candidateModel}' failed (${err?.message}). Switching to '${cascade[i + 1]}'...`
        );
        await new Promise((resolve) => setTimeout(resolve, 400));
        continue;
      }

      // If no more models in cascade and it was a rate limit or repetition loop, do one brief final retry
      if ((isRateLimitError(err) || isLoop) && i === cascade.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, isLoop ? 300 : 2000));
        try {
          const retryQuestion = await solver(unit, {
            apiKey: options.apiKey,
            modelName: candidateModel,
            language: options.language,
            temperature: isLoop ? 0.35 : temperatureOverride,
          });
          return {
            question: retryQuestion,
            usedModel: candidateModel,
            switchedFromModel: candidateModel !== initialModel ? initialModel : undefined,
          };
        } catch (retryErr: any) {
          throw retryErr;
        }
      }

      throw err;
    }
  }

  throw lastErr || new Error("All models in cascade failed.");
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    let title = "Generated Quiz";
    let units: ExtractedUnit[] = [];
    let apiKey = "";
    let modelName = "";
    let language = "English";
    let provider: "gemini" | "openrouter" = "gemini";
    let fallbackModels: string[] = [];
    let isSingleUnit = false;

    if (contentType.includes("application/json")) {
      const body = await req.json();
      if (body.unit) {
        units = [body.unit];
        isSingleUnit = true;
      } else {
        units = body.units || [];
      }
      title = body.title || "Generated Quiz";
      provider =
        body.provider ||
        ((body.apiKey || "").trim().startsWith("sk-or-") ? "openrouter" : "gemini");
      apiKey =
        body.apiKey ||
        (provider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.GEMINI_API_KEY) ||
        "";
      language = body.language || language;
      modelName =
        body.modelName ||
        (provider === "openrouter" ? "openrouter/free" : "gemini-3.8-flash");
      fallbackModels = Array.isArray(body.fallbackModels) ? body.fallbackModels : [];
    } else {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const formKey = (formData.get("apiKey") as string) || "";
      provider =
        ((formData.get("provider") as string) as "gemini" | "openrouter") ||
        (formKey.trim().startsWith("sk-or-") ? "openrouter" : "gemini");
      apiKey =
        formKey ||
        (provider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.GEMINI_API_KEY) ||
        "";
      language = (formData.get("language") as string) || language;
      modelName =
        (formData.get("modelName") as string) ||
        (provider === "openrouter" ? "openrouter/free" : "gemini-3.8-flash");

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      const parsed = await parseUploadedExamFile(file, { resolveRemoteImages: true });
      title = parsed.title;
      units = parsed.units;
    }

    if (!apiKey) {
      return NextResponse.json(
        {
          error: `${
            provider === "openrouter" ? "OpenRouter" : "Gemini"
          } API key is required. Please enter it in the settings bar.`,
        },
        { status: 400 }
      );
    }

    if (!units || units.length === 0) {
      return NextResponse.json(
        { error: "Could not find any readable question text or images." },
        { status: 400 }
      );
    }

    const questions: Question[] = [];
    let currentModel = modelName;
    let lastSwitchedFrom: string | undefined;

    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      try {
        if (isFilenameStubWithoutImage(unit)) {
          throw new Error(
            unit.imageError ||
              "Question image could not be downloaded or attached. Cannot transcribe without visual content."
          );
        }

        const result = await generateWithCascade(
          unit,
          {
            apiKey,
            modelName: currentModel,
            language,
            fallbackModels,
          },
          provider
        );
        if (result.switchedFromModel) {
          lastSwitchedFrom = result.switchedFromModel;
        }
        currentModel = result.usedModel;
        result.question.questionNumber = unit.questionNumber || i + 1;
        questions.push(result.question);
      } catch (genErr: any) {
        console.error(`Error generating MCQ for unit ${i + 1}:`, genErr);
        if (isSingleUnit) {
          return NextResponse.json(
            {
              error: `OCR / Solve failed: ${genErr?.message || "Unknown error"}. Check your model selection or API key.`,
            },
            { status: 400 }
          );
        }
        const engineLabel =
          provider === "openrouter" || apiKey.trim().startsWith("sk-or-")
            ? "OpenRouter"
            : "Gemini";
        questions.push({
          questionNumber: unit.questionNumber || i + 1,
          transcribedText:
            unit.rawText ||
            "Transcription unavailable due to API rate limit or error. Click [ RETRY OCR / SOLVE ] to process this question individually.",
          questionText: unit.rawText || "Question extracted from image",
          imageBase64: unit.images[0]?.base64Data || null,
          imageMimeType: unit.images[0]?.mimeType || null,
          options: ["Option A", "Option B", "Option C", "Option D"],
          correctOptionIndex: 0,
          explanation: `Failed to auto-generate answer via ${engineLabel}: ${genErr?.message || "Unknown error"}. You can manually edit this question or click [ RETRY OCR / SOLVE ].`,
          difficulty: "Medium",
          topic: "Review Needed",
        });
      }

      if (units.length > 5 && i < units.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }

    return NextResponse.json({
      title,
      totalQuestions: questions.length,
      question: questions[0] || null,
      questions,
      usedModel: currentModel,
      switchedFromModel: lastSwitchedFrom,
    });
  } catch (error: any) {
    console.error("Generate API error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error occurred while processing questions." },
      { status: 500 }
    );
  }
}
