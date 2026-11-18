import type { Question } from "./types";

function cleanText(t: string): string {
  return (t || "").toLowerCase().replace(/[\s\(\)\;`'"\$\\]/g, "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ResolveAnswerParams {
  explanation?: string | null;
  options?: string[];
  correctOptionIndex?: number;
  correctOptionIndices?: number[];
}

export interface ResolvedAnswerResult {
  correctOptionIndex: number;
  correctOptionIndices: number[];
}

/**
 * Robust cross-validation that aligns correct answer indices with the explanation.
 * Supports:
 *  1. Explicit letter citations (A-F), e.g. "corresponds to option B", "chọn đáp án B"
 *  2. Direct statement/keyword naming, e.g. "the DROP statement ... is used", "making fun(-1012) the correct call"
 *  3. Exact mathematical/numerical answers, e.g. "equals 0.75", "answer is 0.75"
 *  4. Sentiment-aware clause scoring (affirms DROP vs refutes DELETE)
 *  5. Graceful fallback preserving existing multi-select indices
 */
export function resolveCorrectIndicesFromExplanation(params: ResolveAnswerParams): ResolvedAnswerResult {
  const explanation = (params.explanation || "").trim();
  const rawOptions = Array.isArray(params.options)
    ? params.options.map((opt) => String(opt || "").trim())
    : [];

  const fallbackIdx = typeof params.correctOptionIndex === "number" && params.correctOptionIndex >= 0
    ? params.correctOptionIndex
    : 0;

  const fallbackIndices =
    Array.isArray(params.correctOptionIndices) && params.correctOptionIndices.length > 0
      ? params.correctOptionIndices
      : [fallbackIdx];

  if (!explanation || rawOptions.length === 0) {
    return {
      correctOptionIndex: fallbackIndices[0] ?? fallbackIdx,
      correctOptionIndices: fallbackIndices,
    };
  }

  const maxIdx = rawOptions.length;

  // -------------------------------------------------------------------------
  // Priority 1: Explicit letter citation in explanation (English & Vietnamese)
  // e.g. "corresponds to option B", "correct answer is B", "đáp án đúng là B", "chọn B"
  // -------------------------------------------------------------------------
  const explicitLetterMatch = explanation.match(
    /(?:corresponds to option|correct answer is|correct option is|the answer is|choice|option|đáp án đúng là|đáp án là|chọn đáp án|chọn)\s+([A-F])\b/iu
  );
  if (explicitLetterMatch) {
    const letter = explicitLetterMatch[1].toUpperCase();
    const letterMap: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };
    const letterIdx = letterMap[letter];
    if (typeof letterIdx === "number" && letterIdx < maxIdx) {
      return {
        correctOptionIndex: letterIdx,
        correctOptionIndices: [letterIdx],
      };
    }
  }

  // -------------------------------------------------------------------------
  // Priority 2: Direct answer naming statements with specific subject/predicate
  // (e.g. "the DROP statement ... is used", "lệnh DROP được dùng", "making fun(-1012) the correct call")
  // -------------------------------------------------------------------------
  const directMatches: number[] = [];
  for (let idx = 0; idx < rawOptions.length; idx++) {
    const opt = rawOptions[idx];
    if (!opt || opt.length < 2) continue;
    const esc = escapeRegex(opt);

    const directAffirmationPatterns = [
      // English: "the DROP statement/command (e.g. ...) is used"
      new RegExp(`\\b(?:the\\s+)?${esc}\\s+(?:statement|command|keyword|clause|syntax|function|method)\\b[^(.;\\n]*?(?:\\([^)]*\\)\\s*)?(?:is|are)\\s+used\\b`, "i"),
      // Vietnamese: "lệnh/câu lệnh DROP được dùng / được sử dụng"
      new RegExp(`(?:câu\\s+lệnh|lệnh|từ\\s+khóa)\\s+${esc}\\b[^.;\\n]*?(?:được\\s+dùng|được\\s+sử\\s+dụng)`, "iu"),
      // English: "we use [the] DROP statement"
      new RegExp(`\\b(?:we\\s+use|use)\\s+(?:the\\s+)?${esc}\\s+(?:statement|command|keyword|clause|syntax)\\b`, "i"),
      // English/VN: "correct answer is DROP" or "the answer is DROP"
      new RegExp(`(?:correct answer is|the answer is|correct option is|đáp án đúng là|đáp án là)\\s+[:=]?\\s*(?:the\\s+)?${esc}\\b`, "iu"),
      // English: "making DROP the correct call/answer/choice"
      new RegExp(`making\\s+${esc}\\s+(?:the\\s+)?(?:correct|valid|right)`, "i"),
      // English: "DROP is the correct answer/choice"
      new RegExp(`\\b${esc}\\s+is\\s+(?:the\\s+)?correct\\s+(?:answer|option|choice|call)`, "i"),
    ];

    for (const pat of directAffirmationPatterns) {
      if (pat.test(explanation)) {
        directMatches.push(idx);
        break;
      }
    }
  }

  if (directMatches.length === 1) {
    return {
      correctOptionIndex: directMatches[0],
      correctOptionIndices: [directMatches[0]],
    };
  }

  // -------------------------------------------------------------------------
  // Priority 3: Numerical / Exact Value match (e.g., "equals 0.75", "answer is 0.75")
  // -------------------------------------------------------------------------
  const explicitValMatch = explanation.match(
    /(?:correct answer is|correct option is|the answer is|answer is|result is|equal to|equals|kết quả là|bằng)\s*[:=]?\s*([^\n,.]+?)(?:\.\s+|\.$|\n|,|$)/iu
  );
  if (explicitValMatch) {
    const cleanVal = cleanText(explicitValMatch[1].trim());
    if (cleanVal.length >= 1) {
      const valIdx = rawOptions.findIndex((opt) => {
        const cleanOpt = cleanText(opt);
        return cleanOpt === cleanVal;
      });
      if (valIdx !== -1) {
        return {
          correctOptionIndex: valIdx,
          correctOptionIndices: [valIdx],
        };
      }
    }
  }

  // -------------------------------------------------------------------------
  // Priority 4: Sentiment & Context-Aware Clause Scoring
  // Breaks explanation into sentences, scores affirmative vs negative contexts
  // -------------------------------------------------------------------------
  const sentences = explanation
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  const scores = new Array(rawOptions.length).fill(0);

  const negationRegex = /(?:\b(?:not|never|neither|nor|cannot|can't|isn't|aren't|doesn't|don't|incorrect|wrong|invalid|false|keeps?\s+.*?\bintact|only\s+removes?\s+rows|not\s+standard|not\s+supported|not\s+used)\b|không|sai|chưa\s+chính\s+xác|giữ\s+nguyên\s+cấu\s+trúc)/iu;
  const contrastRegex = /(?:\b(?:but|however|whereas|while|instead\s+of|rather\s+than|unlike)\b|nhưng|tuy\s+nhiên)/iu;
  const affirmationRegex = /(?:\b(?:is used|are used|correct|is the standard|specifically designed|permanently|completely removes?|destroys?|eliminates?|to completely delete|drops? the table)\b|được\s+sử\s+dụng|được\s+dùng|chính\s+xác|đúng)/iu;

  sentences.forEach((sentence) => {
    rawOptions.forEach((opt, idx) => {
      if (!opt || opt.length < 2) return;
      const wordRegex = new RegExp(`\\b${escapeRegex(opt)}\\b`, "i");
      if (!wordRegex.test(sentence)) return;

      const isInfinitive = new RegExp(`\\bto\\s+(?:completely\\s+)?${escapeRegex(opt)}\\b`, "i").test(sentence);

      const hasNegation = negationRegex.test(sentence);
      const hasContrast = contrastRegex.test(sentence);
      const hasAffirmation = affirmationRegex.test(sentence);

      if (hasNegation || (hasContrast && !hasAffirmation)) {
        scores[idx] -= 2;
      }

      if (hasAffirmation && !isInfinitive) {
        const optAffirmRegex = new RegExp(`\\b${escapeRegex(opt)}\\b[^.;\\n]*?(?:(?:is|are)\\s+used|được\\s+sử\\s+dụng|được\\s+dùng)`, "iu");
        if (optAffirmRegex.test(sentence)) {
          scores[idx] += 4;
        } else if (!hasNegation) {
          scores[idx] += 2;
        }
      }
    });
  });

  let bestScore = -Infinity;
  let bestIdx = -1;
  let runnerUpScore = -Infinity;

  scores.forEach((sc, idx) => {
    if (sc > bestScore) {
      runnerUpScore = bestScore;
      bestScore = sc;
      bestIdx = idx;
    } else if (sc > runnerUpScore) {
      runnerUpScore = sc;
    }
  });

  if (bestIdx !== -1 && bestScore > 0 && bestScore > runnerUpScore) {
    return {
      correctOptionIndex: bestIdx,
      correctOptionIndices: [bestIdx],
    };
  }

  // -------------------------------------------------------------------------
  // Priority 5: Fallback to existing stored indices if valid
  // -------------------------------------------------------------------------
  return {
    correctOptionIndex: fallbackIndices[0] ?? fallbackIdx,
    correctOptionIndices: fallbackIndices,
  };
}

/**
 * Adapter for question object (used in QuizPlayer and QuestionCard).
 */
export function getQuestionCorrectIndices(q: Question): number[] {
  const result = resolveCorrectIndicesFromExplanation({
    explanation: q.explanation,
    options: q.options,
    correctOptionIndex: q.correctOptionIndex,
    correctOptionIndices: q.correctOptionIndices,
  });
  return result.correctOptionIndices;
}

/**
 * Adapter for parsed JSON object during OCR/generation phase.
 */
export function crossValidateAnswerWithExplanation(parsed: any): any {
  if (!parsed || typeof parsed !== "object") return parsed;

  const result = resolveCorrectIndicesFromExplanation({
    explanation: parsed.explanation,
    options: parsed.options,
    correctOptionIndex: parsed.correctOptionIndex,
    correctOptionIndices: parsed.correctOptionIndices,
  });

  parsed.correctOptionIndex = result.correctOptionIndex;
  parsed.correctOptionIndices = result.correctOptionIndices;

  return parsed;
}
