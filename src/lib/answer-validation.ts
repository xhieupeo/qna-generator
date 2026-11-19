import type { Question } from "./types";

const LETTER_MAP: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };

function cleanText(t: string): string {
  return (t || "").toLowerCase().replace(/[\s\(\)\;`'"\$\\]/g, "").replace(/,/g, ".");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strips leading option prefixes (e.g. "A. ", "B) ", "(1) ", "[A] ", "Option A: ")
 * and markdown delimiters so comparisons match the true semantic option text.
 */
export function stripOptionPrefix(opt: string): string {
  if (!opt) return "";
  let s = opt.trim();
  s = s.replace(/^(?:(?:option|choice|phương án|đáp án)\s+)?(?:[A-Fa-f0-9][.:)\-\s]+|\([A-Fa-f0-9]\)\s*|\[[A-Fa-f0-9]\]\s*)/iu, "");
  s = s.replace(/^[`'"$]+|[`'"$]+$/g, "").trim();
  return s;
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
 *  1. Explicit letter citations (A-F) with backward concluding scan, negation rejection, and multi-letter extraction
 *  2. Direct statement/keyword naming using symbol-safe non-alphanumeric token boundaries
 *  3. Exact mathematical/numerical answers (including decimals, units, and formulas)
 *  4. Sentiment-aware clause scoring (affirms DROP vs refutes DELETE)
 *  5. Graceful fallback with out-of-bounds clamping and deduplication
 */
export function resolveCorrectIndicesFromExplanation(params: ResolveAnswerParams): ResolvedAnswerResult {
  const explanation = (params.explanation || "").trim();
  const rawOptions = Array.isArray(params.options)
    ? params.options.map((opt) => String(opt || "").trim())
    : [];

  const maxIdx = rawOptions.length;

  const fallbackIdx = typeof params.correctOptionIndex === "number" && params.correctOptionIndex >= 0
    ? params.correctOptionIndex
    : 0;

  const fallbackIndices =
    Array.isArray(params.correctOptionIndices) && params.correctOptionIndices.length > 0
      ? params.correctOptionIndices
      : [fallbackIdx];

  const sanitizeFallback = (): ResolvedAnswerResult => {
    const valid = fallbackIndices
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0 && (maxIdx === 0 || n < maxIdx));
    const dedup = Array.from(new Set(valid));
    if (dedup.length > 0) {
      return { correctOptionIndex: dedup[0], correctOptionIndices: dedup };
    }
    const safeIdx = maxIdx > 0 ? Math.min(Math.max(0, Number(fallbackIdx) || 0), maxIdx - 1) : 0;
    return { correctOptionIndex: safeIdx, correctOptionIndices: [safeIdx] };
  };

  if (!explanation || rawOptions.length === 0) {
    return sanitizeFallback();
  }

  // -------------------------------------------------------------------------
  // Priority 1: Explicit letter citation in explanation (English & Vietnamese)
  // MUST be affirmative and check conclusion/backward scan first.
  // -------------------------------------------------------------------------
  const sentences = explanation
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Scan sentences from last to first (concluding sentences take absolute precedence)
  const affirmativePatterns = [
    // English conclusion: "Therefore, the correct answer is option B", "The correct options are A and C"
    /(?:therefore|thus|hence|consequently|so|in conclusion)?\s*(?:the\s+)?(?:correct|valid|right)\s+(?:answers?|options?|choices?)\s*(?:is|are|would be|equals?|:)\s*([A-F](?:\s*(?:and|or|,)\s*[A-F])*)\b/iu,
    // English: "corresponds to (the correct) option(s) B"
    /(?:corresponds?\s+to\s+(?:the\s+)?(?:correct\s+)?(?:options?|choices?))\s*[:=]?\s*([A-F](?:\s*(?:and|or|,)\s*[A-F])*)\b/iu,
    // English: "option(s) B is/are correct" (must NOT be preceded by not/incorrect)
    /(?<!\b(?:not|incorrect|wrong|never|neither|nor)\s+)\boptions?\s+([A-F](?:\s*(?:and|or|,)\s*[A-F])*)\s+(?:is|are)\s+(?:the\s+)?(?:correct|valid|right)\b/iu,
    // Vietnamese conclusion: "Do đó, đáp án đúng là B", "Các đáp án đúng là A và C"
    /(?:do\s+đó|vì\s+vậy|vậy|kết\s+luận|tóm\s+lại)?\s*(?:các\s+)?(?:đáp\s+án|phương\s+án|câu)\s+(?:đúng|chính\s+xác)\s+(?:là|:)\s*([A-F](?:\s*(?:và|hoặc|,)\s*[A-F])*)\b/iu,
    // Vietnamese: "Chọn (đáp án) B" (must NOT be preceded by không / chưa / đừng)
    /(?<!\b(?:không|chưa|đừng|chẳng)\s+)(?:chọn\s+(?:đáp\s+án|phương\s+án|câu)?)\s*[:=]?\s*([A-F](?:\s*(?:và|hoặc|,)\s*[A-F])*)\b/iu,
  ];

  for (let sIdx = sentences.length - 1; sIdx >= 0; sIdx--) {
    const s = sentences[sIdx];
    // Check if sentence is refuting or negative
    const isSentenceNegated = /(?:\b(?:not|incorrect|false|wrong|neither|nor|cannot)\b|không|chưa\s+đúng|sai)/iu.test(s);

    for (const pat of affirmativePatterns) {
      const match = s.match(pat);
      if (match) {
        // If sentence contains negation, verify the match itself is not negated
        const matchStr = match[0];
        const matchGroup = match[1];
        if (isSentenceNegated && !/(?:therefore|thus|hence|correct answer|đáp án đúng|chọn)/i.test(matchStr)) {
          continue;
        }

        const letterMatches = [...matchGroup.matchAll(/\b([A-F])\b/gi)];
        const letterIndices: number[] = [];
        for (const lm of letterMatches) {
          const lIdx = LETTER_MAP[lm[1].toUpperCase()];
          if (typeof lIdx === "number" && lIdx < maxIdx && !letterIndices.includes(lIdx)) {
            letterIndices.push(lIdx);
          }
        }

        if (letterIndices.length > 0) {
          return {
            correctOptionIndex: letterIndices[0],
            correctOptionIndices: letterIndices,
          };
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Priority 2: Direct answer naming statements with specific subject/predicate
  // Uses symbol-safe boundaries (?<![a-zA-Z0-9_]) and (?![a-zA-Z0-9_])
  // -------------------------------------------------------------------------
  const directMatches: number[] = [];
  for (let idx = 0; idx < rawOptions.length; idx++) {
    const opt = rawOptions[idx];
    const stripped = stripOptionPrefix(opt);
    const candidateTexts = Array.from(new Set([opt, stripped])).filter((t) => t && t.length >= 2);

    let matched = false;
    for (const cand of candidateTexts) {
      const esc = escapeRegex(cand);
      const directAffirmationPatterns = [
        // English: "the DROP statement/command/layer is used / responsible / designed"
        new RegExp(`(?<!\\bto\\s+(?:completely\\s+)?)(?<![a-zA-Z0-9_])(?:the\\s+)?${esc}\\s+(?:statement|command|keyword|clause|syntax|function|method|protocol|layer|algorithm)\\b[^,.;\\n]*?(?:\\([^)]*\\)\\s*)?(?:is|are)\\s+(?:used|responsible|designed|defined)(?![a-zA-Z0-9_])`, "i"),
        // Vietnamese: "lệnh/câu lệnh DROP được dùng / được sử dụng"
        new RegExp(`(?:câu\\s+lệnh|lệnh|từ\\s+khóa|giao\\s+thức|tầng)\\s+${esc}(?![a-zA-Z0-9_])[^.;\\n]*?(?:được\\s+dùng|được\\s+sử\\s+dụng|chịu\\s+trách\\s+nhiệm)`, "iu"),
        // English: "we use [the] DROP statement" or "we use return 0;"
        new RegExp(`(?<![a-zA-Z0-9_])(?:we\\s+use|use)\\s+(?:the\\s+)?${esc}(?:\\s+(?:statement|command|keyword|clause|syntax|protocol))?(?![a-zA-Z0-9_])`, "i"),
        // English/VN: "correct answer is DROP" or "the answer is DROP"
        new RegExp(`(?:correct answer is|the answer is|correct option is|đáp án đúng là|đáp án là)\\s+[:=]?\\s*(?:the\\s+)?${esc}(?![a-zA-Z0-9_])`, "iu"),
        // English: "making DROP the correct call/answer/choice"
        new RegExp(`making\\s+${esc}\\s+(?:the\\s+)?(?:correct|valid|right)`, "i"),
        // English: "DROP is the correct answer/choice"
        new RegExp(`(?<![a-zA-Z0-9_])${esc}\\s+is\\s+(?:the\\s+)?correct\\s+(?:answer|option|choice|call)`, "i"),
        // Value yields/evaluates to target: "yields / evaluates to / returns fun(-1012) / 0.75"
        new RegExp(`(?:yields?|evaluates?\\s+to|returns?|simplifies\\s+to)\\s+(?:a\\s+result\\s+of\\s+)?(?:the\\s+)?${esc}(?![a-zA-Z0-9_])`, "i"),
      ];

      for (const pat of directAffirmationPatterns) {
        if (pat.test(explanation)) {
          directMatches.push(idx);
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
  }

  if (directMatches.length === 1) {
    return {
      correctOptionIndex: directMatches[0],
      correctOptionIndices: [directMatches[0]],
    };
  }
  if (directMatches.length > 1) {
    const dedup = Array.from(new Set(directMatches)).sort((a, b) => a - b);
    return {
      correctOptionIndex: dedup[0],
      correctOptionIndices: dedup,
    };
  }

  // -------------------------------------------------------------------------
  // Priority 3: Numerical / Exact Value match (e.g., "equals 0.75", "answer is 0.75")
  // Supports decimals, fractions, and units.
  // -------------------------------------------------------------------------
  const explicitValMatch = explanation.match(
    /(?:correct answer is|correct option is|the answer is|answer is|result is|result of|yields(?: a result of)?|gives(?: a result of)?|equal to|equals|kết quả là|kết quả bằng|bằng)\s*[:=]?\s*([$]?[-+]?\d+(?:[.,]\d+)?(?:[\s\w/%^*-]+)?[$]?)(?:\.\s+|\.$|\n|,|;|\)|$)/iu
  );
  if (explicitValMatch) {
    const cleanVal = cleanText(explicitValMatch[1].trim());
    if (cleanVal.length >= 1) {
      const valIdx = rawOptions.findIndex((opt) => {
        const cleanOpt = cleanText(opt);
        const strippedClean = cleanText(stripOptionPrefix(opt));
        return cleanOpt === cleanVal || strippedClean === cleanVal;
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
  // Symbol-safe boundary: (?<![a-zA-Z0-9_])${esc}(?![a-zA-Z0-9_])
  // -------------------------------------------------------------------------
  const scores = new Array(rawOptions.length).fill(0);

  const negationRegex = /(?:\b(?:not|never|neither|nor|cannot|can't|isn't|aren't|doesn't|don't|incorrect|wrong|invalid|false|keeps?\s+.*?\bintact|only\s+removes?\s+rows|not\s+standard|not\s+supported|not\s+used)\b|không|sai|chưa\s+chính\s+xác|giữ\s+nguyên\s+cấu\s+trúc)/iu;
  const contrastRegex = /(?:\b(?:but|however|whereas|while|instead\s+of|rather\s+than|unlike)\b|nhưng|tuy\s+nhiên)/iu;
  const affirmationRegex = /(?:\b(?:is used|are used|we use|use|correct|is the standard|specifically designed|permanently|completely removes?|destroys?|eliminates?|to completely delete|drops? the table|average\s+case|amortized)\b|được\s+sử\s+dụng|được\s+dùng|chính\s+xác|đúng)/iu;

  sentences.forEach((sentence) => {
    rawOptions.forEach((opt, idx) => {
      const stripped = stripOptionPrefix(opt);
      const candidates = Array.from(new Set([opt, stripped])).filter((t) => t && t.length >= 2);

      let matchedInSentence = false;
      for (const cand of candidates) {
        const esc = escapeRegex(cand);
        const wordRegex = new RegExp(`(?<![a-zA-Z0-9_])${esc}(?![a-zA-Z0-9_])`, "i");
        if (wordRegex.test(sentence)) {
          matchedInSentence = true;
          break;
        }
      }
      if (!matchedInSentence) return;

      const isInfinitive = new RegExp(`\\bto\\s+(?:completely\\s+)?${escapeRegex(stripped || opt)}\\b`, "i").test(sentence);
      const hasNegation = negationRegex.test(sentence);
      const hasContrast = contrastRegex.test(sentence);
      const hasAffirmation = affirmationRegex.test(sentence);

      if (hasNegation || (hasContrast && !hasAffirmation)) {
        scores[idx] -= 2;
      }

      if (hasAffirmation && !isInfinitive) {
        const candEsc = escapeRegex(stripped || opt);
        const optAffirmRegex = new RegExp(`(?<![a-zA-Z0-9_])${candEsc}(?![a-zA-Z0-9_])[^.;\\n]*?(?:(?:is|are)\\s+used|được\\s+sử\\s+dụng|được\\s+dùng)`, "iu");
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
  // Priority 5: Fallback with sanitization, deduplication, and bounds checking
  // -------------------------------------------------------------------------
  return sanitizeFallback();
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
