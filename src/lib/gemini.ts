import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { ExtractedUnit, Question } from "./types";
import { assertNoDegenerativeRepetition } from "./ocr-guards";

export { assertNoDegenerativeRepetition };

export interface GenerateMcqOptions {
  apiKey: string;
  modelName?: string;
  language?: string;
  temperature?: number;
  title?: string;
}

/**
 * Normalizes base64 string by removing any data URI prefixes and whitespace.
 */
function cleanBase64Data(raw: string): string {
  if (!raw) return "";
  const commaIndex = raw.indexOf(",");
  if (raw.startsWith("data:") && commaIndex !== -1) {
    return raw.slice(commaIndex + 1).trim();
  }
  return raw.replace(/[\r\n\s]+/g, "").trim();
}

/**
 * Normalizes image MIME type to one of the formats officially supported by Gemini.
 */
function cleanMimeType(mime: string): string {
  const lower = (mime || "").toLowerCase();
  if (lower.includes("png")) return "image/png";
  if (lower.includes("webp")) return "image/webp";
  if (lower.includes("heic")) return "image/heic";
  if (lower.includes("heif")) return "image/heif";
  return "image/jpeg";
}

/**
 * Checks whether an options array consists of empty or useless dummy placeholders like ["Option A", "Option B", ...]
 */
export function areOptionsDummy(options: any): boolean {
  if (!Array.isArray(options) || options.length < 2) return true;
  return options.every(
    (opt) =>
      typeof opt !== "string" ||
      !opt.trim() ||
      /^Option\s+[A-D]$/i.test(opt.trim()) ||
      /^Choice\s+[A-D]$/i.test(opt.trim())
  );
}

/**
 * Synthesizes 4 realistic, distinct multiple-choice options when an image contains only a question
 * or when OCR options were corrupted/missing, using the factual explanation and question context.
 */
export function synthesizeOptionsFromExplanation(
  questionText: string,
  explanation: string,
  subjectCode: string = "DBI202"
): { options: string[]; correctIndex: number } {
  const cleanedExpl = (explanation || "").replace(/\s+/g, " ").trim();
  const sentences = cleanedExpl
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15 && !/making option/i.test(s));

  // Determine correct answer from primary explanation sentence
  let correctAnswer =
    sentences[0] ||
    "Locks are concurrency control mechanisms used to ensure data integrity and transaction isolation";
  if (correctAnswer.length > 130) {
    correctAnswer = correctAnswer.slice(0, 127) + "...";
  }

  const distractors: string[] = [];
  if (sentences.length > 1) {
    for (let i = 1; i < sentences.length && distractors.length < 3; i++) {
      const s = sentences[i];
      if (s.length > 15 && s.length < 130) {
        distractors.push(s);
      }
    }
  }

  const defaultDbDistractors = [
    "Cursors disable row-by-row iteration and force global table locking",
    "Stored procedures and functions are strictly non-executable in production DBMS",
    "Transactions execute without ACID isolation guarantees across connections",
    "Database views duplicate physical tables and cannot reference base relations",
  ];

  for (const d of defaultDbDistractors) {
    if (distractors.length >= 3) break;
    if (!distractors.includes(d) && d !== correctAnswer) {
      distractors.push(d);
    }
  }

  return {
    options: [correctAnswer, distractors[0], distractors[1], distractors[2]],
    correctIndex: 0,
  };
}

/**
 * Normalizes and repairs common LLM JSON syntax errors:
 * - Strips code fence wrappers
 * - Extracts outermost { ... }
 * - Removes trailing commas before } and ]
 */
function sanitizeJsonString(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  }
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    s = s.slice(firstBrace, lastBrace + 1);
  }
  // Remove trailing commas before closing braces/brackets
  s = s.replace(/,\s*([}\]])/g, "$1");
  return s;
}

/**
 * Robust JSON extractor that handles markdown code fences, preambles, and malformed strings.
 */
export function extractJsonFromResponse(raw: string): any {
  if (!raw) {
    throw new Error("Empty response received from AI.");
  }

  let cleaned = sanitizeJsonString(raw);
  assertNoDegenerativeRepetition(cleaned);

  // 1. Direct JSON parse attempt
  try {
    const parsed = JSON.parse(cleaned);
    assertNoDegenerativeRepetition(parsed?.transcribedText || "");
    assertNoDegenerativeRepetition(parsed?.questionText || "");
    assertNoDegenerativeRepetition(parsed?.explanation || "");
    return parsed;
  } catch (directErr: any) {
    if (directErr?.message?.includes("Degenerative") || directErr?.message?.includes("gibberish")) {
      throw directErr;
    }

    // 2. Secondary parse attempt: fix unescaped LaTeX backslashes that invalidate JSON
    try {
      const fixedLatex = cleaned.replace(/\\([^\/\\bfnrtu"'])/g, "\\\\$1");
      const parsed = JSON.parse(fixedLatex);
      assertNoDegenerativeRepetition(parsed?.transcribedText || "");
      assertNoDegenerativeRepetition(parsed?.questionText || "");
      assertNoDegenerativeRepetition(parsed?.explanation || "");
      return parsed;
    } catch {
      // Continue to regex recovery
    }

    // 3. Upgraded Regex field recovery fallback
    const transcribedMatch = cleaned.match(/"transcribedText"\s*:\s*"([\s\S]*?)(?<!\\)"/);
    const questionMatch = cleaned.match(/"questionText"\s*:\s*"([\s\S]*?)(?<!\\)"/);
    const explanationMatch = cleaned.match(/"explanation"\s*:\s*"([\s\S]*?)(?<!\\)"/);

    if (transcribedMatch || questionMatch) {
      const transcribedText = transcribedMatch
        ? transcribedMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n")
        : "";
      const questionText = questionMatch
        ? questionMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n")
        : transcribedText.slice(0, 300);
      const explanation = explanationMatch
        ? explanationMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n")
        : "Detailed technical explanation based on course curriculum.";

      assertNoDegenerativeRepetition(transcribedText);
      assertNoDegenerativeRepetition(questionText);
      assertNoDegenerativeRepetition(explanation);

      // A. Extract real options by regex from "options": [ ... ]
      let recoveredOptions: string[] = [];
      const optionsMatch = cleaned.match(/"options"\s*:\s*\[([\s\S]*?)\]/);
      if (optionsMatch) {
        const rawItems = [...optionsMatch[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)];
        recoveredOptions = rawItems
          .map((m) => m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim())
          .filter((opt) => opt.length > 0 && !/^Option\s+[A-D]$/i.test(opt));
      }

      // B. If options not found in array, search transcribedText/questionText for A. B. C. D.
      if (areOptionsDummy(recoveredOptions)) {
        const fullText = (transcribedText + "\n" + questionText);
        const choiceMatches = [...fullText.matchAll(/(?:^|\n)\s*([A-D])[\.\:\)]\s*([^\n]+)/g)];
        if (choiceMatches.length >= 2) {
          recoveredOptions = choiceMatches.map((m) => m[2].trim());
        }
      }

      // C. If still dummy/empty, auto-synthesize from explanation so options are NEVER dummy
      let defaultCorrectIndex = 0;
      if (areOptionsDummy(recoveredOptions)) {
        const synthesized = synthesizeOptionsFromExplanation(questionText, explanation);
        recoveredOptions = synthesized.options;
        defaultCorrectIndex = synthesized.correctIndex;
      }

      // D. Extract correctOptionIndex / correctOptionIndices
      let recoveredCorrectIndex = defaultCorrectIndex;
      let recoveredCorrectIndices: number[] = [recoveredCorrectIndex];
      const singleIndexMatch = cleaned.match(/"correctOptionIndex"\s*:\s*(\d+)/);
      if (singleIndexMatch) {
        recoveredCorrectIndex = parseInt(singleIndexMatch[1], 10);
        recoveredCorrectIndices = [recoveredCorrectIndex];
      }
      const multiIndexMatch = cleaned.match(/"correctOptionIndices"\s*:\s*\[([\d,\s]*)\]/);
      if (multiIndexMatch && multiIndexMatch[1].trim()) {
        const parsed = multiIndexMatch[1]
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n));
        if (parsed.length > 0) {
          recoveredCorrectIndices = parsed;
          recoveredCorrectIndex = parsed[0];
        }
      }

      // E. Explanation Cross-Validation / Sanity Check:
      // If the model's explanation explicitly concludes e.g. "which corresponds to option D" or "correct option is D",
      // auto-align the correct index to avoid contradiction between explanation and judge system.
      const explicitLetterMatch = explanation.match(
        /(?:corresponds to option|correct answer is|correct option is|the answer is|choice)\s+([A-D])\b/i
      );
      if (explicitLetterMatch) {
        const letter = explicitLetterMatch[1].toUpperCase();
        const letterIdx = { A: 0, B: 1, C: 2, D: 3 }[letter];
        if (typeof letterIdx === "number" && (!singleIndexMatch || recoveredCorrectIndex === 0)) {
          recoveredCorrectIndex = letterIdx;
          recoveredCorrectIndices = [letterIdx];
        }
      }

      const topicMatch = cleaned.match(/"topic"\s*:\s*"([\s\S]*?)(?<!\\)"/);
      const difficultyMatch = cleaned.match(/"difficulty"\s*:\s*"([\s\S]*?)(?<!\\)"/);

      return {
        transcribedText: transcribedText || questionText,
        questionText: questionText || transcribedText.slice(0, 300),
        options: recoveredOptions,
        correctOptionIndex: recoveredCorrectIndex,
        correctOptionIndices: recoveredCorrectIndices,
        explanation,
        topic: topicMatch ? topicMatch[1] : "Database Systems",
        difficulty: difficultyMatch ? difficultyMatch[1] : "Medium",
      };
    }

    // Reject broken/truncated JSON envelopes instead of dumping malformed JSON to UI
    if (
      cleaned.startsWith("{") ||
      cleaned.includes('"transcribedText"') ||
      cleaned.includes('"questionText"')
    ) {
      throw new Error("Malformed or truncated JSON response received from AI OCR.");
    }

    // 4. Plain-text response fallback
    const synthesized = synthesizeOptionsFromExplanation(cleaned.slice(0, 300), cleaned);
    return {
      transcribedText: cleaned,
      questionText: cleaned.slice(0, 300),
      options: synthesized.options,
      correctOptionIndex: synthesized.correctIndex,
      correctOptionIndices: [synthesized.correctIndex],
      explanation: "Direct transcription without structured options.",
      topic: "General",
      difficulty: "Medium",
    };
  }
}

export async function generateQuestionFromUnit(
  unit: ExtractedUnit,
  options: GenerateMcqOptions
): Promise<Question> {
  const allowEnvFallback = process.env.ALLOW_SERVER_KEY_FALLBACK === "true";
  const apiKey = (
    options.apiKey ||
    (allowEnvFallback ? process.env.GEMINI_API_KEY : "") ||
    ""
  ).trim();
  if (!apiKey) {
    throw new Error("Missing Gemini API Key. Please provide it in settings or .env file.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  let modelName = options.modelName || "gemini-3.8-flash";
  if (/^gemini-(1\.0|1\.5|2\.0|2\.5)-/i.test(modelName)) {
    console.warn(`[Gemini Migration] Replacing deprecated model '${modelName}' with 'gemini-3.8-flash'`);
    modelName = "gemini-3.8-flash";
  }

  const promptParts: any[] = [];

  // 1. Attach Images if present with sanitized MIME and base64 data
  let primaryImage = null;
  if (unit.images && unit.images.length > 0) {
    for (const img of unit.images) {
      const sanitizedBase64 = cleanBase64Data(img.base64Data);
      if (sanitizedBase64) {
        if (!primaryImage) primaryImage = img;
        promptParts.push({
          inlineData: {
            mimeType: cleanMimeType(img.mimeType),
            data: sanitizedBase64,
          },
        });
      }
    }
  }

  // 2. Prompt instructions (with Course Context & Domain Integrity)
  const examTitle = options.title || "";
  const subjectMatch = examTitle.match(/\b([A-Za-z]{2,4}\d{2,4}[A-Za-z]?)\b/);
  const subjectCode = subjectMatch ? subjectMatch[1].toUpperCase() : "";

  const subjectDirective = subjectCode
    ? `\nAcademic Subject / Course Context: ${subjectCode} (${examTitle}).
CRITICAL COURSE INTEGRITY RULES:
- All questions, OCR transcriptions, options, and explanations MUST strictly belong to the field of ${subjectCode} (e.g. Databases / SQL / Normalization for DBI202, Java / OOP for PRO192, Discrete Math for MAD101, Data Structures for CSD201).
- Under NO circumstances should you fabricate, replace, or hallucinate unrelated primary-school math/algebra equations (such as "2x + 5 = 13")!
- If the question in the image is a True/False question (e.g. "A. True", "B. False"), faithfully transcribe and solve it as True/False (you may include 2 plausible contextual distractors if 4 choices are required, or keep True/False marked correctly).\n`
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
   Return a valid JSON object matching this structure:
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

  promptParts.push(promptInstruction);

  let textResponse = "";
  const temperature = options.temperature ?? 0.15;

  // Attempt 1: Using structured schema
  try {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature,
        maxOutputTokens: 2500,
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            transcribedText: {
              type: SchemaType.STRING,
              description:
                "Complete verbatim OCR transcription of the text visible in the image. Format all mathematical equations in LaTeX ($...$) and code in fenced markdown blocks.",
            },
            questionText: {
              type: SchemaType.STRING,
              description: "The complete question prompt or problem statement.",
            },
            options: {
              type: SchemaType.ARRAY,
              description: "Distinct multiple choice options (A, B, C, D).",
              items: { type: SchemaType.STRING },
            },
            correctOptionIndex: {
              type: SchemaType.INTEGER,
              description: "Index of the primary correct option (0 for A, 1 for B, 2 for C, 3 for D).",
            },
            correctOptionIndices: {
              type: SchemaType.ARRAY,
              description: "Array of indices for all correct options (e.g. [0] for single choice, or [0, 2] if multiple apply).",
              items: { type: SchemaType.INTEGER },
            },
            explanation: {
              type: SchemaType.STRING,
              description: "Detailed step-by-step explanation of the correct solution.",
            },
            topic: {
              type: SchemaType.STRING,
              description: "The primary subject or topic of this question.",
            },
            difficulty: {
              type: SchemaType.STRING,
              description: "Difficulty: 'Easy', 'Medium', or 'Hard'.",
            },
          },
          required: ["transcribedText", "questionText", "options", "correctOptionIndex", "explanation"],
        },
      },
    });

    const result = await model.generateContent(promptParts);
    textResponse = result.response.text();
  } catch (schemaErr: any) {
    const msg = String(schemaErr?.message || "").toLowerCase();
    const isSchemaRejection =
      msg.includes("schema") ||
      msg.includes("responsemimetype") ||
      msg.includes("json mode") ||
      msg.includes("structured");

    if (!isSchemaRejection) {
      throw schemaErr;
    }

    console.warn(
      `[Gemini Schema Warning] Model ${modelName} rejected responseSchema, retrying with raw generation:`,
      schemaErr?.message
    );
    // Attempt 2: Fallback without responseSchema for models or tiers that do not support it
    const plainModel = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature,
        maxOutputTokens: 2500,
      },
    });

    const result = await plainModel.generateContent(promptParts);
    textResponse = result.response.text();
  }

  const parsed = extractJsonFromResponse(textResponse);

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

  return {
    questionNumber: unit.questionNumber || 1,
    transcribedText: parsed.transcribedText || parsed.questionText || unit.rawText || "",
    questionText: parsed.questionText || unit.rawText || "Question extracted from image",
    imageBase64: primaryImage ? cleanBase64Data(primaryImage.base64Data) : null,
    imageMimeType: primaryImage ? cleanMimeType(primaryImage.mimeType) : null,
    options: finalOptions,
    correctOptionIndex: correctIndices[0] ?? primaryCorrectIndex,
    correctOptionIndices: correctIndices,
    explanation: parsed.explanation || "",
    topic: parsed.topic && parsed.topic !== "OCR Extracted" ? parsed.topic : "Database Systems",
    difficulty: (parsed.difficulty as any) || "Medium",
  };
}
