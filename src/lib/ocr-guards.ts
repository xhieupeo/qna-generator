import type { ExtractedUnit } from "./types";

/**
 * Throws if an OCR/AI output contains degenerative token-repetition loops
 * (e.g. "오라오라오라..." or 12+ repeated identical syllables/words).
 */
export function assertNoDegenerativeRepetition(text: string): void {
  if (!text) return;
  // 1. Consecutive identical 1-10 char alphanumeric/Unicode sequence repeated 11+ times
  if (/([a-zA-Z0-9\u00C0-\uFFFF]{1,10})\1{10,}/u.test(text)) {
    throw new Error("Degenerative repetition loop detected in AI OCR output.");
  }
  // 2. Same 1-3 words repeated 12+ times consecutively with spaces
  if (/(\S+(?:\s+\S+){0,2})(?:\s+\1){11,}/iu.test(text)) {
    throw new Error("Degenerative phrase repetition loop detected in AI OCR output.");
  }
  // 3. Extremely low character entropy across long strings (400+ non-space chars with < 12 unique chars)
  const compact = text.replace(/\s+/g, "");
  if (compact.length >= 400) {
    const uniqueChars = new Set(compact).size;
    if (uniqueChars < 12) {
      throw new Error("Low-entropy repetitive gibberish detected in AI OCR output.");
    }
  }
}

/**
 * Returns true if the unit only contains a filename placeholder (e.g. "Question 33 (DBI202.webp)")
 * and has no actual image attached, meaning calling the AI would hallucinate a fake question.
 */
export function isFilenameStubWithoutImage(unit: ExtractedUnit): boolean {
  const hasValidImage =
    Array.isArray(unit.images) &&
    unit.images.some((img) => Boolean(img.base64Data && img.base64Data.length > 200));
  if (hasValidImage) return false;
  if (unit.imageError) return true;
  const trimmed = (unit.rawText || "").trim();
  if (!trimmed) return true;

  // Catches filename placeholders and generic diagram/screenshot directives when image payload is empty
  if (/^Question\s+\d+(?:\s*\([^)]+\))?$/i.test(trimmed)) return true;
  if (/Solve the question shown in the (?:diagram|screenshot|image)/i.test(trimmed)) return true;

  return false;
}

