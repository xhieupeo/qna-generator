import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

const args = process.argv.slice(2);
let apiKey = process.env.GEMINI_API_KEY || "";
let inputFile = "fuoverflow_latest_ready.json";
let outputFile = "jpd113_solved_questions.json";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--key" && args[i + 1]) {
    apiKey = args[++i];
  } else if (args[i] === "--file" && args[i + 1]) {
    inputFile = args[++i];
  } else if (args[i] === "--out" && args[i + 1]) {
    outputFile = args[++i];
  }
}

if (!apiKey) {
  console.log(`
FU Overflow Exam Solver -> JSON
===============================
Usage:
  node scripts/solve-to-json.mjs --key "<YOUR_GEMINI_API_KEY>" [options]

Options:
  --key  <API_KEY>   Your Google Gemini API Key
  --file <JSON_PATH> Input file with base64 images (default: fuoverflow_latest_ready.json)
  --out  <OUT_PATH>  Output JSON path (default: jpd113_solved_questions.json)
`);
  process.exit(0);
}

async function solve() {
  console.log(`[1/3] Reading input exam file: ${inputFile}`);
  const raw = fs.readFileSync(path.resolve(inputFile), "utf8");
  const data = JSON.parse(raw);
  const questionsList = data.questions || [];

  console.log(`Found ${questionsList.length} questions to transcribe and solve.`);
  const genAI = new GoogleGenerativeAI(apiKey);
  const candidateModels = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash-latest", "gemini-1.5-flash"];
  let model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  });

  const solvedQuestions = [];

  for (let i = 0; i < questionsList.length; i++) {
    const item = questionsList[i];
    const qNum = item.questionNumber || i + 1;
    console.log(`[2/3] Processing Question ${qNum}/${questionsList.length} (${item.filename || ""})...`);

    let base64 = "";
    if (item.dataUrl) {
      base64 = item.dataUrl.split(",")[1];
    } else if (item.base64Data) {
      base64 = item.base64Data;
    } else if (item.filePath && fs.existsSync(item.filePath)) {
      base64 = fs.readFileSync(item.filePath).toString("base64");
    }

    if (!base64) {
      console.warn(`  [!] Skipping Q${qNum}: No image data found.`);
      continue;
    }

    const prompt = `You are an expert exam analyzer and OCR reader.
Examine this Japanese / Exam question image carefully.
Extract the question text, the multiple choice options, determine the correct answer, and provide a clear explanation.
Return STRICT JSON format with this exact structure:
{
  "questionNumber": ${qNum},
  "question": "The complete transcribed question text",
  "options": [
    "A. Option 1",
    "B. Option 2",
    "C. Option 3",
    "D. Option 4"
  ],
  "correctAnswer": 0,
  "explanation": "Why this option is correct"
}`;

    try {
      const response = await model.generateContent([
        {
          inlineData: {
            data: base64,
            mimeType: item.mimeType || "image/webp",
          },
        },
        prompt,
      ]);

      const resultText = response.response.text();
      const parsed = JSON.parse(resultText);

      solvedQuestions.push({
        questionNumber: parsed.questionNumber || qNum,
        question: parsed.question,
        options: parsed.options,
        correctAnswer: parsed.correctAnswer,
        explanation: parsed.explanation,
      });

      console.log(`  -> Q${qNum} solved: ${parsed.options ? parsed.options.length : 0} options extracted.`);
    } catch (err) {
      console.warn(`  [!] Error solving Q${qNum}: ${err.message}`);
    }

    // Small throttle to avoid hitting RPM rate limits
    if (i < questionsList.length - 1) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  const finalOutput = {
    title: data.title || "Solved Exam",
    subjectCode: data.subjectCode || "JPD113",
    sourceUrl: data.sourceUrl || "",
    totalQuestions: solvedQuestions.length,
    questions: solvedQuestions,
  };

  fs.writeFileSync(path.resolve(outputFile), JSON.stringify(finalOutput, null, 2), "utf8");

  console.log(`\n=======================================================`);
  console.log(`[3/3] SUCCESS! Solved ${solvedQuestions.length} questions.`);
  console.log(`Saved output to: ${path.resolve(outputFile)}`);
  console.log(`=======================================================`);
}

solve().catch(console.error);
