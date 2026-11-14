export type DifficultyLevel = "Easy" | "Medium" | "Hard";
export type ViewMode = "auto" | "image" | "text" | "split";

export interface Question {
  id?: string;
  quizId?: string;
  questionNumber: number;
  questionText: string;
  transcribedText?: string | null;
  imageUrl?: string | null;
  imageBase64?: string | null;
  imageMimeType?: string | null;
  options: string[];
  correctOptionIndex?: number; // Single choice index (0-based) for backward compatibility
  correctOptionIndices: number[]; // Array of correct option indices (e.g. [0] or [0, 2] for multiple answers)
  explanation: string;
  topic?: string;
  difficulty?: DifficultyLevel;
  preferredViewMode?: ViewMode; // Preference for Image vs Text display
}

export interface Quiz {
  id: string;
  title: string;
  sourceFilename?: string;
  totalQuestions: number;
  createdAt: string;
  updatedAt: string;
  questions?: Question[];
}

export interface ExtractedImage {
  id: string;
  mimeType: string;
  base64Data: string;
  src?: string;
  fallbackSrc?: string;
}

export interface ExtractedUnit {
  id: string;
  questionNumber?: number;
  rawText: string;
  images: ExtractedImage[];
  communityAnswer?: string | null;
  imageError?: string;
}

export interface QuizAttempt {
  id: string;
  quizId: string;
  score: number;
  total: number;
  userAnswers: Record<number, number[]>; // questionIndex -> array of selected option indices (e.g. [0] or [0, 2])
  completedAt: string;
}

