"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Quiz, Question } from "@/lib/types";
import { QuizPlayer } from "@/components/quiz/QuizPlayer";
import { exportToGift, exportToAiken, exportToCsv, exportToJson } from "@/lib/exporters";
import { Play, Download, Trash2, Database, AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";

export default function LibraryPage() {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);

  const fetchQuizzes = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/quizzes");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load quizzes");
      }
      setQuizzes(data.quizzes || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuizzes();
  }, []);

  const handleStartPractice = async (quizId: string) => {
    try {
      const res = await fetch(`/api/quizzes/${quizId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setActiveQuiz(data.quiz);
    } catch (err: any) {
      alert(`Could not load quiz questions: ${err.message}`);
    }
  };

  const handleDelete = async (quizId: string) => {
    if (!confirm("Are you sure you want to delete this quiz and its stored questions?")) return;
    try {
      const res = await fetch(`/api/quizzes/${quizId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setQuizzes((prev) => prev.filter((q) => q.id !== quizId));
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const handleExport = async (quizId: string, format: "gift" | "aiken" | "csv" | "json") => {
    try {
      const res = await fetch(`/api/quizzes/${quizId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const quiz: Quiz = data.quiz;
      const questions: Question[] = quiz.questions || [];

      let content = "";
      let mimeType = "text/plain";
      let extension = "txt";

      if (format === "gift") {
        content = exportToGift(questions);
        extension = "gift.txt";
      } else if (format === "aiken") {
        content = exportToAiken(questions);
        extension = "aiken.txt";
      } else if (format === "csv") {
        content = exportToCsv(questions);
        mimeType = "text/csv";
        extension = "csv";
      } else if (format === "json") {
        content = exportToJson({ ...quiz, questions });
        mimeType = "application/json";
        extension = "json";
      }

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${quiz.title.toLowerCase().replace(/\s+/g, "_")}.${extension}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  };

  if (activeQuiz && activeQuiz.questions) {
    return (
      <div className="py-4">
        <QuizPlayer
          title={activeQuiz.title}
          questions={activeQuiz.questions}
          onExit={() => setActiveQuiz(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b-2 border-slate-900 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-slate-900" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              SUPABASE QUIZ LIBRARY
            </h1>
          </div>
          <p className="text-xs font-mono text-slate-600 mt-1">
            Persisted Question Sets and Multimodal Test Bank
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchQuizzes}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-900 bg-white font-mono text-xs font-bold uppercase hover:bg-slate-100"
          >
            <RefreshCw className="w-3.5 h-3.5" /> [ REFRESH ]
          </button>
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white font-mono text-xs font-bold uppercase hover:bg-slate-800"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> [ BACK TO GENERATOR ]
          </Link>
        </div>
      </div>

      {/* Error or Supabase Missing Configuration Notice */}
      {error && (
        <div className="bg-amber-50 border-2 border-amber-600 p-4 text-amber-950">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="font-bold font-mono text-sm uppercase">
                Supabase Connection Notice
              </h3>
              <p className="text-xs">
                {error}
              </p>
              <div className="text-xs font-mono bg-white border border-amber-300 p-2 mt-2">
                Make sure your <code>.env.local</code> has:
                <br />
                <code>NEXT_PUBLIC_SUPABASE_URL=https://your-id.supabase.co</code>
                <br />
                <code>SUPABASE_SERVICE_ROLE_KEY=your_key</code>
                <br />
                And that you have executed <code>supabase/schema.sql</code>.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quizzes Table / Grid */}
      {loading ? (
        <div className="p-12 text-center border-2 border-dashed border-slate-300 bg-white font-mono text-sm text-slate-600">
          [ LOADING SAVED QUIZZES FROM DATABASE... ]
        </div>
      ) : quizzes.length === 0 && !error ? (
        <div className="p-12 text-center border-2 border-dashed border-slate-300 bg-white space-y-3">
          <p className="font-mono text-sm text-slate-600">
            [ NO SAVED QUIZZES FOUND IN SUPABASE ]
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Upload an HTML file on the generator page and click "Save Quiz to Supabase" to build your question bank.
          </p>
          <Link
            href="/"
            className="inline-block mt-2 px-4 py-2 bg-slate-900 text-white font-mono text-xs font-bold uppercase hover:bg-slate-800"
          >
            [ CREATE FIRST QUIZ ]
          </Link>
        </div>
      ) : (
        <div className="border-2 border-slate-900 bg-white shadow-hard-sm overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-900 bg-slate-100 font-mono text-xs uppercase text-slate-700">
                <th className="p-3 border-r border-slate-300">#</th>
                <th className="p-3 border-r border-slate-300">Quiz Title</th>
                <th className="p-3 border-r border-slate-300">Source File</th>
                <th className="p-3 border-r border-slate-300 text-center">Questions</th>
                <th className="p-3 border-r border-slate-300">Date Saved</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y border-slate-200 text-sm">
              {quizzes.map((q, idx) => (
                <tr key={q.id} className="hover:bg-slate-50 transition-colors">
                  <td className="p-3 font-mono text-xs text-slate-500 border-r border-slate-200">
                    {String(idx + 1).padStart(2, "0")}
                  </td>
                  <td className="p-3 font-semibold text-slate-900 border-r border-slate-200">
                    {q.title}
                  </td>
                  <td className="p-3 font-mono text-xs text-slate-600 border-r border-slate-200">
                    {q.sourceFilename || "document.html"}
                  </td>
                  <td className="p-3 font-mono text-xs text-center border-r border-slate-200">
                    <span className="bg-slate-100 border border-slate-300 px-2 py-0.5">
                      {q.totalQuestions}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-xs text-slate-500 border-r border-slate-200">
                    {new Date(q.createdAt).toLocaleDateString()}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleStartPractice(q.id)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 text-white font-mono text-xs font-bold uppercase hover:bg-emerald-700"
                        title="Take Practice Quiz"
                      >
                        <Play className="w-3 h-3" /> [ PRACTICE ]
                      </button>

                      <div className="relative group">
                        <button
                          type="button"
                          className="flex items-center gap-1 px-2.5 py-1 bg-slate-900 text-white font-mono text-xs font-bold uppercase hover:bg-slate-800"
                        >
                          <Download className="w-3 h-3" /> [ EXPORT ]
                        </button>
                        <div className="hidden group-hover:flex flex-col absolute right-0 mt-0 w-36 bg-white border-2 border-slate-900 shadow-hard-sm z-20">
                          <button
                            type="button"
                            onClick={() => handleExport(q.id, "gift")}
                            className="text-left px-3 py-1.5 text-xs font-mono hover:bg-slate-100 border-b border-slate-200"
                          >
                            Moodle GIFT (.txt)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleExport(q.id, "aiken")}
                            className="text-left px-3 py-1.5 text-xs font-mono hover:bg-slate-100 border-b border-slate-200"
                          >
                            Canvas Aiken (.txt)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleExport(q.id, "csv")}
                            className="text-left px-3 py-1.5 text-xs font-mono hover:bg-slate-100 border-b border-slate-200"
                          >
                            Excel / CSV (.csv)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleExport(q.id, "json")}
                            className="text-left px-3 py-1.5 text-xs font-mono hover:bg-slate-100"
                          >
                            Raw JSON (.json)
                          </button>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDelete(q.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-300"
                        title="Delete Quiz"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

