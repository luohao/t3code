// @vitest-environment jsdom
import katex from "katex";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { chatMarkdownClipboardPayload } from "./markdown-clipboard";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe("copying rendered equations", () => {
  function fixture(source: string, display: boolean) {
    const host = document.createElement("p");
    const equation = document.createElement("span");
    equation.className = display ? "chat-markdown-math-display" : "chat-markdown-math-inline";
    equation.dataset.markdownCopy = source;
    equation.innerHTML = katex.renderToString(String.raw`\frac{1}{2}`, {
      displayMode: display,
      output: "htmlAndMathml",
    });
    host.append("Before ", equation, " after.");
    document.body.append(host);
    return { host, equation };
  }

  it.each([
    [String.raw`$\frac{1}{2}$`, false],
    ["\\[\n\\frac{1}{2}\n\\]", true],
  ] as const)("copies TeX when selecting just one rendered glyph: %s", (source, display) => {
    const { equation } = fixture(source, display);
    const glyph = document
      .createTreeWalker(equation.querySelector(".katex-html")!, NodeFilter.SHOW_TEXT)
      .nextNode()!;
    const range = document.createRange();
    range.selectNodeContents(glyph);
    const selection = window.getSelection()!;
    selection.addRange(range);

    expect(chatMarkdownClipboardPayload(selection)?.text).toBe(source);
  });

  it("copies prose and each equation once without duplicated MathML glyphs", () => {
    const source = String.raw`$\frac{1}{2}$`;
    const { host } = fixture(source, false);
    const range = document.createRange();
    range.selectNodeContents(host);
    const selection = window.getSelection()!;
    selection.addRange(range);

    expect(chatMarkdownClipboardPayload(selection)?.text).toBe(`Before ${source} after.`);
  });
});
