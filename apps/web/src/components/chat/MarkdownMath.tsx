import katex from "katex";
import { memo, useMemo } from "react";
import "katex/dist/katex.min.css";

/** Typeset a formula while retaining authored TeX for copying and invalid-expression fallback. */
export default memo(function MarkdownMath({
  math,
  source,
  display,
}: {
  math: string;
  source: string;
  display: boolean;
}) {
  const html = useMemo(() => {
    // Like Codex's terminal renderer, bound work on model-produced expressions.
    // Oversized formulas still retain their readable, copyable TeX source.
    if (math.length > 4096) return null;
    try {
      return katex.renderToString(math, {
        displayMode: display,
        output: "htmlAndMathml",
        trust: false,
        strict: "ignore",
        maxSize: 20,
        maxExpand: 1000,
      });
    } catch {
      // Partial streamed expressions and unsupported commands stay readable.
      return null;
    }
  }, [math, display]);

  return (
    <span
      className={display ? "chat-markdown-math-display" : "chat-markdown-math-inline"}
      data-markdown-copy={display ? `\n\n${source}\n\n` : source}
    >
      {html === null ? <code>{source}</code> : <span dangerouslySetInnerHTML={{ __html: html }} />}
    </span>
  );
});
