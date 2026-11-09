import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase is not configured." },
        { status: 503 }
      );
    }

    const { id } = params;

    // Fetch Quiz
    const { data: quiz, error: quizError } = await supabase
      .from("quizzes")
      .select("*")
      .eq("id", id)
      .single();

    if (quizError || !quiz) {
      return NextResponse.json(
        { error: "Quiz not found" },
        { status: 404 }
      );
    }

    // Fetch Questions
    const { data: questions, error: questionsError } = await supabase
      .from("questions")
      .select("*")
      .eq("quiz_id", id)
      .order("question_number", { ascending: true });

    if (questionsError) {
      return NextResponse.json(
        { error: questionsError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        sourceFilename: quiz.source_filename,
        totalQuestions: quiz.total_questions,
        createdAt: quiz.created_at,
        updatedAt: quiz.updated_at,
        questions: (questions || []).map((q) => ({
          id: q.id,
          quizId: q.quiz_id,
          questionNumber: q.question_number,
          questionText: q.question_text,
          imageUrl: q.image_url,
          options: q.options,
          correctOptionIndex: q.correct_option_index,
          explanation: q.explanation,
          topic: q.topic,
          difficulty: q.difficulty,
        })),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase is not configured." },
        { status: 503 }
      );
    }

    const { id } = params;
    const { error } = await supabase.from("quizzes").delete().eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

