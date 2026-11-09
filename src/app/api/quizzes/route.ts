import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase, saveQuizToSupabase } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase is not configured." },
        { status: 503 }
      );
    }

    const { data, error } = await supabase
      .from("quizzes")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ quizzes: data || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, sourceFilename, questions } = body;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return NextResponse.json(
        { error: "A list of questions is required." },
        { status: 400 }
      );
    }

    const savedQuiz = await saveQuizToSupabase({
      title,
      sourceFilename,
      questions,
    });

    return NextResponse.json({ quiz: savedQuiz });
  } catch (err: any) {
    console.error("Save quiz error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

