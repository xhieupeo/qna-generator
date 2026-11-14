import { NextRequest, NextResponse } from "next/server";
import {
  getServerSupabase,
  saveQuizToSupabase,
  createQuizRecord,
} from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth";
import { PRIMARY_ADMIN_EMAIL } from "@/lib/auth-whitelist";

export async function GET(req: NextRequest) {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase is not configured." },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(req.url);
    const tab = searchParams.get("tab") || "my";
    const user = await getAuthenticatedUser(req);

    let query = supabase.from("quizzes").select("*");

    if (tab === "shared") {
      // Shared / Community Quizzes
      query = query.eq("is_public", true);
    } else if (user) {
      // My Quizzes:
      // If user is primary admin (xhieupeo@gmail.com), also include unowned legacy quizzes
      if (user.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase()) {
        query = query.or(`user_id.eq.${user.id},user_id.is.null`);
      } else {
        query = query.eq("user_id", user.id);
      }
    } else {
      // Unauthenticated fallback: only public quizzes
      query = query.eq("is_public", true);
    }

    const { data, error } = await query.order("created_at", { ascending: false });

    if (error) {
      // If user_id column doesn't exist yet in remote schema, fallback to selecting all
      if (error.message?.includes("column") || error.code === "PGRST204") {
        const fallback = await supabase
          .from("quizzes")
          .select("*")
          .order("created_at", { ascending: false });
        return NextResponse.json({ quizzes: fallback.data || [] });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      quizzes: (data || []).map((q: any) => ({
        id: q.id,
        title: q.title,
        sourceFilename: q.source_filename,
        totalQuestions: q.total_questions,
        userId: q.user_id,
        authorEmail: q.author_email,
        isPublic: q.is_public ?? false,
        createdAt: q.created_at,
        updatedAt: q.updated_at,
      })),
      currentUser: user ? { id: user.id, email: user.email } : null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    const body = await req.json();
    const { title, sourceFilename, questions, onlyHeader, totalQuestions, isPublic } = body;

    // Header-only initialization for progressive chunked saving
    if (onlyHeader || !questions || !Array.isArray(questions)) {
      const quiz = await createQuizRecord({
        title,
        sourceFilename,
        totalQuestions: totalQuestions || (questions ? questions.length : 0),
        userId: user?.id,
        authorEmail: user?.email,
        isPublic: Boolean(isPublic),
      });
      return NextResponse.json({ quiz });
    }

    if (questions.length === 0) {
      return NextResponse.json(
        { error: "A list of questions is required." },
        { status: 400 }
      );
    }

    const savedQuiz = await saveQuizToSupabase({
      title,
      sourceFilename,
      questions,
      userId: user?.id,
      authorEmail: user?.email,
      isPublic: Boolean(isPublic),
    });

    return NextResponse.json({ quiz: savedQuiz });
  } catch (err: any) {
    console.error("Save quiz error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

