import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { parseHtmlContent } from "@/lib/html-parser";
import { generateQuestionFromUnit } from "@/lib/gemini";
import { generateQuestionFromUnitOpenRouter } from "@/lib/openrouter";
import { Question, ExtractedUnit } from "@/lib/types";

export const maxDuration = 300; // Allow up to 5 mins for 50-question multimodal processing

async function generateWithRetry(
  unit: ExtractedUnit,
  options: any,
  provider: "gemini" | "openrouter" = "gemini",
  maxRetries = 2
): Promise<Question> {
  const isOR =
    provider === "openrouter" || (options.apiKey && options.apiKey.startsWith("sk-or-"));
  const solver = isOR ? generateQuestionFromUnitOpenRouter : generateQuestionFromUnit;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await solver(unit, options);
    } catch (err: any) {
      const isRateLimit =
        err?.status === 429 ||
        err?.message?.includes("429") ||
        err?.message?.includes("quota") ||
        err?.message?.includes("RESOURCE_EXHAUSTED") ||
        err?.message?.includes("exhausted");

      if (isRateLimit && attempt < maxRetries) {
        const waitTime = (attempt + 1) * 4000;
        console.warn(
          `[Rate Limit 429] Waiting ${waitTime / 1000}s before retrying unit ${unit.questionNumber}...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    let title = "Generated Quiz";
    let units: ExtractedUnit[] = [];
    let apiKey = process.env.GEMINI_API_KEY || "";
    let modelName = "";
    let language = "English";
    let provider: "gemini" | "openrouter" = "gemini";
    let isSingleUnit = false;

    if (contentType.includes("application/json")) {
      const body = await req.json();
      if (body.unit) {
        units = [body.unit];
        isSingleUnit = true;
      } else {
        units = body.units || [];
      }
      title = body.title || "FU Overflow Quiz";
      apiKey = body.apiKey || apiKey;
      language = body.language || language;
      provider =
        body.provider ||
        (apiKey.trim().startsWith("sk-or-") ? "openrouter" : "gemini");
      modelName =
        body.modelName ||
        (provider === "openrouter" ? "openrouter/free" : "gemini-2.0-flash");
    } else {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      apiKey = (formData.get("apiKey") as string) || apiKey;
      language = (formData.get("language") as string) || language;
      provider =
        ((formData.get("provider") as string) as any) ||
        (apiKey.trim().startsWith("sk-or-") ? "openrouter" : "gemini");
      modelName =
        (formData.get("modelName") as string) ||
        (provider === "openrouter" ? "openrouter/free" : "gemini-2.0-flash");

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      let htmlContent = "";
      const assetFiles = new Map<string, { mimeType: string; base64Data: string }>();
      const fileName = file.name.toLowerCase();

      if (fileName.endsWith(".zip")) {
        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);

        let htmlFileEntry: JSZip.JSZipObject | null = null;
        for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
          if (!zipEntry.dir && (relativePath.endsWith(".html") || relativePath.endsWith(".htm"))) {
            htmlFileEntry = zipEntry;
            break;
          }
        }

        if (!htmlFileEntry) {
          return NextResponse.json(
            { error: "No .html or .htm file found inside the uploaded ZIP archive." },
            { status: 400 }
          );
        }

        htmlContent = await htmlFileEntry.async("text");

        for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
          if (!zipEntry.dir) {
            const lower = relativePath.toLowerCase();
            let mimeType = "";
            if (lower.endsWith(".png")) mimeType = "image/png";
            else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mimeType = "image/jpeg";
            else if (lower.endsWith(".webp")) mimeType = "image/webp";
            else if (lower.endsWith(".gif")) mimeType = "image/gif";
            else if (lower.endsWith(".svg")) mimeType = "image/svg+xml";

            if (mimeType) {
              const base64Data = await zipEntry.async("base64");
              assetFiles.set(relativePath, { mimeType, base64Data });
            }
          }
        }
      } else {
        htmlContent = await file.text();
      }

      const parsed = parseHtmlContent(htmlContent, { assetFiles });
      title = parsed.title;
      units = parsed.units;
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: "Gemini API key is required. Please enter it in the settings bar or set GEMINI_API_KEY." },
        { status: 400 }
      );
    }

    if (!units || units.length === 0) {
      return NextResponse.json(
        { error: "Could not find any readable question text or images." },
        { status: 400 }
      );
    }

    // Process units through Gemini with rate-limit pacing & retry
    const questions: Question[] = [];

    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      try {
        const question = await generateWithRetry(
          unit,
          {
            apiKey,
            modelName,
            language,
          },
          provider
        );
        question.questionNumber = i + 1;
        questions.push(question);
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
          questionNumber: i + 1,
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

      // Small 1.2s delay between questions if processing more than 5 questions
      if (units.length > 5 && i < units.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }

    return NextResponse.json({
      title,
      totalQuestions: questions.length,
      question: questions[0] || null,
      questions,
    });
  } catch (error: any) {
    console.error("Generate API error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error occurred while processing questions." },
      { status: 500 }
    );
  }
}
