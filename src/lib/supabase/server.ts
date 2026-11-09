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

    const { error: uploadError } = await supabase.storage
      .from("quiz-images")
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: true,
      });

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
      }
    }

    questionInserts.push({
      quiz_id: quizId,
      question_number: q.questionNumber,
      question_text: q.questionText,
      transcribed_text: q.transcribedText || null,
      image_url: finalImageUrl,
      options: q.options,
      correct_option_index: q.correctOptionIndex,
      explanation: q.explanation,
      topic: q.topic || "General",
      difficulty: q.difficulty || "Medium",
    });
  }

  const { error: questionsError } = await supabase
    .from("questions")
    .insert(questionInserts);

  if (questionsError) {
    throw new Error(`Failed to save questions: ${questionsError.message}`);
  }

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

