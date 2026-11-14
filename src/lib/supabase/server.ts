import { createClient } from "@supabase/supabase-js";
import { Question, Quiz } from "../types";

export function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
    },
  });
}

/**
 * Uploads an image base64 buffer to Supabase Storage bucket 'quiz-images'
 */
export async function uploadQuizImage(
  supabase: any,
  quizId: string,
  questionNumber: number,
  base64Data: string,
  mimeType: string = "image/png"
): Promise<string | null> {
  try {
    const ext = mimeType.split("/")[1] || "png";
    const filePath = `quizzes/${quizId}/q${questionNumber}_${Date.now()}.${ext}`;
    const buffer = Buffer.from(base64Data, "base64");

    let { error: uploadError } = await supabase.storage
      .from("quiz-images")
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: true,
      });

    // Auto-create bucket if it doesn't exist yet
    if (
      uploadError &&
      (uploadError.message?.toLowerCase().includes("not found") ||
        uploadError.message?.toLowerCase().includes("bucket"))
    ) {
      console.log("Bucket 'quiz-images' missing, creating public bucket...");
      await supabase.storage.createBucket("quiz-images", { public: true });
      const retryUpload = await supabase.storage
        .from("quiz-images")
        .upload(filePath, buffer, {
          contentType: mimeType,
          upsert: true,
        });
      uploadError = retryUpload.error;
    }

    if (uploadError) {
      console.error("Supabase Storage upload error:", uploadError);
      return null;
    }

    const { data } = supabase.storage.from("quiz-images").getPublicUrl(filePath);
    return data.publicUrl;
  } catch (err) {
    console.error("Failed to upload image to Supabase Storage:", err);
    return null;
  }
}

/**
 * Creates just the quiz header in the 'quizzes' table.
 * Used for progressive chunked saving to prevent Vercel 4.5MB body payload limits.
 */
export async function createQuizRecord(params: {
  title: string;
  sourceFilename?: string;
  totalQuestions: number;
}): Promise<{ id: string; title: string }> {
  const supabase = getServerSupabase();
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Please add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to your environment variables."
    );
  }

  const { data: quizData, error: quizError } = await supabase
    .from("quizzes")
    .insert({
      title: params.title || "Untitled Quiz",
      source_filename: params.sourceFilename || "document.html",
      total_questions: params.totalQuestions || 0,
    })
    .select()
    .single();

  if (quizError || !quizData) {
    throw new Error(`Failed to create quiz header: ${quizError?.message}`);
  }

  return {
    id: quizData.id,
    title: quizData.title,
  };
}

/**
 * Safely inserts questions into the 'questions' table with self-healing fallback.
 * If the remote Supabase database has not had recent migrations applied (e.g. missing
 * 'correct_option_indices' or 'preferred_view_mode' columns in PostgREST schema cache),
 * it gracefully strips the missing column(s) and retries the insert so saving never fails.
 */
async function safeInsertQuestions(supabase: any, inserts: any[]): Promise<void> {
  let toInsert = [...inserts];
  let { error } = await supabase.from("questions").insert(toInsert);

  if (error && (error.message?.includes("schema cache") || error.code === "PGRST204")) {
    console.warn("Supabase schema mismatch detected. Retrying with backward-compatible fields:", error.message);

    // Strip new columns that might not exist in user's older Supabase table
    toInsert = toInsert.map((item) => {
      const copy = { ...item };
      delete copy.correct_option_indices;
      delete copy.preferred_view_mode;
      return copy;
    });

    const retryResult = await supabase.from("questions").insert(toInsert);
    error = retryResult.error;
  }

  if (error) {
    throw new Error(`Failed to save question batch: ${error.message}`);
  }
}

/**
 * Saves a chunk/batch of questions for an existing quiz, uploading images to Storage.
 */
export async function saveQuestionBatch(
  quizId: string,
  questions: Question[]
): Promise<{ count: number }> {
  const supabase = getServerSupabase();
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const questionInserts: any[] = [];
  for (const q of questions) {
    let finalImageUrl = q.imageUrl || null;

    if (q.imageBase64 && !finalImageUrl) {
      const uploadedUrl = await uploadQuizImage(
        supabase,
        quizId,
        q.questionNumber,
        q.imageBase64,
        q.imageMimeType || "image/png"
      );
      if (uploadedUrl) {
        finalImageUrl = uploadedUrl;
      } else if (q.imageBase64) {
        // Fallback: If Storage upload fails, store data URL so image is NEVER lost
        finalImageUrl = `data:${q.imageMimeType || "image/png"};base64,${q.imageBase64}`;
      }
    }

    const correctIndices =
      Array.isArray(q.correctOptionIndices) && q.correctOptionIndices.length > 0
        ? q.correctOptionIndices
        : typeof q.correctOptionIndex === "number"
        ? [q.correctOptionIndex]
        : [0];

    questionInserts.push({
      quiz_id: quizId,
      question_number: q.questionNumber,
      question_text: q.questionText,
      transcribed_text: q.transcribedText || null,
      image_url: finalImageUrl,
      options: q.options,
      correct_option_index: correctIndices[0] ?? 0,
      correct_option_indices: correctIndices,
      explanation: q.explanation,
      topic: q.topic || "General",
      difficulty: q.difficulty || "Medium",
      preferred_view_mode: q.preferredViewMode || "auto",
    });
  }

  await safeInsertQuestions(supabase, questionInserts);

  return { count: questionInserts.length };
}

/**
 * Persists a complete quiz and its questions (including images) to Supabase
 */
export async function saveQuizToSupabase(params: {
  title: string;
  sourceFilename?: string;
  questions: Question[];
}): Promise<Quiz> {
  const supabase = getServerSupabase();
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Please add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY to your environment variables."
    );
  }

  // 1. Insert Quiz Metadata
  const { data: quizData, error: quizError } = await supabase
    .from("quizzes")
    .insert({
      title: params.title || "Untitled Quiz",
      source_filename: params.sourceFilename || "document.html",
      total_questions: params.questions.length,
    })
    .select()
    .single();

  if (quizError || !quizData) {
    throw new Error(`Failed to save quiz metadata: ${quizError?.message}`);
  }

  const quizId = quizData.id;

  // 2. Process and Insert Questions
  const questionInserts: any[] = [];
  for (const q of params.questions) {
    let finalImageUrl = q.imageUrl || null;

    // If imageBase64 exists, upload to Supabase storage
    if (q.imageBase64 && !finalImageUrl) {
      const uploadedUrl = await uploadQuizImage(
        supabase,
        quizId,
        q.questionNumber,
        q.imageBase64,
        q.imageMimeType || "image/png"
      );
      if (uploadedUrl) {
        finalImageUrl = uploadedUrl;
      } else if (q.imageBase64) {
        // Fallback: If Storage upload fails, store data URL so image is NEVER lost
        finalImageUrl = `data:${q.imageMimeType || "image/png"};base64,${q.imageBase64}`;
      }
    }

    const correctIndices =
      Array.isArray(q.correctOptionIndices) && q.correctOptionIndices.length > 0
        ? q.correctOptionIndices
        : typeof q.correctOptionIndex === "number"
        ? [q.correctOptionIndex]
        : [0];

    questionInserts.push({
      quiz_id: quizId,
      question_number: q.questionNumber,
      question_text: q.questionText,
      transcribed_text: q.transcribedText || null,
      image_url: finalImageUrl,
      options: q.options,
      correct_option_index: correctIndices[0] ?? 0,
      correct_option_indices: correctIndices,
      explanation: q.explanation,
      topic: q.topic || "General",
      difficulty: q.difficulty || "Medium",
      preferred_view_mode: q.preferredViewMode || "auto",
    });
  }

  await safeInsertQuestions(supabase, questionInserts);

  return {
    id: quizId,
    title: quizData.title,
    sourceFilename: quizData.source_filename,
    totalQuestions: quizData.total_questions,
    createdAt: quizData.created_at,
    updatedAt: quizData.updated_at,
    questions: params.questions.map((q, idx) => ({
      ...q,
      imageUrl: questionInserts[idx].image_url,
    })),
  };
}

