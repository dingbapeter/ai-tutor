"use client";

import katex from "katex";
import { useMemo } from "react";

/**
 * Renders tutor text with LaTeX math — the models naturally emit
 * \( inline \), \[ display \], and $$ display $$ forms. Non-math text is
 * escaped; only KaTeX's vetted HTML is injected.
 */
const MATH_SPLIT = /(\\\[[\s\S]+?\\\]|\\\((?:[\s\S]+?)\\\)|\$\$[\s\S]+?\$\$)/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default function MathText({ text }: { text: string }) {
  const html = useMemo(() => {
    return text
      .split(MATH_SPLIT)
      .map((part) => {
        const display = (part.startsWith("\\[") && part.endsWith("\\]")) || (part.startsWith("$$") && part.endsWith("$$"));
        const inline = part.startsWith("\\(") && part.endsWith("\\)");
        if (!display && !inline) return escapeHtml(part);
        const body = display
          ? part.startsWith("$$")
            ? part.slice(2, -2)
            : part.slice(2, -2)
          : part.slice(2, -2);
        try {
          return katex.renderToString(body, { displayMode: display, throwOnError: false });
        } catch {
          return escapeHtml(part);
        }
      })
      .join("");
  }, [text]);

  return <span style={{ whiteSpace: "pre-wrap" }} dangerouslySetInnerHTML={{ __html: html }} />;
}
