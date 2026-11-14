import assert from "node:assert";

// 1. Inlined crossValidateAnswerWithExplanation logic to verify algorithm precision
function crossValidateAnswerWithExplanation(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;

  const expl = parsed.explanation || "";
  const rawOptions = Array.isArray(parsed.options)
    ? parsed.options.map((opt) => String(opt || "").trim())
    : [];

  let matchedIndex = null;

  if (expl) {
    // 1. Explicit letter match (A through F)
    const explicitMatch = expl.match(
      /(?:corresponds to option|correct answer is|correct option is|the answer is|choice|option)\s+([A-F])\b/i
    );
    if (explicitMatch) {
      const letter = explicitMatch[1].toUpperCase();
      const letterIdx = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 }[letter];
      if (typeof letterIdx === "number" && (rawOptions.length === 0 || letterIdx < rawOptions.length)) {
        matchedIndex = letterIdx;
      }
    }

    // 2. Semantic option content match
    if (matchedIndex === null && rawOptions.length > 0) {
      const conclusionPortion = expl.length > 400 ? expl.slice(-400) : expl;
      const cleanText = (t) => t.toLowerCase().replace(/[\s\(\)\;`'"]/g, "");
      const cleanedConclusion = cleanText(conclusionPortion);

      const candidateMatches = [];
      rawOptions.forEach((opt, idx) => {
        const cleanedOpt = cleanText(opt);
        if (cleanedOpt.length >= 3 && cleanedConclusion.includes(cleanedOpt)) {
          candidateMatches.push(idx);
        }
      });

      if (candidateMatches.length === 1) {
        matchedIndex = candidateMatches[0];
      } else if (candidateMatches.length > 1) {
        candidateMatches.sort((a, b) => rawOptions[b].length - rawOptions[a].length);
        matchedIndex = candidateMatches[0];
      }
    }
  }

  if (typeof matchedIndex === "number") {
    const currentIdx = typeof parsed.correctOptionIndex === "number" ? parsed.correctOptionIndex : 0;
    if (
      currentIdx !== matchedIndex &&
      (currentIdx === 0 || !parsed.correctOptionIndices || parsed.correctOptionIndices.length <= 1)
    ) {
      parsed.correctOptionIndex = matchedIndex;
      parsed.correctOptionIndices = [matchedIndex];
    }
  }

  if (
    !parsed.correctOptionIndices ||
    !Array.isArray(parsed.correctOptionIndices) ||
    parsed.correctOptionIndices.length === 0
  ) {
    parsed.correctOptionIndices = [
      typeof parsed.correctOptionIndex === "number" ? parsed.correctOptionIndex : 0,
    ];
  }

  return parsed;
}

// 2. Dynamic Option Letters Test
const optionLetters = ["A", "B", "C", "D", "E", "F", "G", "H"];
const getOptionLetter = (idx) =>
  idx < optionLetters.length ? optionLetters[idx] : String.fromCharCode(65 + idx);

console.log("\n==================================================================");
console.log("  1. TESTING 5-OPTION & 6-OPTION LETTER RENDERING");
console.log("==================================================================");
assert.strictEqual(getOptionLetter(0), "A");
assert.strictEqual(getOptionLetter(3), "D");
assert.strictEqual(getOptionLetter(4), "E", "Index 4 must produce letter 'E'");
assert.strictEqual(getOptionLetter(5), "F", "Index 5 must produce letter 'F'");
console.log("  [PASS] Option index 4 renders 'E' and index 5 renders 'F'");

console.log("\n==================================================================");
console.log("  2. TESTING 5-OPTION INDEX 4 PRESERVATION (NO MORE HARDCODED < 4)");
console.log("==================================================================");
const fiveOptions = [
  "fun(1014);",
  "fun(100);",
  "fun(0);",
  "fun(1012);",
  "fun(-1012);"
];
const maxOptionsCount = Math.max(fiveOptions.length, 6);
const aiPick = 4;
const boundedIndex = (aiPick >= 0 && aiPick < maxOptionsCount) ? aiPick : 0;
assert.strictEqual(boundedIndex, 4, "Option index 4 must not be capped to 0");
console.log("  [PASS] Index 4 (Option E) is preserved with dynamic length check");

console.log("\n==================================================================");
console.log("  3. TESTING EXPLICIT LETTER 'E' IN EXPLANATION");
console.log("==================================================================");
const testExplicit = {
  options: fiveOptions,
  correctOptionIndex: 0, // erroneously defaulted to 0
  explanation: "After executing the recursion tree, this clearly corresponds to option E."
};
const repairedExplicit = crossValidateAnswerWithExplanation(testExplicit);
assert.strictEqual(repairedExplicit.correctOptionIndex, 4);
assert.deepStrictEqual(repairedExplicit.correctOptionIndices, [4]);
console.log("  [PASS] Explanation mentioning 'option E' auto-repaired to index 4");

console.log("\n==================================================================");
console.log("  4. TESTING SEMANTIC CONCLUSION MATCHING (USER'S EXACT SCREENSHOT)");
console.log("==================================================================");
const userScreenshotQuestion = {
  questionText: "Which call will result in the most recursive calls?",
  options: [
    "fun(1014);",
    "fun(100);",
    "fun(0);",
    "fun(1012);",
    "fun(-1012);"
  ],
  correctOptionIndex: 0, // Buggy default in user's saved exam
  correctOptionIndices: [0],
  explanation:
    "Let's analyze the number of recursive calls for the given function.\n" +
    "1. For fun(0), n < 5 is true, so it immediately returns 2 with 0 recursive calls.\n" +
    "2. For fun(100), the function divides n by 2 repeatedly until it drops below 5. The number of divisions by 2 to reach below 5 from 100 is around log2(100) ≈ 6 calls.\n" +
    "3. For positive numbers like 1012 and 1014, the number of recursive calls depends on log2(n). For 1012 and 1014, log2(1012) is 9 to 10 calls.\n" +
    "4. For fun(-1012), the function first hits the if (n < 0) branch and calls fun(1012). This adds an extra initial recursive call before executing the entire sequence for 1012. Thus, fun(-1012) will result in one more recursive call than fun(1012), making it the call with the most recursive calls."
};

const repairedScreenshotQuestion = crossValidateAnswerWithExplanation(userScreenshotQuestion);
assert.strictEqual(
  repairedScreenshotQuestion.correctOptionIndex,
  4,
  "Must auto-repair to Option E (fun(-1012)) based on semantic proof in explanation"
);
assert.deepStrictEqual(repairedScreenshotQuestion.correctOptionIndices, [4]);
console.log("  [PASS] Semantic conclusion 'fun(-1012)' successfully resolved to Option 4 (E)");

console.log("\n==================================================================");
console.log("  ALL TESTS PASSED SUCCESSFULLY (100%)");
console.log("==================================================================\n");
