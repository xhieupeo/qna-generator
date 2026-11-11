import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { ExtractedUnit, Question } from "./types";
import { assertNoDegenerativeRepetition } from "./ocr-guards";

export { assertNoDegenerativeRepetition };

export interface GenerateMcqOptions {
  apiKey: string;
  modelName?: string;
  language?: string;
  temperature?: number;
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
 * Robust JSON extractor that handles markdown code fences, preambles, and malformed strings.
 */
export function extractJsonFromResponse(raw: string): any {
  if (!raw) {
    throw new Error("Empty response received from AI.");
  }

  let cleaned = raw.trim();

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  }

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

    // 2. Substring extraction between first { and last }
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const jsonSubstring = cleaned.slice(firstBrace, lastBrace + 1);
      try {
        const parsed = JSON.parse(jsonSubstring);
        assertNoDegenerativeRepetition(parsed?.transcribedText || "");
        assertNoDegenerativeRepetition(parsed?.questionText || "");
        assertNoDegenerativeRepetition(parsed?.explanation || "");
        return parsed;
      } catch (innerErr: any) {
        if (innerErr?.message?.includes("Degenerative") || innerErr?.message?.includes("gibberish")) {
          throw innerErr;
        }
        console.warn("Failed to parse inner JSON substring:", innerErr);
      }
    }

    // 3. Regex field recovery fallback
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
        : "Extracted via OCR regex recovery.";

      assertNoDegenerativeRepetition(transcribedText);
      assertNoDegenerativeRepetition(questionText);
      assertNoDegenerativeRepetition(explanation);

      return {
        transcribedText: transcribedText || questionText,
        questionText: questionText || transcribedText.slice(0, 300),
        options: ["Option A", "Option B", "Option C", "Option D"],
        correctOptionIndex: 0,
        explanation,
        topic: "OCR Extracted",
        difficulty: "Medium",
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

    // 4. Plain-text response fallback (only for clean non-JSON responses)
    return {
      transcribedText: cleaned,
      questionText: cleaned.slice(0, 300),
      options: ["Option A", "Option B", "Option C", "Option D"],
      correctOptionIndex: 0,
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

  // 2. Prompt instructions (with Think-First OCR Transcription)
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
   Return a valid JSON object matching this structure:
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
              description: "Exactly 4 distinct multiple choice options (A, B, C, D).",
              items: { type: SchemaType.STRING },
            },
            correctOptionIndex: {
              type: SchemaType.INTEGER,
              description: "Index of the correct option (0 for A, 1 for B, 2 for C, 3 for D).",
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

  return {
    questionNumber: unit.questionNumber || 1,
    transcribedText: parsed.transcribedText || parsed.questionText || unit.rawText || "",
    questionText: parsed.questionText || unit.rawText || "Question extracted from image",
    imageBase64: primaryImage ? cleanBase64Data(primaryImage.base64Data) : null,
    imageMimeType: primaryImage ? cleanMimeType(primaryImage.mimeType) : null,
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
