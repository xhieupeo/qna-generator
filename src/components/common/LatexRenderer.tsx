"use client";

import React, { useMemo } from "react";
import katex from "katex";

interface LatexRendererProps {
  content: string;
  className?: string;
}

interface Segment {
  type: "text" | "inline-math" | "block-math" | "code-block" | "inline-code";
  raw: string;
  lang?: string;
}

/**
 * Parses markdown code blocks, inline code, and LaTeX math ($...$, $$...$$, \[...\], \(...\))
 * into structured segments for rendering.
 */
function parseSegments(rawText: string): Segment[] {
  if (!rawText) return [];

  const segments: Segment[] = [];
  let remaining = rawText;

  // Regex to match code blocks, display math, inline math, and inline code
  // 1. Code blocks: ```[lang]?\n[\s\S]*?```
  // 2. Block math: \$\$[\s\S]*?\$\$ OR \\\[[\s\S]*?\\\]
  // 3. Inline math: \$[^\$\n]+?\$ OR \\\([^\)]+?\\\)
  // 4. Inline code: `[^`\n]+`
  const tokenRegex = /(```(\w*)\n([\s\S]*?)```)|(\$\$([\s\S]*?)\$\$)|(\\\[([\s\S]*?)\\\])|(\$([^\$\n]+?)\$)|(\\\(([\s\S]*?)\\\))|(`([^`\n]+)`)/;

  while (remaining.length > 0) {
    const match = remaining.match(tokenRegex);
    if (!match || match.index === undefined) {
      segments.push({ type: "text", raw: remaining });
      break;
    }

    if (match.index > 0) {
      segments.push({
        type: "text",
        raw: remaining.slice(0, match.index),
      });
    }

    const fullMatch = match[0];

    if (match[1]) {
      // Code block
      segments.push({
        type: "code-block",
        lang: match[2] || "",
        raw: match[3],
      });
    } else if (match[4]) {
      // Block math $$...$$
      segments.push({
        type: "block-math",
        raw: match[5],
      });
    } else if (match[6]) {
      // Block math \[...\]
      segments.push({
        type: "block-math",
        raw: match[7],
      });
    } else if (match[8]) {
      // Inline math $...$
      segments.push({
        type: "inline-math",
        raw: match[9],
      });
    } else if (match[10]) {
      // Inline math \(...\)
      segments.push({
        type: "inline-math",
        raw: match[11],
      });
    } else if (match[12]) {
      // Inline code `...`
      segments.push({
        type: "inline-code",
        raw: match[13],
      });
    }

    remaining = remaining.slice(match.index + fullMatch.length);
  }

  return segments;
}

export const LatexRenderer: React.FC<LatexRendererProps> = ({
  content,
  className = "",
}) => {
  const segments = useMemo(() => parseSegments(content), [content]);

  return (
    <div className={`latex-content leading-relaxed select-text ${className}`}>
      {segments.map((seg, idx) => {
        if (seg.type === "block-math") {
          let html = "";
          try {
            html = katex.renderToString(seg.raw.trim(), {
              displayMode: true,
              throwOnError: false,
            });
          } catch {
            return (
              <div
                key={idx}
                className="my-2 p-2 bg-slate-100 border border-slate-300 font-mono text-xs overflow-x-auto text-red-600"
              >
                $${seg.raw}$$
              </div>
            );
          }
          return (
            <div
              key={idx}
              className="my-3 overflow-x-auto py-1 px-2 bg-slate-50 border border-slate-200"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        if (seg.type === "inline-math") {
          let html = "";
          try {
            html = katex.renderToString(seg.raw.trim(), {
              displayMode: false,
              throwOnError: false,
            });
          } catch {
            return (
              <span key={idx} className="font-mono text-red-600">
                ${seg.raw}$
              </span>
            );
          }
          return (
            <span
              key={idx}
              className="inline-block px-0.5"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        if (seg.type === "code-block") {
          return (
            <div key={idx} className="my-2 border-2 border-slate-900 bg-slate-950">
              {seg.lang && (
                <div className="bg-slate-900 text-slate-400 font-mono text-[10px] uppercase px-3 py-1 border-b border-slate-800">
                  {seg.lang}
                </div>
              )}
              <pre className="p-3 text-emerald-400 font-mono text-xs overflow-x-auto whitespace-pre">
                <code>{seg.raw}</code>
              </pre>
            </div>
          );
        }

        if (seg.type === "inline-code") {
          return (
            <code
              key={idx}
              className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 text-slate-800 font-mono text-[11px]"
            >
              {seg.raw}
            </code>
          );
        }

        // Plain text: preserve line breaks
        return (
          <span key={idx} className="whitespace-pre-wrap">
            {seg.raw}
          </span>
        );
      })}
    </div>
  );
};
