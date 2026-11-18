// ==============================================================================
// Verification Suite: DROP vs DELETE Grading Fix & Cross-Validation Integrity
// ==============================================================================

import {
  resolveCorrectIndicesFromExplanation,
  getQuestionCorrectIndices,
  crossValidateAnswerWithExplanation,
} from "../src/lib/answer-validation.ts";

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${message}`);
  } else {
    console.error(`  [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

console.log("\n==================================================================");
console.log("  1. TESTING EXACT USER SCREENSHOT (DROP vs DELETE in SQL)");
console.log("==================================================================");

const userQuestion = {
  questionNumber: 1,
  questionText: "To completely remove a table and its data in SQL, we use:",
  options: ["DELETE", "DROP", "REMOVE", "RASE"],
  correctOptionIndex: 0, // Old bug: LLM returned 0 (pointing to DELETE)
  correctOptionIndices: [0],
  explanation:
    "To completely delete a table structure along with all its data from the database, the DROP statement (e.g., DROP TABLE table_name) is used. The DELETE statement removes rows from a table but keeps the table structure intact. REMOVE and RASE are not standard SQL commands for this purpose.",
};

// Test 1: getQuestionCorrectIndices resolves to index 1 (DROP)
const resolvedIndices = getQuestionCorrectIndices(userQuestion);
assert(
  resolvedIndices.length === 1 && resolvedIndices[0] === 1,
  `Resolves correct answer to Option B (index 1 / DROP). Got: ${JSON.stringify(resolvedIndices)}`
);

// Test 2: Quiz grading simulation
const userChoseDrop = [1]; // User selected DROP
const userChoseDelete = [0]; // User selected DELETE

const isDropCorrect =
  resolvedIndices.length === userChoseDrop.length &&
  resolvedIndices.every((val) => userChoseDrop.includes(val));

const isDeleteCorrect =
  resolvedIndices.length === userChoseDelete.length &&
  resolvedIndices.every((val) => userChoseDelete.includes(val));

assert(isDropCorrect === true, "User choosing DROP evaluates to TRUE [CORRECT]");
assert(isDeleteCorrect === false, "User choosing DELETE evaluates to FALSE [WRONG]");

console.log("\n==================================================================");
console.log("  2. TESTING SERVER-SIDE JSON CROSS-VALIDATION (OCR PIPELINE)");
console.log("==================================================================");

const parsedAiResponse = {
  transcribedText: "To completely remove a table and its data in SQL, we use:\nA. DELETE\nB. DROP\nC. REMOVE\nD. RASE",
  questionText: "To completely remove a table and its data in SQL, we use:",
  options: ["DELETE", "DROP", "REMOVE", "RASE"],
  correctOptionIndex: 0, // Erroneous index from LLM
  correctOptionIndices: [0],
  explanation:
    "To completely delete a table structure along with all its data from the database, the DROP statement (e.g., DROP TABLE table_name) is used. The DELETE statement removes rows from a table but keeps the table structure intact. REMOVE and RASE are not standard SQL commands for this purpose.",
};

const crossValidated = crossValidateAnswerWithExplanation(parsedAiResponse);
assert(
  crossValidated.correctOptionIndex === 1,
  `crossValidateAnswerWithExplanation auto-corrects index 0 -> 1. Got: ${crossValidated.correctOptionIndex}`
);
assert(
  crossValidated.correctOptionIndices[0] === 1,
  `crossValidateAnswerWithExplanation auto-corrects indices [0] -> [1]. Got: ${JSON.stringify(crossValidated.correctOptionIndices)}`
);

console.log("\n==================================================================");
console.log("  3. TESTING EXPLICIT LETTER CITATION & PROMPT COMPLIANCE");
console.log("==================================================================");

const explicitLetterQ = {
  options: ["DELETE", "DROP", "REMOVE", "RASE"],
  correctOptionIndex: 0,
  correctOptionIndices: [0],
  explanation:
    "The DROP command deletes the table definition and all rows. Therefore, the correct answer is option B: DROP.",
};

const letterResolved = getQuestionCorrectIndices(explicitLetterQ);
assert(
  letterResolved[0] === 1,
  `Resolves 'Therefore, the correct answer is option B' to index 1. Got: ${letterResolved[0]}`
);

console.log("\n==================================================================");
console.log("  4. TESTING VIETNAMESE EXAM QUESTIONS");
console.log("==================================================================");

const vnQuestion = {
  options: ["DELETE", "DROP", "REMOVE", "TRUNCATE"],
  correctOptionIndex: 0,
  correctOptionIndices: [0],
  explanation:
    "Để xóa hoàn toàn cấu trúc bảng và toàn bộ dữ liệu, câu lệnh DROP TABLE được sử dụng. Lệnh DELETE chỉ xóa các hàng nhưng giữ nguyên cấu trúc bảng.",
};

const vnResolved = getQuestionCorrectIndices(vnQuestion);
assert(
  vnResolved[0] === 1,
  `Resolves Vietnamese explanation 'câu lệnh DROP TABLE được sử dụng' to index 1. Got: ${vnResolved[0]}`
);

console.log("\n==================================================================");
console.log("  5. TESTING MATH & FORMULA QUESTIONS (NO REGRESSION)");
console.log("==================================================================");

const mathQuestion = {
  options: ["0.25", "0.50", "0.75", "1"],
  correctOptionIndex: 0,
  correctOptionIndices: [0],
  explanation:
    "The CDF F(2) = 0.25 + 0.25 + 0.25 = 0.75. Therefore, the correct answer is 0.75.",
};

const mathResolved = getQuestionCorrectIndices(mathQuestion);
assert(
  mathResolved[0] === 2,
  `Resolves numerical answer 0.75 to index 2. Got: ${mathResolved[0]}`
);

console.log("\n==================================================================");
console.log("  6. TESTING MULTI-SELECT PRESERVATION");
console.log("==================================================================");

const multiSelectQ = {
  options: ["TCP", "UDP", "SCTP", "ICMP"],
  correctOptionIndex: 0,
  correctOptionIndices: [0, 2],
  explanation:
    "Both TCP and SCTP provide connection-oriented and reliable transport services.",
};

const multiResolved = getQuestionCorrectIndices(multiSelectQ);
assert(
  multiResolved.length === 2 && multiResolved[0] === 0 && multiResolved[1] === 2,
  `Preserves multi-select [0, 2] without collapsing. Got: ${JSON.stringify(multiResolved)}`
);

console.log("\n==================================================================");
console.log(`  FINAL VERIFICATION SCORE: ${passedTests} / ${totalTests} TESTS PASSED`);
console.log("==================================================================\n");

if (passedTests !== totalTests) {
  process.exit(1);
}
