import { ExtractedUnit, Question } from "./types";
import {
  extractJsonFromResponse,
  areOptionsDummy,
  synthesizeOptionsFromExplanation,
} from "./gemini";

export interface GenerateOpenRouterOptions {
  apiKey: string;
  modelName?: string;
  language?: string;
  temperature?: number;
  title?: string;
}

export async function generateQuestionFromUnitOpenRouter(
  unit: ExtractedUnit,
  options: GenerateOpenRouterOptions
): Promise<Question> {
  const allowEnvFallback = process.env.ALLOW_SERVER_KEY_FALLBACK === "true";
  const apiKey = (
    options.apiKey ||
    (allowEnvFallback ? process.env.OPENROUTER_API_KEY : "") ||
    ""
  ).trim();
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

  // 2. Prompt instructions with course domain context
  const examTitle = options.title || "";
  const subjectMatch = examTitle.match(/\b([A-Za-z]{2,4}\d{2,4}[A-Za-z]?)\b/);
  const subjectCode = subjectMatch ? subjectMatch[1].toUpperCase() : "";

  const subjectDirective = subjectCode
    ? `\nAcademic Subject / Course Context: ${subjectCode} (${examTitle}).
CRITICAL COURSE INTEGRITY RULES:
- All questions, OCR transcriptions, options, and explanations MUST strictly belong to the field of ${subjectCode} (e.g. Databases / SQL / Normalization for DBI202, Java / OOP for PRO192, Discrete Math for MAD101, Data Structures for CSD201).
- Under NO circumstances should you fabricate, replace, or hallucinate unrelated primary-school math/algebra equations (such as "2x + 5 = 13")!
- If the question in the image is a True/False question (e.g. "A. True", "B. False"), faithfully transcribe and solve it as True/False.\n`
    : "";

  const communityContext = unit.communityAnswer
    ? `\nNote: Student community discussion on FU Overflow suggests answer: "${unit.communityAnswer}". Cross-examine this answer critically; verify whether it is genuinely correct or a common misconception/trap.\n`
    : "";

  const promptInstruction = `
You are an expert exam designer, OCR specialist, and subject-matter professor.
You are given content extracted from an HTML document or exam thread (text and/or diagrams/images).
${subjectDirective}
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
   - Solve the problem faithfully within the context of the course subject.
   - If the input is True/False, preserve the True/False options and select the correct option index accurately.
   - Formulate distinct options (realistic distractors based on common student misconceptions or subtle syntax errors).
   - CRITICAL REQUIREMENT FOR OPTIONS:
     * You MUST ALWAYS provide 4 complete, concrete, descriptive answer choices based on the question subject.
     * NEVER output generic placeholder strings like "Option A", "Option B", "Option C", or "Option D".
     * If the screenshot does not display explicit multiple-choice options (e.g. if options were cut off or if it is an open-ended question stem), you MUST synthesize 4 realistic, domain-specific options: 1 strictly correct answer and 3 plausible, realistic distractors directly related to the question.
   - If the question allows multiple answers (e.g. "select all that apply" or multiple true statements), include all correct 0-based indices in "correctOptionIndices". For single-answer questions, include only the one correct index in "correctOptionIndices".
   - NEVER invent an unrelated question from another academic subject.
3. **JSON Output Format**:
   You MUST return ONLY a valid JSON object matching this structure:
   {
     "transcribedText": "Full verbatim OCR transcription with LaTeX equations and code blocks",
     "questionText": "The complete question prompt or problem statement",
     "options": [
       "Locks are concurrency control mechanisms ensuring ACID isolation",
       "Cursors disable row-by-row query processing and force table locking",
       "Stored procedures and functions are strictly non-executable in production",
       "Database views duplicate physical tables and cannot reference base relations"
     ],
     "correctOptionIndex": 0,
     "correctOptionIndices": [0],
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

  const primaryCorrectIndex =
    typeof parsed.correctOptionIndex === "number" &&
    parsed.correctOptionIndex >= 0 &&
    parsed.correctOptionIndex < 4
      ? parsed.correctOptionIndex
      : 0;

  let correctIndices: number[] = [];
  if (Array.isArray(parsed.correctOptionIndices) && parsed.correctOptionIndices.length > 0) {
    correctIndices = parsed.correctOptionIndices
      .filter((idx: any) => typeof idx === "number" && idx >= 0 && idx < 4)
      .sort((a: number, b: number) => a - b);
  }
  if (correctIndices.length === 0) {
    correctIndices = [primaryCorrectIndex];
  }

  let finalOptions =
    Array.isArray(parsed.options) && parsed.options.length >= 2
      ? parsed.options.map((opt: any) => String(opt || "").trim())
      : [];

  if (areOptionsDummy(finalOptions)) {
    const fullText = (parsed.transcribedText || "") + "\n" + (parsed.questionText || "");
    const choiceMatches = [...fullText.matchAll(/(?:^|\n)\s*([A-D])[\.\:\)]\s*([^\n]+)/g)];
    if (choiceMatches.length >= 2) {
      finalOptions = choiceMatches.map((m) => m[2].trim());
    }
  }

  if (areOptionsDummy(finalOptions)) {
    const synthesized = synthesizeOptionsFromExplanation(
      parsed.questionText || "Question",
      parsed.explanation || ""
    );
    finalOptions = synthesized.options;
  }

  const optionsJoined = finalOptions.join(" ");
  const isDiagramDependent =
    Boolean(primaryImage) &&
    (/\(\s*[1-4]\s*\)|figure|diagram|table\s+\d+|graph/i.test(optionsJoined) ||
      /shown in (?:the )?(?:figure|diagram|image|table|graph)|following (?:figure|diagram|image|table|graph)|circular array/i.test(
        parsed.questionText || ""
      ));

  return {
    questionNumber: unit.questionNumber || 1,
    transcribedText: parsed.transcribedText || parsed.questionText || unit.rawText || "",
    questionText: parsed.questionText || unit.rawText || "Question extracted from image",
    imageBase64: primaryImage ? primaryImage.base64Data : null,
    imageMimeType: primaryImage ? primaryImage.mimeType : null,
    options: finalOptions,
    correctOptionIndex: correctIndices[0] ?? primaryCorrectIndex,
    correctOptionIndices: correctIndices,
    explanation: parsed.explanation || "",
    topic: parsed.topic && parsed.topic !== "OCR Extracted" ? parsed.topic : "Database Systems",
    difficulty: (parsed.difficulty as any) || "Medium",
    preferredViewMode: isDiagramDependent ? "image" : (primaryImage ? "auto" : "text"),
  };
}

