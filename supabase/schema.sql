-- ==============================================================================
-- Supabase Schema for QnA Generator (HTML/Image to Multiple Choice Questions)
-- ==============================================================================

-- 1. Create Quizzes / Question Sets table
CREATE TABLE IF NOT EXISTS quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    source_filename TEXT,
    total_questions INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create Questions table
CREATE TABLE IF NOT EXISTS questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    question_number INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    transcribed_text TEXT,                  -- OCR verbatim text with LaTeX & code
    image_url TEXT,                         -- Supabase storage public URL or fallback
    options JSONB NOT NULL,                 -- e.g. ["Choice A", "Choice B", "Choice C", "Choice D"]
    correct_option_index INTEGER DEFAULT 0, -- 0 for A, 1 for B, 2 for C, 3 for D (backward compatibility)
    correct_option_indices JSONB DEFAULT '[]'::jsonb, -- e.g. [0] or [0, 2] for multi-choice / select all that apply
    explanation TEXT NOT NULL,
    topic TEXT,
    difficulty TEXT CHECK (difficulty IN ('Easy', 'Medium', 'Hard')) DEFAULT 'Medium',
    preferred_view_mode VARCHAR(20) DEFAULT 'auto' CHECK (preferred_view_mode IN ('auto', 'image', 'text', 'split')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration for existing databases:
-- ALTER TABLE questions ADD COLUMN IF NOT EXISTS correct_option_indices JSONB DEFAULT '[]'::jsonb;
-- UPDATE questions SET correct_option_indices = jsonb_build_array(correct_option_index) WHERE correct_option_indices = '[]'::jsonb OR correct_option_indices IS NULL;
-- ALTER TABLE questions ADD COLUMN IF NOT EXISTS preferred_view_mode VARCHAR(20) DEFAULT 'auto' CHECK (preferred_view_mode IN ('auto', 'image', 'text', 'split'));
-- UPDATE questions SET preferred_view_mode = 'auto' WHERE preferred_view_mode IS NULL;

-- Index for instant querying by quiz
CREATE INDEX IF NOT EXISTS idx_questions_quiz_id ON questions(quiz_id);

-- 3. Create Quiz Attempts table (Practice / Test history)
CREATE TABLE IF NOT EXISTS quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    user_answers JSONB NOT NULL,
    completed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz_id ON quiz_attempts(quiz_id);

-- ==============================================================================
-- Storage Bucket Instructions:
-- In Supabase Dashboard -> Storage:
-- 1. Create a new public bucket named "quiz-images"
-- 2. Add an RLS policy to allow public reads and authenticated/anon uploads:
-- ==============================================================================
-- INSERT INTO storage.buckets (id, name, public) VALUES ('quiz-images', 'quiz-images', true)
-- ON CONFLICT (id) DO NOTHING;
--
-- CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'quiz-images');
-- CREATE POLICY "Allow Uploads" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'quiz-images');

