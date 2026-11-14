"use client";

import React, { useState } from "react";
import { Question } from "@/lib/types";
import { LatexRenderer } from "@/components/common/LatexRenderer";
import {
  CheckCircle2,
  XCircle,
  ArrowRight,
  ArrowLeft,
  RotateCcw,
  AlertCircle,
  Image as ImageIcon,
  FileText,
  Maximize2,
  X,
  Check,
} from "lucide-react";

interface QuizPlayerProps {
  title: string;
  questions: Question[];
  onExit: () => void;
}

export const QuizPlayer: React.FC<QuizPlayerProps> = ({
  title,
  questions,
  onExit,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number[]>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [viewMode, setViewMode] = useState<"image" | "text">("image");
  const [showImageModal, setShowImageModal] = useState(false);

  const currentQ = questions[currentIndex];
  const optionLetters = ["A", "B", "C", "D"];

  const handleSelect = (optionIndex: number) => {
    if (isSubmitted) return;
    setSelectedAnswers((prev) => {
      const current = prev[currentIndex] || [];
      const next = current.includes(optionIndex)
        ? current.filter((i) => i !== optionIndex)
        : [...current, optionIndex].sort((a, b) => a - b);
      return {
        ...prev,
        [currentIndex]: next,
      };
    });
  };

  const getQuestionCorrectIndices = (q: Question): number[] => {
    if (Array.isArray(q.correctOptionIndices) && q.correctOptionIndices.length > 0) {
      return q.correctOptionIndices;
    }
    if (typeof q.correctOptionIndex === "number") {
      return [q.correctOptionIndex];
    }
    return [0];
  };

  const calculateScore = () => {
    let score = 0;
    questions.forEach((q, idx) => {
      const correct = getQuestionCorrectIndices(q);
      const selected = selectedAnswers[idx] || [];
      const isCorrect =
        correct.length === selected.length &&
        correct.every((val) => selected.includes(val));
      if (isCorrect) {
        score++;
      }
    });
    return score;
  };

  const score = calculateScore();
  const percentage = Math.round((score / questions.length) * 100);

  const imageSrc =
    currentQ.imageUrl ||
    (currentQ.imageBase64
      ? `data:${currentQ.imageMimeType || "image/jpeg"};base64,${currentQ.imageBase64}`
      : null);

  return (
    <div className="bg-white border-2 border-slate-900 p-4 sm:p-8 shadow-hard-md max-w-4xl mx-auto">
      {/* Top Banner & Control */}
      <div className="flex flex-wrap items-center justify-between border-b-2 border-slate-900 pb-4 mb-6 gap-3">
        <div>
          <span className="font-mono text-xs uppercase text-slate-500 font-bold block">
            Practice Simulation Mode
          </span>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            {title}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {!isSubmitted ? (
            <button
              type="button"
              onClick={() => setIsSubmitted(true)}
              className="px-4 py-2 bg-emerald-600 text-white font-mono text-xs font-bold uppercase border border-slate-900 hover:bg-emerald-700 shadow-hard-sm"
            >
              [ SUBMIT QUIZ ]
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setIsSubmitted(false);
                setSelectedAnswers({});
                setCurrentIndex(0);
              }}
              className="px-4 py-2 bg-blue-600 text-white font-mono text-xs font-bold uppercase border border-slate-900 hover:bg-blue-700 shadow-hard-sm flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> [ RETAKE ]
            </button>
          )}

          <button
            type="button"
            onClick={onExit}
            className="px-4 py-2 bg-white text-slate-900 font-mono text-xs font-bold uppercase border border-slate-900 hover:bg-slate-100"
          >
            [ EXIT ]
          </button>
        </div>
      </div>

      {/* Score Summary Box if Submitted */}
      {isSubmitted && (
        <div className="mb-6 p-4 border-2 border-slate-900 bg-slate-50 flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="text-xs font-mono font-bold uppercase text-slate-500 block">
              Test Result:
            </span>
            <div className="text-2xl font-bold font-mono text-slate-900">
              {score} / {questions.length}{" "}
              <span className="text-base font-normal text-slate-600">
                ({percentage}%)
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono font-bold">
            <span className="text-emerald-700 flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" /> {score} Correct
            </span>
            <span className="text-red-700 flex items-center gap-1">
              <XCircle className="w-4 h-4" /> {questions.length - score} Wrong
            </span>
          </div>
        </div>
      )}

      {/* Question Number Palette for Fast Jumping */}
      <div className="flex flex-wrap gap-1.5 mb-6 p-3 bg-slate-100 border border-slate-300">
        {questions.map((q, idx) => {
          const userAns = selectedAnswers[idx] || [];
          const isAnswered = userAns.length > 0;
          const isCurrent = idx === currentIndex;
          let btnClass = "bg-white text-slate-700 border-slate-400";

          if (isSubmitted) {
            const correct = getQuestionCorrectIndices(q);
            const isCorrect =
              correct.length === userAns.length &&
              correct.every((val) => userAns.includes(val));
            btnClass = isCorrect
              ? "bg-emerald-600 text-white border-emerald-700"
              : "bg-red-600 text-white border-red-700";
          } else if (isCurrent) {
            btnClass = "bg-slate-900 text-white border-slate-900";
          } else if (isAnswered) {
            btnClass = "bg-slate-300 text-slate-900 border-slate-500";
          }

          return (
            <button
              key={idx}
              type="button"
              onClick={() => setCurrentIndex(idx)}
              className={`w-8 h-8 font-mono text-xs font-bold border transition-all ${btnClass} ${
                isCurrent && !isSubmitted ? "ring-2 ring-slate-900 ring-offset-1" : ""
              }`}
            >
              {String(idx + 1).padStart(2, "0")}
            </button>
          );
        })}
      </div>

      {/* Main Question Display Area */}
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs font-mono text-slate-500">
          <div className="flex items-center gap-2">
            <span>
              QUESTION {currentIndex + 1} OF {questions.length}
            </span>
            {getQuestionCorrectIndices(currentQ).length > 1 && (
              <span className="text-[11px] font-mono text-blue-700 bg-blue-50 border border-blue-300 px-2 py-0.5 font-bold uppercase">
                [ SELECT ALL THAT APPLY ({getQuestionCorrectIndices(currentQ).length} ANSWERS) ]
              </span>
            )}
          </div>
          {currentQ.topic && (
            <span className="uppercase bg-slate-100 px-2 py-0.5 border border-slate-200">
              {currentQ.topic}
            </span>
          )}
        </div>

        {/* View Switcher: Diagram/Image vs Digitized Text */}
        {(imageSrc || currentQ.transcribedText) && (
          <div className="border border-slate-300 bg-slate-50 p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-200 font-mono text-xs">
              <div className="flex items-center gap-1">
                {imageSrc && (
                  <button
                    type="button"
                    onClick={() => setViewMode("image")}
                    className={`flex items-center gap-1 px-2.5 py-1 font-bold border transition-colors ${
                      viewMode === "image"
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                    }`}
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    [ IMAGE ]
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setViewMode("text")}
                  className={`flex items-center gap-1 px-2.5 py-1 font-bold border transition-colors ${
                    viewMode === "text"
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5 text-blue-500" />
                  [ DIGITIZED TEXT / LATEX ]
                </button>
              </div>

              {viewMode === "image" && imageSrc && (
                <button
                  type="button"
                  onClick={() => setShowImageModal(true)}
                  className="text-xs font-mono text-blue-600 hover:underline flex items-center gap-1"
                >
                  <Maximize2 className="w-3 h-3" /> [ EXPAND ]
                </button>
              )}
            </div>

            {viewMode === "image" && imageSrc ? (
              <div className="max-h-80 overflow-hidden flex items-center justify-center bg-white border border-slate-200 p-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageSrc}
                  alt={`Diagram for question ${currentIndex + 1}`}
                  className="max-h-80 max-w-full object-contain cursor-pointer"
                  onClick={() => setShowImageModal(true)}
                  title="Click to view full resolution"
                />
              </div>
            ) : (
              <div className="bg-white border border-slate-200 p-3 max-h-80 overflow-y-auto">
                <span className="text-[10px] font-mono uppercase text-slate-400 block mb-1">
                  Transcribed Question & Formulas:
                </span>
                <LatexRenderer
                  content={currentQ.transcribedText || currentQ.questionText}
                  className="text-xs font-mono text-slate-900"
                />
              </div>
            )}
          </div>
        )}

        <div className="text-lg font-semibold text-slate-900 leading-relaxed">
          <LatexRenderer content={currentQ.questionText} />
        </div>

        {/* Option choices */}
        <div className="space-y-2.5 pt-2">
          {currentQ.options.map((option, optIdx) => {
            const currentSelected = selectedAnswers[currentIndex] || [];
            const isSelected = currentSelected.includes(optIdx);

            const correctIndices = getQuestionCorrectIndices(currentQ);
            const isCorrect = correctIndices.includes(optIdx);

            let rowClass =
              "border-slate-300 bg-white hover:bg-slate-50 text-slate-900";
            if (isSubmitted) {
              if (isCorrect) {
                rowClass =
                  "border-2 border-emerald-600 bg-emerald-50 text-emerald-950 font-medium";
              } else if (isSelected && !isCorrect) {
                rowClass =
                  "border-2 border-red-600 bg-red-50 text-red-950 line-through";
              }
            } else if (isSelected) {
              rowClass =
                "border-2 border-slate-900 bg-slate-100 text-slate-900 font-medium shadow-hard-sm";
            }

            return (
              <button
                key={optIdx}
                type="button"
                onClick={() => handleSelect(optIdx)}
                disabled={isSubmitted}
                className={`w-full text-left flex items-center gap-3 p-3.5 border transition-all ${rowClass}`}
              >
                <div
                  className={`w-7 h-7 flex items-center justify-center font-mono text-xs font-bold border transition-colors ${
                    isSelected
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-400"
                  }`}
                >
                  {isSelected ? (
                    <Check className="w-4 h-4 stroke-[3]" />
                  ) : (
                    optionLetters[optIdx]
                  )}
                </div>
                <div className="flex-1 text-sm">
                  <LatexRenderer content={option} />
                </div>
                {isSubmitted && isCorrect && (
                  <span className="text-xs font-mono font-bold text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> [ CORRECT ]
                  </span>
                )}
                {isSubmitted && isSelected && !isCorrect && (
                  <span className="text-xs font-mono font-bold text-red-700 flex items-center gap-1">
                    <XCircle className="w-4 h-4" /> [ WRONG ]
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Explanation display if submitted */}
        {isSubmitted && (
          <div className="mt-4 p-4 bg-slate-100 border border-slate-300">
            <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-slate-800 uppercase mb-1">
              <AlertCircle className="w-4 h-4 text-blue-600" /> Solution & Explanation:
            </div>
            <LatexRenderer
              content={currentQ.explanation}
              className="text-xs text-slate-700 leading-relaxed"
            />
          </div>
        )}
      </div>

      {/* Navigation Buttons (Prev / Next) */}
      <div className="flex items-center justify-between border-t border-slate-200 mt-8 pt-4">
        <button
          type="button"
          onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
          disabled={currentIndex === 0}
          className="flex items-center gap-2 px-4 py-2 border border-slate-900 bg-white text-slate-900 font-mono text-xs font-bold uppercase hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none"
        >
          <ArrowLeft className="w-4 h-4" /> [ PREVIOUS ]
        </button>

        <span className="font-mono text-xs text-slate-500">
          {currentIndex + 1} / {questions.length}
        </span>

        <button
          type="button"
          onClick={() =>
            setCurrentIndex((prev) =>
              Math.min(questions.length - 1, prev + 1)
            )
          }
          disabled={currentIndex === questions.length - 1}
          className="flex items-center gap-2 px-4 py-2 border border-slate-900 bg-slate-900 text-white font-mono text-xs font-bold uppercase hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none"
        >
          [ NEXT ] <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Modal View for Image */}
      {showImageModal && imageSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowImageModal(false)}
        >
          <div
            className="bg-white border-2 border-slate-900 max-w-5xl max-h-[90vh] overflow-auto p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center pb-2 border-b border-slate-200 mb-2">
              <span className="font-mono text-xs font-bold uppercase text-slate-900">
                Question {currentIndex + 1} Visual Reference
              </span>
              <button
                type="button"
                onClick={() => setShowImageModal(false)}
                className="font-mono text-xs font-bold px-2 py-0.5 bg-slate-900 text-white hover:bg-red-600"
              >
                [ CLOSE ]
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageSrc}
              alt={`Full view diagram ${currentIndex + 1}`}
              className="max-w-full h-auto object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
};
