import { ExtractedUnit, Question } from "./types";
import { extractJsonFromResponse } from "./gemini";

export interface GenerateOpenRouterOptions {
  apiKey: string;
  modelName?: string;
  language?: string;
  temperature?: number;
}

export async function generateQuestionFromUnitOpenRouter(
  unit: ExtractedUnit,
  options: GenerateOpenRouterOptions
): Promise<Question> {
  const apiKey = (options.apiKey || process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("Missing OpenRouter API Key. Please provide it in settings or .env file.");
  }

  let modelName = options.modelName || "openrouter/free";
  // Auto-migrate if someone passes deprecated free Gemini model names on OpenRouter
  if (
    modelName.includes("gemini-flash-1.5:free") ||
    modelName.includes("gemini-2.0-flash-exp:free") ||
    modelName.includes("gemini-flash-1.5") ||
    modelName.includes("gemini-2.0")
  ) {
    console.warn(`[OpenRouter Migration] Replacing deprecated model '${modelName}' with 'openrouter/free'`);
    modelName = "openrouter/free";
  }

  const userContent: any[] = [];

  // 1. Attach Images if present (OpenRouter uses standard OpenAI image_url format)
  let primaryImage = null;
  if (unit.images && unit.images.length > 0) {
    for (const img of unit.images) {
      if (!img.base64Data) continue;
      if (!primaryImage) primaryImage = img;
      const mime = img.mimeType || "image/jpeg";
      const base64Url = img.base64Data.startsWith("data:")
        ? img.base64Data
        : `data:${mime};base64,${img.base64Data}`;
      userContent.push({
        type: "image_url",
        image_url: {
          url: base64Url,
        },
      });
    }
  }

  // 2. Prompt instructions
  const communityContext = unit.communityAnswer
    ? `\nNote: Student community discussion on FU Overflow suggests answer: "${unit.communityAnswer}". Cross-examine this answer critically; verify whether it is genuinely correct or a common misconception/trap.\n`
    : "";

  const promptInstruction = `
You are an expert exam designer, OCR specialist, and subject-matter professor.
You are given content extracted from an HTML document or exam thread (text and/or diagrams/images).
${communityContext}
Raw Extracted Context:
"""
${unit.rawText || "No text provided; analyze the attached image/diagram directly."}
"""

Instructions (Think-First Inverted Strategy):
1. **Verbatim OCR Transcription**:
   - Transcribe ALL text visible in the image faithfully into "transcribedText".
   - If there are mathematical formulas, matrices, sets, or equations, convert them to standard LaTeX notation (enclosed in $...$ for inline or $$...$$ for block).
   - If there is program code, format it inside fenced markdown code blocks with the language identifier (e.g. \`\`\`java).
   - Preserve Vietnamese or English accents exactly as shown.
2. **Question Solving**:
   - If the input does NOT provide answers or choices, SOLVE the problem yourself with absolute mathematical and logical rigor.
   - Formulate exactly 4 plausible, distinct multiple choice options:
     - 1 option MUST be the strictly correct answer.
     - 3 options MUST be realistic distractors (e.g. based on common student misconceptions, calculation slips, or inverted axes).
3. **JSON Output Format**:
   You MUST return ONLY a valid JSON object matching this structure:
   {
     "transcribedText": "Full verbatim OCR transcription with LaTeX equations and code blocks",
     "questionText": "The complete question prompt or problem statement",
     "options": ["Option A", "Option B", "Option C", "Option D"],
     "correctOptionIndex": 0,
     "explanation": "Detailed step-by-step pedagogical explanation of the correct solution",
     "topic": "The primary subject or topic of this question",
     "difficulty": "Easy, Medium, or Hard"
   }
   Language: ${options.language || "English"}.
`;

  userContent.push({
    type: "text",
    text: promptInstruction,
  });

  async function postChat(targetModel: string, withFormat: boolean) {
    const payload: any = {
      model: targetModel,
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
      temperature: options.temperature ?? 0.15,
      max_tokens: 2500,
      frequency_penalty: 0.3,
    };
    if (withFormat) {
      payload.response_format = { type: "json_object" };
    }
    return await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "QnA Generator",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  // Attempt 1: Using selected model with response_format json_object
  let res = await postChat(modelName, true);

  // If initial attempt fails, handle 404 (model removed/unavailable) or format issues
  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    const errorMsg = errorJson?.error?.message || "";

    // If model is discontinued or 404, automatically fall back to openrouter/free
    if (
      (res.status === 404 ||
        errorMsg.includes("no provider") ||
        errorMsg.includes("not available") ||
        errorMsg.includes("not found")) &&
      modelName !== "openrouter/free"
    ) {
      console.warn(
        `[OpenRouter 404 Fallback] Model '${modelName}' is unavailable. Auto-routing to 'openrouter/free'...`
      );
      modelName = "openrouter/free";
      res = await postChat("openrouter/free", true);
    } else if (errorMsg.includes("response_format") || errorMsg.includes("json_object")) {
      // Model doesn't support json_object schema, retry without it
      res = await postChat(modelName, false);
    } else {
      throw new Error(`OpenRouter API error (${res.status}): ${errorMsg || res.statusText}`);
    }
  }

  // If second attempt failed due to response_format (common on free models), retry plain
  if (!res.ok) {
    const errorJson2 = await res.json().catch(() => ({}));
    const errorMsg2 = errorJson2?.error?.message || "";
    if (errorMsg2.includes("response_format") || errorMsg2.includes("json_object")) {
      res = await postChat(modelName, false);
    } else {
      throw new Error(`OpenRouter API error (${res.status}): ${errorMsg2 || res.statusText}`);
    }
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(
      `OpenRouter API error (${res.status}): ${errData?.error?.message || res.statusText}`
    );
  }

  const data = await res.json();
  const rawText = data?.choices?.[0]?.message?.content || "";
  const parsed = extractJsonFromResponse(rawText);

  return {
    questionNumber: unit.questionNumber || 1,
    transcribedText: parsed.transcribedText || parsed.questionText || unit.rawText || "",
    questionText: parsed.questionText || unit.rawText || "Question extracted from image",
    imageBase64: primaryImage ? primaryImage.base64Data : null,
    imageMimeType: primaryImage ? primaryImage.mimeType : null,
    options: Array.isArray(parsed.options) && parsed.options.length > 0
      ? parsed.options
      : ["Option A", "Option B", "Option C", "Option D"],
    correctOptionIndex:
      typeof parsed.correctOptionIndex === "number" && parsed.correctOptionIndex >= 0 && parsed.correctOptionIndex < 4
        ? parsed.correctOptionIndex
        : 0,
    explanation: parsed.explanation || "",
    topic: parsed.topic || "General",
    difficulty: (parsed.difficulty as any) || "Medium",
  };
}

