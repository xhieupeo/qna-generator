"use client";

import React, { useState } from "react";
import { Question } from "@/lib/types";
import { LatexRenderer } from "@/components/common/LatexRenderer";
import {
  Trash2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  FileText,
  Copy,
  Check,
  RefreshCw,
  X,
} from "lucide-react";

interface QuestionCardProps {
  question: Question;
  index: number;
  onUpdate: (updatedQuestion: Question) => void;
  onDelete: (index: number) => void;
  onRetry?: (index: number) => Promise<void>;
}

export const QuestionCard: React.FC<QuestionCardProps> = ({
  question,
  index,
  onUpdate,
  onDelete,
  onRetry,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [showExplanation, setShowExplanation] = useState(true);
  const [showImageModal, setShowImageModal] = useState(false);
  const [viewMode, setViewMode] = useState<"image" | "text">(
    question.imageBase64 || question.imageUrl ? "image" : "text"
  );
  const [copied, setCopied] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const optionLetters = ["A", "B", "C", "D"];

  const handleTextChange = (field: keyof Question, value: any) => {
    onUpdate({
      ...question,
      [field]: value,
    });
  };

  const handleOptionChange = (optIdx: number, val: string) => {
    const newOptions = [...question.options];
    newOptions[optIdx] = val;
    handleTextChange("options", newOptions);
  };

  const getInitialCorrectIndices = (): number[] => {
    if (question.explanation) {
      const explicitMatch = question.explanation.match(
        /(?:corresponds to option|correct answer is|correct option is|the answer is|choice)\s+([A-D])\b/i
      );
      if (explicitMatch) {
        const letter = explicitMatch[1].toUpperCase();
        const letterIdx = { A: 0, B: 1, C: 2, D: 3 }[letter];
        const stored = question.correctOptionIndex ?? 0;
        if (typeof letterIdx === "number" && stored === 0 && letterIdx !== 0) {
          return [letterIdx];
        }
      }
    }
    if (Array.isArray(question.correctOptionIndices) && question.correctOptionIndices.length > 0) {
      return question.correctOptionIndices;
    }
    if (typeof question.correctOptionIndex === "number") {
      return [question.correctOptionIndex];
    }
    return [0];
  };

  const currentCorrectIndices = getInitialCorrectIndices();

  const handleToggleCorrectOption = (optIdx: number) => {
    let next: number[];
    if (currentCorrectIndices.includes(optIdx)) {
      if (currentCorrectIndices.length > 1) {
        next = currentCorrectIndices.filter((i) => i !== optIdx);
      } else {
        next = [optIdx];
      }
    } else {
      next = [...currentCorrectIndices, optIdx].sort((a, b) => a - b);
    }
    onUpdate({
      ...question,
      correctOptionIndices: next,
      correctOptionIndex: next[0] ?? 0,
    });
  };

  const handleCopyText = () => {
    const textToCopy = question.transcribedText || question.questionText;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRetryOcr = async () => {
    if (!onRetry || isRetrying) return;
    setIsRetrying(true);
    setRetryError(null);
    try {
      await onRetry(index);
    } catch (err: any) {
      setRetryError(err?.message || "Failed to retry OCR");
    } finally {
      setIsRetrying(false);
    }
  };

  // Determine image source (from base64 or stored URL)
  const imageSrc =
    question.imageUrl ||
    (question.imageBase64
      ? `data:${question.imageMimeType || "image/jpeg"};base64,${question.imageBase64}`
      : null);

  const difficultyColors = {
    Easy: "bg-emerald-50 text-emerald-800 border-emerald-300",
    Medium: "bg-amber-50 text-amber-800 border-amber-300",
    Hard: "bg-red-50 text-red-800 border-red-300",
  };

  const diffClass =
    difficultyColors[question.difficulty || "Medium"] || difficultyColors.Medium;

  return (
    <div className="bg-white border-2 border-slate-900 shadow-hard-sm mb-6 transition-transform">
      {/* Top Header Bar */}
      <div className="border-b border-slate-900 bg-slate-100 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-mono font-bold text-xs bg-slate-900 text-white px-2.5 py-1">
            Q{String(question.questionNumber || index + 1).padStart(2, "0")}
          </span>
          {question.topic && (
            <span className="font-mono text-xs text-slate-700 bg-white border border-slate-300 px-2 py-0.5 uppercase">
              {question.topic}
            </span>
          )}
          <span
            className={`font-mono text-xs px-2 py-0.5 border uppercase font-medium ${diffClass}`}
          >
            [ {question.difficulty || "MEDIUM"} ]
          </span>
          {currentCorrectIndices.length > 1 && (
            <span className="font-mono text-xs text-blue-700 bg-blue-50 border border-blue-300 px-2 py-0.5 uppercase font-bold">
              [ MULTI-ANSWER ({currentCorrectIndices.length}) ]
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onRetry && (imageSrc || question.topic === "Review Needed") && (
            <button
              type="button"
              onClick={handleRetryOcr}
              disabled={isRetrying}
              className="px-2.5 py-1 text-xs font-mono font-bold border border-blue-600 bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white transition-colors flex items-center gap-1.5 disabled:opacity-50"
              title="Re-run AI Multimodal OCR and solving for this question"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? "animate-spin" : ""}`} />
              <span>{isRetrying ? "[ RETRYING... ]" : "[ RETRY OCR / SOLVE ]"}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsEditing(!isEditing)}
            className="px-2.5 py-1 text-xs font-mono font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-200"
          >
            {isEditing ? "[ DONE EDITING ]" : "[ EDIT TEXT ]"}
          </button>
          <button
            type="button"
            onClick={() => onDelete(index)}
            className="p-1 text-slate-500 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-300"
            title="Delete question"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Error Banner if OCR/Solve failed or on Retry failure */}
      {(retryError ||
        (question.topic === "Review Needed" &&
          question.explanation?.includes("Failed to auto-generate"))) && (
        <div className="bg-red-50 border-b-2 border-red-400 p-3 text-xs font-mono text-red-800 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold uppercase text-red-900 block">
              {retryError ? "[ RETRY FAILED ]" : "[ AUTO-GENERATION FAILED ]"}
            </span>
            <p className="leading-relaxed">
              {retryError || question.explanation}
            </p>
          </div>
        </div>
      )}

      <div className="p-4 sm:p-6 space-y-4">
        {/* View Switcher: Enhanced Image vs Digitized Text & Math (LaTeX) */}
        {(imageSrc || question.transcribedText) && (
          <div className="border border-slate-300 bg-slate-50 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
              <div className="flex items-center gap-1 font-mono text-xs">
                {imageSrc && (
                  <button
                    type="button"
                    onClick={() => setViewMode("image")}
                    className={`flex items-center gap-1 px-3 py-1 font-bold border transition-colors ${
                      viewMode === "image"
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                    }`}
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    [ ENHANCED IMAGE ]
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setViewMode("text")}
                  className={`flex items-center gap-1 px-3 py-1 font-bold border transition-colors ${
                    viewMode === "text"
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5 text-blue-500" />
                  [ DIGITIZED TEXT / LATEX ]
                </button>
              </div>

              {viewMode === "image" && imageSrc ? (
                <button
                  type="button"
                  onClick={() => setShowImageModal(true)}
                  className="text-[11px] font-mono text-blue-600 hover:underline"
                >
                  [ Expand Full Image ]
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCopyText}
                  className="text-xs font-mono text-blue-600 hover:underline flex items-center gap-1"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-600" />
                      <span className="text-emerald-700">[ COPIED ]</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>[ COPY TEXT ]</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* View Content */}
            {viewMode === "image" && imageSrc ? (
              <div className="max-h-80 overflow-hidden flex items-center justify-center bg-white border border-slate-200 p-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageSrc}
                  alt={`Question ${question.questionNumber} visual reference`}
                  className="max-h-80 max-w-full object-contain cursor-pointer"
                  onClick={() => setShowImageModal(true)}
                  title="Click to expand"
                />
              </div>
            ) : (
              <div className="bg-white border border-slate-200 p-3 max-h-80 overflow-y-auto break-words">
                <span className="text-[11px] font-mono uppercase text-slate-400 block mb-1 font-semibold">
                  Verbatim OCR & Math (LaTeX) Extraction:
                </span>
                <LatexRenderer
                  content={question.transcribedText || question.questionText}
                  className="text-xs font-mono text-slate-900 break-words"
                />
              </div>
            )}
          </div>
        )}

        {/* Question Text Prompt */}
        <div>
          <label className="block text-xs font-mono uppercase text-slate-500 mb-1 font-semibold">
            Question Prompt:
          </label>
          {isEditing ? (
            <textarea
              value={question.questionText}
              onChange={(e) => handleTextChange("questionText", e.target.value)}
              rows={3}
              className="w-full border-2 border-slate-900 p-2.5 text-sm font-sans focus:outline-none"
            />
          ) : (
            <div className="text-sm font-medium text-slate-900 leading-relaxed bg-slate-50 border border-slate-200 p-3 max-h-72 overflow-y-auto break-words">
              <LatexRenderer content={question.questionText} />
            </div>
          )}
        </div>

        {/* Options Grid */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <label className="block text-xs font-mono uppercase text-slate-500 font-semibold">
              Options (Click checkbox to select one or multiple correct answers):
            </label>
            {currentCorrectIndices.length > 1 && (
              <span className="text-[11px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-300 px-2 py-0.5 font-bold uppercase">
                {currentCorrectIndices.length} CORRECT ANSWERS SELECTED
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {question.options.map((option, optIdx) => {
              const isCorrect = currentCorrectIndices.includes(optIdx);
              return (
                <div
                  key={optIdx}
                  onClick={() => handleToggleCorrectOption(optIdx)}
                  className={`p-3 border flex items-start gap-2.5 transition-colors cursor-pointer ${
                    isCorrect
                      ? "border-emerald-600 bg-emerald-50 text-emerald-950 font-medium"
                      : "border-slate-300 bg-white hover:bg-slate-50 text-slate-800"
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleCorrectOption(optIdx);
                    }}
                    className={`shrink-0 w-5 h-5 flex items-center justify-center font-mono text-xs font-bold border transition-colors ${
                      isCorrect
                        ? "bg-emerald-600 border-emerald-600 text-white"
                        : "border-slate-400 bg-white text-slate-600 hover:border-slate-900"
                    }`}
                    title={isCorrect ? "Correct answer (click to deselect)" : "Click to select as correct answer"}
                  >
                    {isCorrect ? (
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    ) : (
                      optionLetters[optIdx]
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input
                        type="text"
                        value={option}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => handleOptionChange(optIdx, e.target.value)}
                        className="w-full text-xs border border-slate-300 px-2 py-1 bg-white focus:outline-none focus:border-slate-900"
                      />
                    ) : (
                      <div className="text-xs break-words">
                        <LatexRenderer content={option} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Explanation Accordion */}
        <div className="border border-slate-300 bg-slate-50">
          <button
            type="button"
            onClick={() => setShowExplanation(!showExplanation)}
            className="w-full px-3 py-2 flex items-center justify-between text-xs font-mono text-slate-700 font-bold hover:bg-slate-100 uppercase"
          >
            <span>Solution & Step-by-Step Explanation</span>
            {showExplanation ? (
              <ChevronUp className="w-4 h-4 text-slate-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-500" />
            )}
          </button>

          {showExplanation && (
            <div className="p-3 border-t border-slate-200 bg-white">
              {isEditing ? (
                <textarea
                  value={question.explanation}
                  onChange={(e) => handleTextChange("explanation", e.target.value)}
                  rows={4}
                  className="w-full border border-slate-300 p-2 text-xs font-mono focus:outline-none focus:border-slate-900"
                />
              ) : (
                <div className="text-xs text-slate-800 leading-relaxed space-y-1 max-h-72 overflow-y-auto break-words">
                  <LatexRenderer content={question.explanation || "No explanation provided."} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Edit Metadata Drawer */}
        {isEditing && (
          <div className="pt-2 border-t border-slate-200 flex flex-wrap gap-4">
            <div className="flex-1 min-w-[150px]">
              <label className="block text-[11px] font-mono uppercase text-slate-500 font-semibold mb-1">
                Topic:
              </label>
              <input
                type="text"
                value={question.topic || ""}
                onChange={(e) => handleTextChange("topic", e.target.value)}
                className="w-full text-xs font-mono border border-slate-300 px-2 py-1 bg-white focus:outline-none focus:border-slate-900"
              />
            </div>
            <div className="w-32">
              <label className="block text-[11px] font-mono uppercase text-slate-500 font-semibold mb-1">
                Difficulty:
              </label>
              <select
                value={question.difficulty || "Medium"}
                onChange={(e) => handleTextChange("difficulty", e.target.value)}
                className="w-full text-xs font-mono border border-slate-300 px-2 py-1 bg-white focus:outline-none focus:border-slate-900"
              >
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Image Zoom Modal */}
      {showImageModal && imageSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowImageModal(false)}
        >
          <div
            className="bg-white border-2 border-slate-900 max-w-4xl max-h-[90vh] overflow-hidden p-2 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 px-2">
              <span className="font-mono text-xs font-bold text-slate-900">
                Question {question.questionNumber} - Original Reference Image
              </span>
              <button
                type="button"
                onClick={() => setShowImageModal(false)}
                className="p-1 hover:bg-slate-100 text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-auto p-2 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageSrc}
                alt={`Question ${question.questionNumber} full view`}
                className="max-h-[80vh] max-w-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

