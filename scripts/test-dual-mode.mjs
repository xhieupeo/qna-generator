import assert from "node:assert";

console.log("\n==================================================================");
console.log("  1. TESTING DIAGRAM DEPENDENCY DETECTION");
console.log("==================================================================");

function isQuestionDiagramDependent(questionText, options = [], hasImage = true) {
  if (!hasImage) return false;
  const optionsJoined = (options || []).join(" ");
  return (
    /\(\s*[1-4]\s*\)|figure|diagram|table\s+\d+|graph/i.test(optionsJoined) ||
    /shown in (?:the )?(?:figure|diagram|image|table|graph)|following (?:figure|diagram|image|table|graph)|circular array/i.test(
      questionText || ""
    )
  );
}

// Case A: Circular Queue problem with visual (1)-(4) choices
const qCircular = {
  questionText:
    'Consider the following pseudocode: declare a queue of characters, which is implemented by circular array of size 6. How the queue looks like after processing the input "Goo**dMor***ning**"?',
  options: ["(1)", "(2)", "(3)", "(4)"],
  hasImage: true,
};
assert.strictEqual(
  isQuestionDiagramDependent(qCircular.questionText, qCircular.options, qCircular.hasImage),
  true,
  "Should detect circular array with (1)-(4) as diagram dependent"
);
console.log("  [PASS] Circular queue with (1)-(4) options detected as diagram-dependent");

// Case B: Standard text question
const qText = {
  questionText: "Which SQL command is used to remove a table structure permanently?",
  options: ["DROP TABLE", "DELETE TABLE", "TRUNCATE TABLE", "REMOVE TABLE"],
  hasImage: false,
};
assert.strictEqual(
  isQuestionDiagramDependent(qText.questionText, qText.options, qText.hasImage),
  false,
  "Standard SQL question should not be diagram dependent"
);
console.log("  [PASS] Standard text question detected as non-diagram");

// Case C: Question referencing diagram figure in text
const qFigure = {
  questionText: "Find the shortest path from node A to node F in the following graph:",
  options: ["12", "15", "18", "21"],
  hasImage: true,
};
assert.strictEqual(
  isQuestionDiagramDependent(qFigure.questionText, qFigure.options, qFigure.hasImage),
  true,
  "Question referencing graph figure should be diagram dependent"
);
console.log("  [PASS] Graph/Figure question detected as diagram-dependent");

console.log("\n==================================================================");
console.log("  2. TESTING VIEW MODE RESOLUTION LOGIC");
console.log("==================================================================");

function resolveViewMode({
  globalMode = "auto",
  questionOverride = null,
  preferredViewMode = "auto",
  isDiagramDependent = false,
  hasImage = true,
}) {
  if (questionOverride) {
    return questionOverride;
  }
  if (globalMode === "image") return hasImage ? "image" : "text";
  if (globalMode === "text") return "text";
  if (globalMode === "split") return hasImage ? "split" : "text";

  if (preferredViewMode === "image" && hasImage) return "image";
  if (preferredViewMode === "text") return "text";
  if (preferredViewMode === "split" && hasImage) return "split";
  if (isDiagramDependent && hasImage) return "image";

  return "text";
}

// 1. Auto mode with diagram-dependent question -> Image
assert.strictEqual(
  resolveViewMode({
    globalMode: "auto",
    isDiagramDependent: true,
    hasImage: true,
  }),
  "image"
);
console.log("  [PASS] Auto mode defaults to 'image' for diagram-dependent questions");

// 2. Global force 'all image' -> Image
assert.strictEqual(
  resolveViewMode({
    globalMode: "image",
    isDiagramDependent: false,
    hasImage: true,
  }),
  "image"
);
console.log("  [PASS] Global mode 'image' forces image view across questions");

// 3. Global force 'all text' -> Text
assert.strictEqual(
  resolveViewMode({
    globalMode: "text",
    isDiagramDependent: true,
    hasImage: true,
  }),
  "text"
);
console.log("  [PASS] Global mode 'text' forces text view even on diagram questions");

// 4. Global force 'split' -> Split
assert.strictEqual(
  resolveViewMode({
    globalMode: "split",
    isDiagramDependent: true,
    hasImage: true,
  }),
  "split"
);
console.log("  [PASS] Global mode 'split' activates side-by-side mode");

// 5. Per-question local toggle overrides global
assert.strictEqual(
  resolveViewMode({
    globalMode: "image",
    questionOverride: "text",
    hasImage: true,
  }),
  "text"
);
console.log("  [PASS] Per-question override takes precedence over global mode");

console.log("\n==================================================================");
console.log("  3. TESTING SUPABASE SERIALIZATION & DATABASE INTEGRITY");
console.log("==================================================================");

function serializeQuestionForSupabase(q, quizId) {
  return {
    quiz_id: quizId,
    question_number: q.questionNumber,
    question_text: q.questionText,
    transcribed_text: q.transcribedText || null,
    image_url: q.imageUrl || null,
    options: q.options,
    correct_option_index: q.correctOptionIndices?.[0] ?? q.correctOptionIndex ?? 0,
    correct_option_indices: q.correctOptionIndices || [q.correctOptionIndex ?? 0],
    explanation: q.explanation,
    topic: q.topic || "General",
    difficulty: q.difficulty || "Medium",
    preferred_view_mode: q.preferredViewMode || "auto",
  };
}

const payload = serializeQuestionForSupabase(
  {
    questionNumber: 1,
    questionText: qCircular.questionText,
    imageUrl: "https://xyz.supabase.co/storage/v1/object/public/quiz-images/q1.png",
    options: qCircular.options,
    correctOptionIndex: 0,
    correctOptionIndices: [0],
    explanation: "Option (1) shows the correct queue state after operations.",
    preferredViewMode: "image",
  },
  "mock-quiz-uuid"
);

assert.strictEqual(payload.preferred_view_mode, "image");
assert.strictEqual(payload.image_url.includes("quiz-images"), true);
assert.strictEqual(payload.options.length, 4);
console.log("  [PASS] Question correctly serializes preferred_view_mode and image_url");

console.log("\n==================================================================");
console.log("  4. TESTING IMAGE MODE INTERACTIVE GRADING");
console.log("==================================================================");

function gradeQuestion(selectedIndices, correctIndices) {
  return (
    correctIndices.length === selectedIndices.length &&
    correctIndices.every((val) => selectedIndices.includes(val))
  );
}

// Student answers option (1) -> index 0 for the circular queue problem
const correctIndices = [0];
assert.strictEqual(gradeQuestion([0], correctIndices), true, "Choice [0] should grade as correct");
assert.strictEqual(gradeQuestion([1], correctIndices), false, "Choice [1] should grade as wrong");
assert.strictEqual(gradeQuestion([0, 1], correctIndices), false, "Over-selecting should grade as wrong");
console.log("  [PASS] Interactive answers grade accurately in image mode");

console.log("\n==================================================================");
console.log("  FINAL SCORE: ALL DUAL-MODE TESTS PASSED (100%)");
console.log("==================================================================\n");

