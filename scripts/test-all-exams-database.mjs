// ==============================================================================
// Comprehensive Master Verification Suite:
// All Exam Question Types, Real Database Cases & Grading Architecture
// ==============================================================================

import {
  resolveCorrectIndicesFromExplanation,
  getQuestionCorrectIndices,
  crossValidateAnswerWithExplanation,
} from "../src/lib/answer-validation.ts";

function exportToGift(questions) {
  return questions
    .map((q) => {
      const correctIndices = getQuestionCorrectIndices(q);
      const isMultiple = correctIndices.length > 1;
      const weight = isMultiple ? Math.round(100 / correctIndices.length) : 100;
      const answers = q.options
        .map((opt, i) => {
          const isCorrect = correctIndices.includes(i);
          const prefix = isMultiple
            ? isCorrect
              ? `~%${weight}%`
              : `~`
            : isCorrect
            ? "="
            : "~";
          return `  ${prefix}${opt.replace(/[={}]/g, "\\$&")}`;
        })
        .join("\n");
      return `::Q${q.questionNumber}:: ${q.questionText} {\n${answers}\n}`;
    })
    .join("\n\n");
}

function exportToAiken(questions) {
  const letters = ["A", "B", "C", "D", "E", "F"];
  return questions
    .map((q) => {
      const optionsText = q.options.map((opt, i) => `${letters[i]}. ${opt}`).join("\n");
      const correctIndices = getQuestionCorrectIndices(q);
      const answerLetters = correctIndices.map((idx) => letters[idx] || "A").join(", ");
      return `${q.questionText}\n${optionsText}\nANSWER: ${answerLetters}`;
    })
    .join("\n\n");
}

function exportToCsv(questions) {
  const letters = ["A", "B", "C", "D"];
  return questions.map((q) => {
    const correctIndices = getQuestionCorrectIndices(q);
    const answerLetters = correctIndices.map((idx) => letters[idx] || "A").join(", ");
    return [q.questionNumber, q.questionText, answerLetters].join(",");
  }).join("\n");
}

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
console.log("  1. USER CASE 1: SQL DROP vs DELETE (DBI202 DATABASE SYSTEMS)");
console.log("==================================================================");

const exam1_DropVsDelete = {
  questionNumber: 1,
  questionText: "To completely remove a table and its data in SQL, we use:",
  options: ["DELETE", "DROP", "REMOVE", "RASE"],
  correctOptionIndex: 0, // Stored bug: LLM returned 0 (DELETE)
  correctOptionIndices: [0],
  explanation:
    "To completely delete a table structure along with all its data from the database, the DROP statement (e.g., DROP TABLE table_name) is used. The DELETE statement removes rows from a table but keeps the table structure intact. REMOVE and RASE are not standard SQL commands for this purpose.",
};

const res1 = getQuestionCorrectIndices(exam1_DropVsDelete);
assert(res1.length === 1 && res1[0] === 1, `Resolves to Option B (index 1 / DROP). Got: ${JSON.stringify(res1)}`);

// Simulate user choosing DROP
const userPickDrop = [1];
const isDropGradedCorrect = res1.length === userPickDrop.length && res1.every((v) => userPickDrop.includes(v));
assert(isDropGradedCorrect, "User selecting DROP is graded as 100% CORRECT");

// Simulate user choosing DELETE
const userPickDelete = [0];
const isDeleteGradedCorrect = res1.length === userPickDelete.length && res1.every((v) => userPickDelete.includes(v));
assert(!isDeleteGradedCorrect, "User selecting DELETE is graded as 0% WRONG");

console.log("\n==================================================================");
console.log("  2. USER CASE 2: C PROGRAMMING fun(-1012) RECURSION");
console.log("==================================================================");

const exam2_Recursion = {
  questionNumber: 15,
  questionText: "What function call results in termination when passed to the recursive routine?",
  options: ["fun(1024)", "fun(0)", "fun(-512)", "fun(256)", "fun(-1012)"],
  correctOptionIndex: 0, // Stored bug: 0
  correctOptionIndices: [0],
  explanation:
    "Evaluating the recursive step with base case x <= -1000 shows that only fun(-1012) reaches the terminating condition directly, making fun(-1012) the correct call.",
};

const res2 = getQuestionCorrectIndices(exam2_Recursion);
assert(res2.length === 1 && res2[0] === 4, `Resolves to Option E (index 4 / fun(-1012)). Got: ${JSON.stringify(res2)}`);

console.log("\n==================================================================");
console.log("  3. USER CASE 3: PROBABILITY & STATISTICS (MAS291) DECIMAL VALUE");
console.log("==================================================================");

const exam3_CDF = {
  questionNumber: 7,
  questionText: "Find the Cumulative Distribution Function F(2) for the discrete random variable X.",
  options: ["0.25", "0.50", "0.75", "1.00"],
  correctOptionIndex: 0,
  correctOptionIndices: [0],
  explanation:
    "Summing probabilities P(X <= 2) = 0.25 + 0.25 + 0.25 yields a result of 0.75. Therefore, the answer is 0.75.",
};

const res3 = getQuestionCorrectIndices(exam3_CDF);
assert(res3.length === 1 && res3[0] === 2, `Resolves to Option C (index 2 / 0.75). Got: ${JSON.stringify(res3)}`);

console.log("\n==================================================================");
console.log("  4. DATA STRUCTURES & ALGORITHMS (CSD201) COMPLEXITY & PARENS");
console.log("==================================================================");

const exam4_Complexity = {
  questionNumber: 4,
  questionText: "What is the average time complexity of Quicksort algorithm?",
  options: ["O(n log n)", "O(n^2)", "O(1)", "O(n)"],
  correctOptionIndex: 1, // Buggy model returned O(n^2)
  correctOptionIndices: [1],
  explanation:
    "In the average case, Quicksort partitions the array evenly, leading to an average case time complexity of O(n log n). Option B represents worst case when pivot selection is poor.",
};

const res4 = getQuestionCorrectIndices(exam4_Complexity);
assert(res4.length === 1 && res4[0] === 0, `Resolves to Option A (index 0 / O(n log n)). Got: ${JSON.stringify(res4)}`);

console.log("\n==================================================================");
console.log("  5. MULTI-SELECT QUESTION: NETWORKING PROTOCOLS (SWE202)");
console.log("==================================================================");

const exam5_MultiSelect = {
  questionNumber: 12,
  questionText: "Which of the following transport layer protocols provide connection-oriented reliable data transfer? (Select all that apply)",
  options: ["TCP", "UDP", "SCTP", "ICMP"],
  correctOptionIndex: 0,
  correctOptionIndices: [0, 2], // Both TCP (0) and SCTP (2)
  explanation:
    "Options A and C are correct because both TCP and SCTP establish connections and guarantee delivery. Option B is connectionless.",
};

const res5 = getQuestionCorrectIndices(exam5_MultiSelect);
assert(
  res5.length === 2 && res5[0] === 0 && res5[1] === 2,
  `Preserves multi-select [0, 2] without collapsing. Got: ${JSON.stringify(res5)}`
);

// Grading: user selects both TCP and SCTP
const userFullCorrect = [0, 2];
const isFullCorrect =
  res5.length === userFullCorrect.length && res5.every((v) => userFullCorrect.includes(v));
assert(isFullCorrect, "Student selecting [TCP, SCTP] is graded as 100% CORRECT");

// Grading: user only selects TCP (partial credit = false)
const userPartial = [0];
const isPartialCorrect =
  res5.length === userPartial.length && res5.every((v) => userPartial.includes(v));
assert(!isPartialCorrect, "Student selecting only [TCP] is correctly not marked as full credit");

console.log("\n==================================================================");
console.log("  6. VIETNAMESE EXAM: REFUTATION & CONCLUDING CITATIONS");
console.log("==================================================================");

const exam6_Vietnamese = {
  questionNumber: 20,
  questionText: "Trong hệ quản trị cơ sở dữ liệu quan hệ, lệnh nào dùng để xóa bảng và định nghĩa bảng?",
  options: ["DELETE", "DROP", "REMOVE", "CLEAR"],
  correctOptionIndex: 0,
  explanation:
    "Không chọn A vì lệnh DELETE chỉ xóa dữ liệu bên trong bảng mà giữ nguyên cấu trúc. Không chọn C và D vì không phải cú pháp SQL. Do đó, đáp án đúng là B: Lệnh DROP xóa hoàn toàn bảng.",
};

const res6 = getQuestionCorrectIndices(exam6_Vietnamese);
assert(res6.length === 1 && res6[0] === 1, `Vietnamese refutation resolves to Option B (index 1). Got: ${JSON.stringify(res6)}`);

console.log("\n==================================================================");
console.log("  7. OPTIONS WITH LETTER PREFIXES (A. B. C. D.)");
console.log("==================================================================");

const exam7_Prefixed = {
  questionNumber: 3,
  questionText: "Which statement terminates a C function successfully?",
  options: ["A. return 1;", "B. return 0;", "C. break;", "D. continue;"],
  correctOptionIndex: 0,
  explanation:
    "In the main function, we use return 0; to indicate successful program termination to the host environment.",
};

const res7 = getQuestionCorrectIndices(exam7_Prefixed);
assert(res7.length === 1 && res7[0] === 1, `Prefixed option 'B. return 0;' resolves to index 1. Got: ${JSON.stringify(res7)}`);

console.log("\n==================================================================");
console.log("  8. OUT-OF-BOUNDS & CORRUPTED STORAGE SELF-HEALING");
console.log("==================================================================");

const exam8_Corrupted = {
  questionNumber: 5,
  questionText: "Which layer handles routing in OSI model?",
  options: ["Physical", "Data Link", "Network", "Transport"],
  correctOptionIndex: 99, // Out of bounds
  correctOptionIndices: [99, 100],
  explanation: "Network layer is responsible for logical routing of packets across networks.",
};

const res8 = getQuestionCorrectIndices(exam8_Corrupted);
assert(res8.length === 1 && res8[0] === 2, `Out-of-bounds index healed to Network layer (index 2). Got: ${JSON.stringify(res8)}`);

console.log("\n==================================================================");
console.log("  9. EXPORTERS SYNCHRONIZATION (GIFT, AIKEN, CSV)");
console.log("==================================================================");

const sampleExams = [exam1_DropVsDelete, exam3_CDF, exam5_MultiSelect];

// Test GIFT export
const giftOutput = exportToGift(sampleExams);
assert(giftOutput.includes("=DROP") && giftOutput.includes("~DELETE"), "GIFT exporter correctly marks =DROP and ~DELETE");
assert(giftOutput.includes("=0.75"), "GIFT exporter correctly marks =0.75");
assert(giftOutput.includes("~%50%TCP") && giftOutput.includes("~%50%SCTP"), "GIFT exporter correctly weights multi-select 50% TCP / 50% SCTP");

// Test Aiken export
const aikenOutput = exportToAiken(sampleExams);
assert(aikenOutput.includes("ANSWER: B"), "Aiken exporter exports ANSWER: B for DROP");
assert(aikenOutput.includes("ANSWER: C"), "Aiken exporter exports ANSWER: C for 0.75");
assert(aikenOutput.includes("ANSWER: A, C"), "Aiken exporter exports ANSWER: A, C for multi-select");

// Test CSV export
const csvOutput = exportToCsv(sampleExams);
assert(csvOutput.includes(",B") || csvOutput.includes('"B"'), "CSV exporter includes B for DROP");
assert(csvOutput.includes("A, C"), "CSV exporter includes A, C for multi-select");

console.log("\n==================================================================");
console.log("  10. SERVER-SIDE OCR PIPELINE RESYNTHESIS INTEGRATION");
console.log("==================================================================");

const rawOcrParsed = {
  transcribedText: "To completely delete a table, use DROP.",
  questionText: "To completely delete a table, use:",
  options: ["Option A", "Option B", "Option C", "Option D"], // Dummy at first
  correctOptionIndex: 0,
  explanation: "The DROP statement is used to remove the table.",
};

const validatedOcr = crossValidateAnswerWithExplanation(rawOcrParsed);
assert(typeof validatedOcr.correctOptionIndex === "number", "crossValidateAnswerWithExplanation returns valid structure");

console.log("\n==================================================================");
console.log(`  FINAL VERIFICATION SCORE: ${passedTests} / ${totalTests} TESTS PASSED`);
console.log("==================================================================\n");
