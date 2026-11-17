const expl = "The cumulative distribution function (CDF) F(x) is defined as F(x) = P(X <= x) = \\sum_{t <= x} f(t). For x = 2, we sum the probabilities for t = 0, 1, 2: F(2) = f(0) + f(1) + f(2) = 0.25 + 0.25 + 0.25 = 0.75. Therefore, the correct answer is 0.75.";
const rawOptions = ["0.25", "0.50", "0.75", "1", "None of the other choices is correct"];

const cleanText = (t) => t.toLowerCase().replace(/[\s\(\)\;`'"\$]/g, "");

let matchedIndex = null;

// 1A. Explicit letter match (A-F)
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

// 1B. Explicit value match (e.g. "correct answer is 0.75", "the answer is 0.75")
if (matchedIndex === null && rawOptions.length > 0) {
  const explicitValMatch = expl.match(
    /(?:correct answer is|correct option is|the answer is|answer is|result is|equal to|equals)\s*[:=]?\s*([^\n]+?)(?:\.\s+|\.$|\n|$)/i
  );
  if (explicitValMatch) {
    const cleanVal = cleanText(explicitValMatch[1].trim());
    const valMatchIdx = rawOptions.findIndex((opt) => {
      const cleanOpt = cleanText(opt);
      return cleanOpt === cleanVal || (cleanVal.length >= 2 && cleanVal.startsWith(cleanOpt));
    });
    if (valMatchIdx !== -1) {
      matchedIndex = valMatchIdx;
    }
  }
}

// 2. Semantic option content match
if (matchedIndex === null && rawOptions.length > 0) {
  const conclusionPortion = expl.length > 400 ? expl.slice(-400) : expl;
  const cleanedConclusion = cleanText(conclusionPortion);

  const candidateMatches = [];
  rawOptions.forEach((opt, idx) => {
    const cleanedOpt = cleanText(opt);
    if (cleanedOpt.length >= 2 && cleanedConclusion.includes(cleanedOpt)) {
      candidateMatches.push(idx);
    }
  });

  if (candidateMatches.length === 1) {
    matchedIndex = candidateMatches[0];
  } else if (candidateMatches.length > 1) {
    // Sort primarily by length (most specific), then by position closest to the end (conclusion)
    candidateMatches.sort((a, b) => {
      const lenDiff = rawOptions[b].length - rawOptions[a].length;
      if (lenDiff !== 0) return lenDiff;
      return (
        cleanedConclusion.lastIndexOf(cleanText(rawOptions[b])) -
        cleanedConclusion.lastIndexOf(cleanText(rawOptions[a]))
      );
    });
    matchedIndex = candidateMatches[0];
  }
}

console.log("Resolved matched index:", matchedIndex, "Option:", rawOptions[matchedIndex]);
