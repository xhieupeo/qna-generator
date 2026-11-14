import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase, saveQuestionBatch } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth";
import { PRIMARY_ADMIN_EMAIL } from "@/lib/auth-whitelist";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await req.json();
    const { questions } = body;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return NextResponse.json(
        { error: "No questions provided in batch" },
        { status: 400 }
      );
    }

    const result = await saveQuestionBatch(id, questions);
    return NextResponse.json({ success: true, count: result.count });
  } catch (err: any) {
    console.error("Batch save error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

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
    const user = await getAuthenticatedUser(req);

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

    // Access authorization check:
    // Allow if public, or owned by user, or unowned legacy quiz, or user is primary admin
    const isOwner = user && quiz.user_id && quiz.user_id === user.id;
    const isAdmin = user && user.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase();
    const isAccessible = quiz.is_public || isOwner || isAdmin || !quiz.user_id;

    if (!isAccessible) {
      return NextResponse.json(
        { error: "Access Denied: This exam is private to its author." },
        { status: 403 }
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
        userId: quiz.user_id,
        authorEmail: quiz.author_email,
        isPublic: quiz.is_public ?? false,
        createdAt: quiz.created_at,
        updatedAt: quiz.updated_at,
        questions: (questions || []).map((q) => {
          const rawIndices = q.correct_option_indices;
          const parsedIndices =
            Array.isArray(rawIndices) && rawIndices.length > 0
              ? rawIndices
              : [q.correct_option_index ?? 0];

          return {
            id: q.id,
            quizId: q.quiz_id,
            questionNumber: q.question_number,
            questionText: q.question_text,
            imageUrl: q.image_url,
            transcribedText: q.transcribed_text,
            options: q.options,
            correctOptionIndex: parsedIndices[0] ?? (q.correct_option_index ?? 0),
            correctOptionIndices: parsedIndices,
            explanation: q.explanation,
            topic: q.topic,
            difficulty: q.difficulty,
            preferredViewMode: q.preferred_view_mode || (q.image_url ? "auto" : "text"),
          };
        }),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(
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
    const user = await getAuthenticatedUser(req);
    const body = await req.json();

    // Verify quiz exists and check ownership
    const { data: quiz, error: quizError } = await supabase
      .from("quizzes")
      .select("id, user_id, author_email")
      .eq("id", id)
      .single();

    if (quizError || !quiz) {
      return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
    }

    const isOwner = user && quiz.user_id && quiz.user_id === user.id;
    const isAdmin = user && user.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase();

    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { error: "Unauthorized: You can only modify sharing settings for your own quizzes." },
        { status: 403 }
      );
    }

    const { isPublic } = body;
    const { data: updated, error: updateError } = await supabase
      .from("quizzes")
      .update({ is_public: Boolean(isPublic) })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, quiz: updated });
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
    const user = await getAuthenticatedUser(req);

    // Verify ownership before deleting
    const { data: quiz, error: quizError } = await supabase
      .from("quizzes")
      .select("id, user_id, author_email")
      .eq("id", id)
      .single();

    if (quizError || !quiz) {
      return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
    }

    const isOwner = user && quiz.user_id && quiz.user_id === user.id;
    const isAdmin = user && user.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase();

    // If quiz is assigned to a specific user and caller is NOT that user or admin, reject!
    if (quiz.user_id && !isOwner && !isAdmin) {
      return NextResponse.json(
        { error: "Unauthorized: You can only delete quizzes from your own library." },
        { status: 403 }
      );
    }

    const { error } = await supabase.from("quizzes").delete().eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

