import { Question, Quiz } from "./types";

/**
 * Exports questions to Moodle GIFT format
 */
export function exportToGift(questions: Question[]): string {
  return questions
    .map((q) => {
      const correctIndices =
        Array.isArray(q.correctOptionIndices) && q.correctOptionIndices.length > 0
          ? q.correctOptionIndices
          : typeof q.correctOptionIndex === "number"
          ? [q.correctOptionIndex]
          : [0];
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

      return `// Question ${q.questionNumber} - Topic: ${q.topic || "General"}
::Q${q.questionNumber}:: ${q.questionText} {
${answers}
# ${q.explanation.replace(/[={}]/g, "\\$&")}
}`;
    })
    .join("\n\n");
}

/**
 * Exports questions to Aiken format (Common in LMS)
 */
export function exportToAiken(questions: Question[]): string {
  const letters = ["A", "B", "C", "D", "E", "F"];
  return questions
    .map((q) => {
      const optionsText = q.options
        .map((opt, i) => `${letters[i]}. ${opt}`)
        .join("\n");
      const correctIndices =
        Array.isArray(q.correctOptionIndices) && q.correctOptionIndices.length > 0
          ? q.correctOptionIndices
          : typeof q.correctOptionIndex === "number"
          ? [q.correctOptionIndex]
          : [0];
      const answerLetters = correctIndices
        .map((idx) => letters[idx] || "A")
        .join(", ");

      return `${q.questionText}\n${optionsText}\nANSWER: ${answerLetters}`;
    })
    .join("\n\n");
}

/**
 * Exports questions to CSV format
 */
export function exportToCsv(questions: Question[]): string {
  const headers = [
    "Question Number",
    "Question Text",
    "Option A",
    "Option B",
    "Option C",
    "Option D",
    "Correct Answer",
    "Explanation",
    "Topic",
    "Difficulty",
    "Image URL",
  ];

  function escapeCsv(val: any): string {
    const str = String(val ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  const rows = questions.map((q) => {
    const letters = ["A", "B", "C", "D"];
    const correctIndices =
      Array.isArray(q.correctOptionIndices) && q.correctOptionIndices.length > 0
        ? q.correctOptionIndices
        : typeof q.correctOptionIndex === "number"
        ? [q.correctOptionIndex]
        : [0];
    const answerLetters = correctIndices
      .map((idx) => letters[idx] || "A")
      .join(", ");

    return [
      q.questionNumber,
      q.questionText,
      q.options[0] || "",
      q.options[1] || "",
      q.options[2] || "",
      q.options[3] || "",
      answerLetters,
      q.explanation,
      q.topic || "",
      q.difficulty || "Medium",
      q.imageUrl || "",
    ]
      .map(escapeCsv)
      .join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

/**
 * Exports questions to JSON
 */
export function exportToJson(quiz: Partial<Quiz> & { questions: Question[] }): string {
  return JSON.stringify(quiz, null, 2);
}

