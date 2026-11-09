import type { Metadata } from "next";
import Link from "next/link";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "QnA Generator | Multimodal HTML-to-MCQ Platform",
  description: "Transform HTML documents with images into verified multiple choice questions with automated solving via Gemini AI.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased flex flex-col font-sans">
        {/* Top Navigation Bar - Flat, solid, zero radius */}
        <header className="border-b border-slate-900 bg-white sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <Link href="/" className="flex items-center gap-2 group">
                <div className="w-8 h-8 bg-slate-900 text-white flex items-center justify-center font-mono font-bold text-sm border border-slate-900 group-hover:bg-blue-600 transition-colors">
                  Q
                </div>
                <div className="flex flex-col">
                  <span className="font-bold tracking-tight text-slate-900 text-base leading-none">
                    QnA GENERATOR
                  </span>
                  <span className="text-[10px] font-mono text-slate-500 tracking-wider uppercase mt-1">
                    Multimodal MCQ Engine
                  </span>
                </div>
              </Link>

              <nav className="hidden md:flex items-center gap-1 border-l border-slate-200 pl-6">
                <Link
                  href="/"
                  className="px-3 py-1.5 text-xs font-mono font-medium uppercase text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                >
                  [ Generator ]
                </Link>
                <Link
                  href="/library"
                  className="px-3 py-1.5 text-xs font-mono font-medium uppercase text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                >
                  [ Supabase Library ]
                </Link>
              </nav>
            </div>

            <div className="flex items-center gap-3">
            </div>
          </div>
        </header>

        {/* Main Content Viewport */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>

        {/* Technical Footer */}
        <footer className="border-t border-slate-900 bg-white py-6 mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs font-mono text-slate-500">
            <div>
              <span>QNA-GENERATOR</span> &bull; <span>NEXT.JS + GEMINI + SUPABASE</span>
            </div>
            <div className="flex items-center gap-4">
              <span>ZERO GRADIENTS</span>
              <span>&bull;</span>
              <span>ZERO RADIUS</span>
              <span>&bull;</span>
              <span>STRICT SCHEMA</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}

