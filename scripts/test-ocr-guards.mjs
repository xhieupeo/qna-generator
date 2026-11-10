import assert from "node:assert/strict";
import {
  assertNoDegenerativeRepetition,
  isFilenameStubWithoutImage,
} from "../src/lib/ocr-guards.ts";

// 1. Repetition loop detection (must throw)
assert.throws(
  () => assertNoDegenerativeRepetition("오라".repeat(60)),
  /Degenerative/
);

assert.throws(
  () => assertNoDegenerativeRepetition("SELECT * FROM ".repeat(20)),
  /Degenerative/
);

assert.throws(
  () => assertNoDegenerativeRepetition("aabbccdd".repeat(70)),
  /Degenerative|Low-entropy/
);

// 2. Clean text, Vietnamese accents, LaTeX, and Markdown rules must pass
assert.doesNotThrow(() =>
  assertNoDegenerativeRepetition(
    "In a relational database management system, $X \\rightarrow\\rightarrow Y$ denotes a multi-valued dependency.\n--------------------------------\nĐáp án đúng là 4NF."
  )
);

// 3. Image-less filename stub detection
assert.equal(
  isFilenameStubWithoutImage({
    id: "unit_33",
    questionNumber: 33,
    rawText: "Question 33 (DBI202 SP26 B5 FE_033.webp)",
    images: [],
  }),
  true
);

assert.equal(
  isFilenameStubWithoutImage({
    id: "unit_34",
    questionNumber: 34,
    rawText: "Some question text",
    images: [],
    imageError: "HTTP 403",
  }),
  true
);

assert.equal(
  isFilenameStubWithoutImage({
    id: "unit_35",
    questionNumber: 35,
    rawText: "Question 35 (DBI202.webp)",
    images: [{ id: "img_1", mimeType: "image/jpeg", base64Data: "/9j/4AAQ..." }],
  }),
  false
);

assert.equal(
  isFilenameStubWithoutImage({
    id: "unit_36",
    questionNumber: 36,
    rawText: "Which Normal Form eliminates non-trivial multi-valued dependencies?",
    images: [],
  }),
  false
);

console.log("[TEST PASSED] All OCR guard checks passed.");

