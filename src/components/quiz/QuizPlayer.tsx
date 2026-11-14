"use client";

import React, { useState, useEffect } from "react";
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
  Columns,
  ChevronDown,
  ChevronUp,
  Loader2,
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
  const [globalMode, setGlobalMode] = useState<"auto" | "image" | "text" | "split">("auto");
  const [questionModeOverride, setQuestionModeOverride] = useState<Record<number, "image" | "text" | "split">>({});
  const [showTranscribed, setShowTranscribed] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);

  const currentQ = questions[currentIndex];
  const optionLetters = ["A", "B", "C", "D"];

  const imageSrc =
    currentQ?.imageUrl ||
    (currentQ?.imageBase64
      ? `data:${currentQ.imageMimeType || "image/jpeg"};base64,${currentQ.imageBase64}`
      : null);

  const currentOptionsJoined = (currentQ?.options || []).join(" ");
  const isCurrentDiagramDependent =
    Boolean(imageSrc) &&
    (/\(\s*[1-4]\s*\)|figure|diagram|table\s+\d+|graph/i.test(currentOptionsJoined) ||
      /shown in (?:the )?(?:figure|diagram|image|table|graph)|following (?:figure|diagram|image|table|graph)|circular array/i.test(
        currentQ?.questionText || ""
      ));

  const resolvedViewMode: "image" | "text" | "split" = (() => {
    if (questionModeOverride[currentIndex]) {
      return questionModeOverride[currentIndex];
    }
    if (globalMode === "image") return imageSrc ? "image" : "text";
    if (globalMode === "text") return "text";
    if (globalMode === "split") return imageSrc ? "split" : "text";

    if (currentQ?.preferredViewMode === "image" && imageSrc) return "image";
    if (currentQ?.preferredViewMode === "text") return "text";
    if (currentQ?.preferredViewMode === "split" && imageSrc) return "split";
    if (isCurrentDiagramDependent && imageSrc) return "image";

    return "text";
  })();

  const isImagePrimary =
    resolvedViewMode === "image" ||
    (resolvedViewMode === "auto" && isCurrentDiagramDependent);

  // 1. Immediately signal image loading when moving between questions
  useEffect(() => {
    if (imageSrc) {
      setImageLoading(true);
    }
  }, [currentIndex, imageSrc]);

  // 2. Pre-fetch adjacent question images (N-1, N+1, N+2) in memory for zero-lag navigation
  useEffect(() => {
    const indicesToPrefetch = [currentIndex - 1, currentIndex + 1, currentIndex + 2];
    indicesToPrefetch.forEach((idx) => {
      if (idx >= 0 && idx < questions.length) {
        const q = questions[idx];
        const src =
          q?.imageUrl ||
          (q?.imageBase64
            ? `data:${q.imageMimeType || "image/jpeg"};base64,${q.imageBase64}`
            : null);
        if (src && typeof window !== "undefined") {
          const img = new window.Image();
          img.src = src;
        }
      }
    });
  }, [currentIndex, questions]);

  // 3. Arrow key shortcuts (Left = Previous, Right = Next)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        setCurrentIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === "ArrowRight") {
        setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [questions.length]);

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
    // 1. Explanation Cross-Validation (Self-healing for questions where fallback defaulted to 0):
    // If the explanation explicitly concludes with "corresponds to option D", "correct answer is D", etc.,
    // align with the mathematical proof in the explanation.
    if (q.explanation) {
      const explicitMatch = q.explanation.match(
        /(?:corresponds to option|correct answer is|correct option is|the answer is|choice)\s+([A-D])\b/i
      );
      if (explicitMatch) {
        const letter = explicitMatch[1].toUpperCase();
        const letterIdx = { A: 0, B: 1, C: 2, D: 3 }[letter];
        const stored = q.correctOptionIndex ?? 0;
        if (typeof letterIdx === "number" && stored === 0 && letterIdx !== 0) {
          return [letterIdx];
        }
      }
    }

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

  const renderOptionsList = () => (
    <div className="space-y-2.5 pt-2">
      {currentQ.options.map((option, optIdx) => {
        const currentSelected = selectedAnswers[currentIndex] || [];
        const isSelected = currentSelected.includes(optIdx);

        const correctIndices = getQuestionCorrectIndices(currentQ);
        const isCorrect = correctIndices.includes(optIdx);

        let rowClass = "border-slate-300 bg-white hover:bg-slate-50 text-slate-900";
        if (isSubmitted) {
          if (isCorrect) {
            rowClass = "border-2 border-emerald-600 bg-emerald-50 text-emerald-950 font-medium";
          } else if (isSelected && !isCorrect) {
            rowClass = "border-2 border-red-600 bg-red-50 text-red-950 line-through";
          }
        } else if (isSelected) {
          rowClass = "border-2 border-slate-900 bg-slate-100 text-slate-900 font-medium shadow-hard-sm";
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
            <div className="flex-1 text-sm font-mono">
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
  );

  const renderExplanationBox = () =>
    isSubmitted ? (
      <div className="mt-4 p-4 bg-slate-100 border border-slate-300">
        <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-slate-800 uppercase mb-1">
          <AlertCircle className="w-4 h-4 text-blue-600" /> Solution & Explanation:
        </div>
        <LatexRenderer
          content={currentQ.explanation}
          className="text-xs text-slate-700 leading-relaxed"
        />
      </div>
    ) : null;

  return (
    <div
      className={`bg-white border-2 border-slate-900 p-4 sm:p-8 shadow-hard-md mx-auto transition-all ${
        resolvedViewMode === "split" ? "max-w-6xl" : "max-w-4xl"
      }`}
    >
      {/* Top Banner & Control */}
      <div className="border-b-2 border-slate-900 pb-4 mb-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
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

        {/* Global Layout Switcher Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
            <span className="text-slate-500 font-bold uppercase text-[11px] mr-1">Global Mode:</span>
            <button
              type="button"
              onClick={() => {
                setGlobalMode("auto");
                setQuestionModeOverride({});
              }}
              className={`px-2.5 py-1 font-bold border transition-colors ${
                globalMode === "auto"
                  ? "bg-slate-900 text-white border-slate-900 shadow-hard-xs"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
              }`}
              title="Automatically choose Image mode for diagram questions and Text mode for others"
            >
              [ AUTO ]
            </button>
            <button
              type="button"
              onClick={() => {
                setGlobalMode("image");
                setQuestionModeOverride({});
              }}
              className={`px-2.5 py-1 font-bold border transition-colors flex items-center gap-1 ${
                globalMode === "image"
                  ? "bg-amber-400 text-slate-900 border-slate-900 shadow-hard-xs"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
              }`}
              title="Always display original exam screenshot across all questions"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              [ 🖼️ ALL IMAGE ]
            </button>
            <button
              type="button"
              onClick={() => {
                setGlobalMode("text");
                setQuestionModeOverride({});
              }}
              className={`px-2.5 py-1 font-bold border transition-colors flex items-center gap-1 ${
                globalMode === "text"
                  ? "bg-slate-900 text-white border-slate-900 shadow-hard-xs"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
              }`}
              title="Always display digitized text and formulas across all questions"
            >
              <FileText className="w-3.5 h-3.5" />
              [ 📝 ALL TEXT ]
            </button>
            <button
              type="button"
              onClick={() => {
                setGlobalMode("split");
                setQuestionModeOverride({});
              }}
              className={`hidden md:flex px-2.5 py-1 font-bold border transition-colors items-center gap-1 ${
                globalMode === "split"
                  ? "bg-indigo-600 text-white border-slate-900 shadow-hard-xs"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
              }`}
              title="Side-by-side view on desktop: image on left, choices on right"
            >
              <Columns className="w-3.5 h-3.5" />
              [ ⚡ SPLIT VIEW ]
            </button>
          </div>

          {isCurrentDiagramDependent && (
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-amber-800 bg-amber-50 border border-amber-300 px-2 py-0.5">
              <span>⚠️ Visual Diagram Question</span>
            </div>
          )}
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
        {/* Question Header & Instant View Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono pb-2 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">
              QUESTION {currentIndex + 1} OF {questions.length}
            </span>
            {getQuestionCorrectIndices(currentQ).length > 1 && (
              <span className="text-[11px] font-mono text-blue-700 bg-blue-50 border border-blue-300 px-2 py-0.5 font-bold uppercase">
                [ SELECT ALL THAT APPLY ({getQuestionCorrectIndices(currentQ).length}) ]
              </span>
            )}
            {currentQ.topic && (
              <span className="uppercase bg-slate-100 px-2 py-0.5 border border-slate-200 text-slate-600">
                {currentQ.topic}
              </span>
            )}
          </div>

          {/* Per-Question Instant View Mode Switcher */}
          {imageSrc && (
            <div className="flex items-center gap-1 font-mono text-xs">
              <button
                type="button"
                onClick={() =>
                  setQuestionModeOverride((prev) => ({
                    ...prev,
                    [currentIndex]: "image",
                  }))
                }
                className={`flex items-center gap-1 px-2.5 py-1 font-bold border transition-colors ${
                  resolvedViewMode === "image"
                    ? "bg-amber-400 text-slate-900 border-slate-900 shadow-hard-xs"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                }`}
                title="View original exam screenshot"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                [ IMAGE ]
              </button>
              <button
                type="button"
                onClick={() =>
                  setQuestionModeOverride((prev) => ({
                    ...prev,
                    [currentIndex]: "text",
                  }))
                }
                className={`flex items-center gap-1 px-2.5 py-1 font-bold border transition-colors ${
                  resolvedViewMode === "text"
                    ? "bg-slate-900 text-white border-slate-900 shadow-hard-xs"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                }`}
                title="View digitized text & formulas"
              >
                <FileText className="w-3.5 h-3.5" />
                [ TEXT ]
              </button>
              <button
                type="button"
                onClick={() =>
                  setQuestionModeOverride((prev) => ({
                    ...prev,
                    [currentIndex]: "split",
                  }))
                }
                className={`hidden md:flex items-center gap-1 px-2.5 py-1 font-bold border transition-colors ${
                  resolvedViewMode === "split"
                    ? "bg-indigo-600 text-white border-slate-900 shadow-hard-xs"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                }`}
                title="Side-by-side split screen"
              >
                <Columns className="w-3.5 h-3.5" />
                [ SPLIT ]
              </button>
              <button
                type="button"
                onClick={() => setShowImageModal(true)}
                className="text-slate-600 hover:text-blue-600 p-1 border border-slate-300 bg-white ml-1"
                title="View full-resolution image"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Dynamic Display Rendering */}
        {resolvedViewMode === "split" && imageSrc ? (
          /* Split View Layout (Desktop Side-by-Side) */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start pt-2">
            <div className="lg:sticky lg:top-4 border-2 border-slate-900 bg-slate-950 p-2 shadow-hard-sm">
              <div className="flex items-center justify-between pb-1.5 px-1 border-b border-slate-800 text-xs font-mono text-slate-300">
                <span className="font-bold flex items-center gap-1.5 text-amber-400">
                  <ImageIcon className="w-3.5 h-3.5" /> [ ORIGINAL EXAM DIAGRAM (Q{currentIndex + 1}) ]
                </span>
                <button
                  type="button"
                  onClick={() => setShowImageModal(true)}
                  className="text-xs hover:text-white flex items-center gap-1"
                >
                  <Maximize2 className="w-3 h-3" /> [ FULLSCREEN ]
                </button>
              </div>
              <div
                key={`split-img-box-${currentIndex}`}
                className="bg-white mt-1 p-1 max-h-[600px] min-h-[260px] overflow-auto flex items-center justify-center relative"
              >
                {imageLoading && (
                  <div className="absolute inset-0 bg-slate-100 flex items-center justify-center font-mono text-xs text-slate-600 z-10 gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-slate-900" />
                    <span>[ LOADING DIAGRAM {currentIndex + 1}... ]</span>
                  </div>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={`split-img-${currentIndex}-${imageSrc?.slice(0, 40)}`}
                  src={imageSrc}
                  alt={`Original exam question ${currentIndex + 1}`}
                  className="max-w-full max-h-[560px] object-contain cursor-pointer transition-opacity duration-150"
                  onLoad={() => setImageLoading(false)}
                  onError={() => setImageLoading(false)}
                  onClick={() => setShowImageModal(true)}
                  title="Click to view full resolution"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="text-base font-semibold text-slate-900 leading-relaxed border-b border-slate-200 pb-3">
                <LatexRenderer content={currentQ.questionText} />
              </div>
              {renderOptionsList()}
              {renderExplanationBox()}
            </div>
          </div>
        ) : resolvedViewMode === "image" && imageSrc ? (
          /* Image Mode Layout */
          <div className="space-y-4 pt-1">
            <div className="border-2 border-slate-900 bg-slate-950 p-2 shadow-hard-sm">
              <div className="flex items-center justify-between pb-1.5 px-1 border-b border-slate-800 text-xs font-mono text-slate-300">
                <span className="font-bold flex items-center gap-1.5 text-amber-400">
                  <ImageIcon className="w-3.5 h-3.5" /> [ ORIGINAL EXAM SCREENSHOT (Q{currentIndex + 1}) ]
                </span>
                <button
                  type="button"
                  onClick={() => setShowImageModal(true)}
                  className="text-xs hover:text-white flex items-center gap-1"
                >
                  <Maximize2 className="w-3 h-3" /> [ EXPAND / ZOOM ]
                </button>
              </div>
              <div
                key={`full-img-box-${currentIndex}`}
                className="bg-white mt-1 p-2 max-h-[500px] min-h-[240px] overflow-auto flex items-center justify-center relative"
              >
                {imageLoading && (
                  <div className="absolute inset-0 bg-slate-100 flex items-center justify-center font-mono text-xs text-slate-600 z-10 gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-slate-900" />
                    <span>[ LOADING SCREENSHOT {currentIndex + 1}... ]</span>
                  </div>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={`full-img-${currentIndex}-${imageSrc?.slice(0, 40)}`}
                  src={imageSrc}
                  alt={`Original exam question ${currentIndex + 1}`}
                  className="max-w-full max-h-[460px] object-contain cursor-pointer transition-opacity duration-150"
                  onLoad={() => setImageLoading(false)}
                  onError={() => setImageLoading(false)}
                  onClick={() => setShowImageModal(true)}
                  title="Click to view full resolution"
                />
              </div>
            </div>

            {/* Optional Collapsible Accordion for Digitized Text */}
            {(currentQ.transcribedText || currentQ.questionText) && (
              <div className="border border-slate-300 bg-slate-50">
                <button
                  type="button"
                  onClick={() => setShowTranscribed(!showTranscribed)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono font-bold text-slate-700 hover:bg-slate-100"
                >
                  <span className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                    [ {showTranscribed ? "HIDE" : "SHOW"} DIGITIZED TEXT & FORMULAS ]
                  </span>
                  {showTranscribed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {showTranscribed && (
                  <div className="p-3 border-t border-slate-300 bg-white">
                    <LatexRenderer
                      content={currentQ.transcribedText || currentQ.questionText}
                      className="text-xs font-mono text-slate-900 leading-relaxed"
                    />
                  </div>
                )}
              </div>
            )}

            {renderOptionsList()}
            {renderExplanationBox()}
          </div>
        ) : (
          /* Text Mode Layout */
          <div className="space-y-4 pt-1">
            {(globalMode === "image" || questionModeOverride[currentIndex] === "image") && !imageSrc && (
              <div className="border border-amber-300 bg-amber-50 p-3 text-xs font-mono text-amber-900 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  [ ℹ️ NO SCREENSHOT STORED ] Original image was not found for Question {currentIndex + 1} in this saved quiz. Showing digitized text.
                </span>
              </div>
            )}

            {imageSrc && (
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() =>
                    setQuestionModeOverride((prev) => ({
                      ...prev,
                      [currentIndex]: "image",
                    }))
                  }
                  className="text-xs font-mono text-blue-600 hover:underline flex items-center gap-1"
                >
                  <ImageIcon className="w-3.5 h-3.5" /> [ Switch to Exam Screenshot View ]
                </button>
              </div>
            )}

            <div className="text-lg font-semibold text-slate-900 leading-relaxed">
              <LatexRenderer content={currentQ.questionText} />
            </div>

            {renderOptionsList()}
            {renderExplanationBox()}
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
              key={`modal-img-${currentIndex}-${imageSrc?.slice(0, 40)}`}
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
