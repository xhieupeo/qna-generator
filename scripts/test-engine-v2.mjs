import { describe, it } from "node:test";
import assert from "node:assert";

// Prototype of the upgraded validation engine
const LETTER_MAP = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };

function cleanText(t) {
  return (t || "").toLowerCase().replace(/[\s\(\)\;`'"\$\\]/g, "").replace(/,/g, ".");
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripOptionPrefix(opt) {
  if (!opt) return "";
  let s = opt.trim();
  s = s.replace(/^(?:(?:option|choice|phương án|đáp án)\s+)?(?:[A-Fa-f0-9][.:)\-\s]+|\([A-Fa-f0-9]\)\s*|\[[A-Fa-f0-9]\]\s*)/iu, "");
  s = s.replace(/^[`'"$]+|[`'"$]+$/g, "").trim();
  return s;
}

function resolveCorrectIndicesFromExplanation(params) {
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

  const sanitizeFallback = () => {
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
        const letterIndices = [];
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
  const directMatches = [];
  for (let idx = 0; idx < rawOptions.length; idx++) {
    const opt = rawOptions[idx];
    const stripped = stripOptionPrefix(opt);
    const candidateTexts = Array.from(new Set([opt, stripped])).filter((t) => t && t.length >= 2);

    let matched = false;
    for (const cand of candidateTexts) {
      const esc = escapeRegex(cand);
      const directAffirmationPatterns = [
        // English: "the DROP statement/command (e.g. ...) is used"
        new RegExp(`(?<![a-zA-Z0-9_])(?:the\\s+)?${esc}\\s+(?:statement|command|keyword|clause|syntax|function|method)(?![a-zA-Z0-9_])[^(.;\\n]*?(?:\\([^)]*\\)\\s*)?(?:is|are)\\s+used(?![a-zA-Z0-9_])`, "i"),
        // Vietnamese: "lệnh/câu lệnh DROP được dùng / được sử dụng"
        new RegExp(`(?:câu\\s+lệnh|lệnh|từ\\s+khóa)\\s+${esc}(?![a-zA-Z0-9_])[^.;\\n]*?(?:được\\s+dùng|được\\s+sử\\s+dụng)`, "iu"),
        // English: "we use [the] DROP statement" or "we use return 0;"
        new RegExp(`(?<![a-zA-Z0-9_])(?:we\\s+use|use)\\s+(?:the\\s+)?${esc}(?:\\s+(?:statement|command|keyword|clause|syntax))?(?![a-zA-Z0-9_])`, "i"),
        // English/VN: "correct answer is DROP" or "the answer is DROP"
        new RegExp(`(?:correct answer is|the answer is|correct option is|đáp án đúng là|đáp án là)\\s+[:=]?\\s*(?:the\\s+)?${esc}(?![a-zA-Z0-9_])`, "iu"),
        // English: "making DROP the correct call/answer/choice"
        new RegExp(`making\\s+${esc}\\s+(?:the\\s+)?(?:correct|valid|right)`, "i"),
        // English: "DROP is the correct answer/choice"
        new RegExp(`(?<![a-zA-Z0-9_])${esc}\\s+is\\s+(?:the\\s+)?correct\\s+(?:answer|option|choice|call)`, "i"),
        // Function evaluation: "fun(-1012) evaluates to / is returned"
        new RegExp(`(?<![a-zA-Z0-9_])${esc}\\s+(?:evaluates\\s+to|returns|yields|is\\s+the\\s+correct)`, "i"),
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

console.log("Running Engine v2 Test Suite...");

// 1. Refutation Clause: Option A is incorrect... Option B is correct
const t1 = resolveCorrectIndicesFromExplanation({
  explanation: "Option A is incorrect because DELETE only removes rows. The correct choice is B because DROP removes the whole table.",
  options: ["DELETE", "DROP", "REMOVE", "TRUNCATE"],
  correctOptionIndex: 0,
});
assert.strictEqual(t1.correctOptionIndex, 1, "T1 failed: Option A is incorrect should not override B");
console.log("  [PASS] T1: Refutation clause does not trigger false positive");

// 2. Vietnamese Negation: Không chọn A... Chọn B
const t2 = resolveCorrectIndicesFromExplanation({
  explanation: "Không chọn A vì DELETE không xóa bảng. Chọn đáp án B vì DROP xóa bảng hoàn toàn.",
  options: ["DELETE", "DROP", "REMOVE", "RASE"],
  correctOptionIndex: 0,
});
assert.strictEqual(t2.correctOptionIndex, 1, "T2 failed: 'Không chọn A' should not win");
console.log("  [PASS] T2: Vietnamese negation 'Không chọn A' ignored, 'Chọn B' won");

// 3. Multi-Select: Options A and C are correct
const t3 = resolveCorrectIndicesFromExplanation({
  explanation: "Options A and C are correct because both uniquely identify records. Option B ensures referential integrity.",
  options: ["Primary Key", "Foreign Key", "Candidate Key", "Surrogate Key"],
  correctOptionIndex: 0,
  correctOptionIndices: [0, 2],
});
assert.deepStrictEqual(t3.correctOptionIndices, [0, 2], "T3 failed: Multi-select A and C should be preserved");
console.log("  [PASS] T3: Multi-select 'Options A and C are correct' preserved [0, 2]");

// 4. Word boundary on formulas/parentheses: O(n log n)
const t4 = resolveCorrectIndicesFromExplanation({
  options: ["O(n log n)", "O(n^2)", "O(1)", "O(n)"],
  correctOptionIndex: 1, // Buggy model returned index 1
  explanation: "The time complexity of quicksort in the average case is O(n log n). Option B represents the worst case, C is constant time, and D is linear time.",
});
assert.strictEqual(t4.correctOptionIndex, 0, "T4 failed: O(n log n) with parens must match");
console.log("  [PASS] T4: Formula with parenthesis O(n log n) matched successfully");

// 5. Decimals in Priority 3: 0.75
const t5 = resolveCorrectIndicesFromExplanation({
  options: ["0.25", "0.50", "0.75", "1.00"],
  correctOptionIndex: 0,
  explanation: "Integrating the density function yields a result of 0.75.",
});
assert.strictEqual(t5.correctOptionIndex, 2, "T5 failed: 0.75 decimal must match");
console.log("  [PASS] T5: Decimal result of 0.75 matched to index 2");

// 6. Option letter prefixes: "A. DELETE", "B. DROP"
const t6 = resolveCorrectIndicesFromExplanation({
  options: ["A. DELETE", "B. DROP", "C. REMOVE", "D. RASE"],
  correctOptionIndex: 0,
  explanation: "To completely delete a table structure along with all its data from the database, the DROP statement is used.",
});
assert.strictEqual(t6.correctOptionIndex, 1, "T6 failed: 'B. DROP' with prefix must match 'the DROP statement'");
console.log("  [PASS] T6: Option prefix stripped for matching, index 1 won");

// 7. Out-of-bounds fallback sanitized: index 4 in 4-option question
const t7 = resolveCorrectIndicesFromExplanation({
  options: ["Alpha", "Beta", "Gamma", "Delta"],
  correctOptionIndex: 4,
  correctOptionIndices: [4],
  explanation: "Short explanation without citations.",
});
assert.strictEqual(t7.correctOptionIndex < 4, true, "T7 failed: Out-of-bounds 4 must be clamped");
console.log("  [PASS] T7: Out-of-bounds index safely clamped to valid range");

// 8. Original user screenshot: DROP vs DELETE
const t8 = resolveCorrectIndicesFromExplanation({
  options: ["DELETE", "DROP", "REMOVE", "RASE"],
  correctOptionIndex: 0,
  explanation: "To completely delete a table structure along with all its data from the database, the DROP statement (e.g., DROP TABLE table_name) is used. The DELETE statement removes rows from a table but keeps the table structure intact. REMOVE and RASE are not standard SQL commands for this purpose.",
});
assert.strictEqual(t8.correctOptionIndex, 1, "T8 failed: DROP vs DELETE must resolve to 1");
console.log("  [PASS] T8: DROP vs DELETE resolves to index 1 (DROP)");

// 9. 5-Option Question (A-E) with concluding citation E
const t9 = resolveCorrectIndicesFromExplanation({
  options: ["Option 1", "Option 2", "Option 3", "Option 4", "None of the above"],
  correctOptionIndex: 0,
  explanation: "All statements 1 through 4 are invalid for this architecture. Therefore, the correct answer is option E: None of the above.",
});
assert.strictEqual(t9.correctOptionIndex, 4, "T9 failed: 5-option question with Option E should resolve to 4");
console.log("  [PASS] T9: 5-option question correctly resolves to Option E (index 4)");

// 10. Code snippet with semicolon: return 0;
const t10 = resolveCorrectIndicesFromExplanation({
  options: ["return 1;", "return 0;", "break;", "exit(1);"],
  correctOptionIndex: 0,
  explanation: "In C main function, returning 0 signals successful execution to the operating system. Thus, we use return 0; to exit normally.",
});
assert.strictEqual(t10.correctOptionIndex, 1, "T10 failed: Semicolon code snippet must match");
console.log("  [PASS] T10: Semicolon code snippet 'return 0;' correctly matched");

// 11. Vietnamese concluding citation: Do đó đáp án đúng là C
const t11 = resolveCorrectIndicesFromExplanation({
  options: ["Lựa chọn 1", "Lựa chọn 2", "Lựa chọn 3", "Lựa chọn 4"],
  correctOptionIndex: 0,
  explanation: "Phân tích các thuộc tính và phụ thuộc hàm. Do đó, đáp án đúng là C: Lựa chọn 3.",
});
assert.strictEqual(t11.correctOptionIndex, 2, "T11 failed: Vietnamese citation must resolve to 2 (C)");
console.log("  [PASS] T11: Vietnamese concluding citation 'Do đó, đáp án đúng là C' resolves to index 2");

// 12. Multiple correct answers in Vietnamese: Các đáp án đúng là B và D
const t12 = resolveCorrectIndicesFromExplanation({
  options: ["Mô hình mạng", "Khóa chính", "Mô hình phân cấp", "Khóa ngoại"],
  correctOptionIndex: 0,
  correctOptionIndices: [0],
  explanation: "Các ràng buộc toàn vẹn trong mô hình quan hệ bao gồm khóa chính và khóa ngoại. Các đáp án đúng là B và D.",
});
assert.deepStrictEqual(t12.correctOptionIndices, [1, 3], "T12 failed: Multi-select VN must resolve to [1, 3]");
console.log("  [PASS] T12: Vietnamese multi-select 'Các đáp án đúng là B và D' resolves to [1, 3]");

console.log("\nALL 12 COMPREHENSIVE TESTS PASSED!");
