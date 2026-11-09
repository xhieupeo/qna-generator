export type DifficultyLevel = "Easy" | "Medium" | "Hard";

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
  correctOptionIndex: number;
  explanation: string;
  topic?: string;
  difficulty?: DifficultyLevel;
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
}

export interface ExtractedUnit {
  id: string;
  questionNumber?: number;
  rawText: string;
  images: ExtractedImage[];
  communityAnswer?: string | null;
}

export interface QuizAttempt {
  id: string;
  quizId: string;
  score: number;
  total: number;
  userAnswers: Record<number, number>; // questionIndex -> selectedOptionIndex
  completedAt: string;
}

