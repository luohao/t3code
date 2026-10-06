import DOMPurify from "dompurify";

const RENDERER_ATTRIBUTE = "data-diagram-renderer";
// Mermaid's default maxTextSize. Mermaid renders its own notice for larger sources.
const MAX_SOURCE_LENGTH = 50_000;
// beautiful-mermaid lays out on the main thread, and the cost grows faster than
// the diagram (about 0.3 s at 300 edges, 7 s at 900). Larger diagrams go to
// Mermaid, which enforces its own edge limit.
const MAX_SOURCE_LINES = 200;
const LOCAL_URL_REFERENCE = /^url\(#([\w-]+)\)$/;

// App variables that the diagram theme reads.
const APP_THEME_VARIABLES = [
  "--background",
  "--foreground",
  "--primary",
  "--font-sans",
  "--font-mono",
] as const;

const mixWithBackground = (percent: number) =>
  `color-mix(in srgb, var(--fg) ${percent}%, var(--bg))`;

// beautiful-mermaid paints with these variables. --bg also masks lines behind
// edge labels, so the diagram paints its own background to match.
const DIAGRAM_THEME_VARIABLES: ReadonlyArray<readonly [string, string]> = [
  ["--bg", "var(--background)"],
  ["--fg", "var(--foreground)"],
  ["--_text", "var(--fg)"],
  ["--_text-sec", mixWithBackground(80)],
  ["--_text-muted", mixWithBackground(75)],
  ["--_text-faint", mixWithBackground(60)],
  ["--_line", mixWithBackground(50)],
  ["--_arrow", "var(--primary)"],
  ["--_node-fill", mixWithBackground(5)],
  ["--_node-stroke", mixWithBackground(25)],
  ["--_group-fill", "var(--bg)"],
  ["--_group-hdr", mixWithBackground(8)],
  ["--_inner-stroke", mixWithBackground(16)],
  ["--_key-badge", mixWithBackground(10)],
];

// Syntax that beautiful-mermaid v1.1.3 accepts but draws wrongly, by diagram header.
const MISDRAWN_SYNTAX: ReadonlyArray<{ readonly header: RegExp; readonly syntax: RegExp }> = [
  // Compact edges (A-->B) lose the edge. A label after a space (A --> |yes| B),
  // circle, cross, long thick and invisible links, and a quoted label holding a
  // closing bracket cut the line short. & fans one line out into many edges.
  {
    header: /^(?:graph|flowchart)\b/i,
    syntax:
      /[\w-](?:--|-\.)|----|====|-\.\.-|(?:-->|---|==>|===|-\.->|-\.-)\s+\||--[ox]\b|={3,}>|~~~|&|[[({]"[^"\n]*[\])}][^"\n]*"/,
  },
  // Block keywords match without a word boundary, so a participant such as
  // parent or parser opens a block. Colour bands and <<->> arrows become text.
  {
    header: /^sequenceDiagram\b/i,
    syntax: /^\s*(?:loop|alt|opt|par|critical|break|rect|else|and)\S|^\s*rect\b|<<-/m,
  },
  // Choice, fork and join states, concurrent regions, and author styling.
  {
    header: /^stateDiagram\b/i,
    syntax: /<<(?:choice|fork|join)>>|^\s*--\s*$|^\s*(?:classDef|class|style)\b|:::|&/m,
  },
  // Bare .. and -- links are dropped or drawn as arrows.
  { header: /^classDiagram\b/i, syntax: /\s(?:\.\.|--)\s/ },
];

/** The source beautiful-mermaid can draw faithfully, or null when Mermaid should render it. */
function supportedSource(code: string): string | null {
  if (code.length > MAX_SOURCE_LENGTH || code.split("\n").length > MAX_SOURCE_LINES) return null;
  // The alternate parser silently skips some Mermaid features. Keep their
  // meaning with Mermaid, including author-supplied configuration.
  if (
    /^\s*%%\{/m.test(code) ||
    /[;`]|@\{|\w+@[-=.]/.test(code) ||
    /^\s*(?:click\b|accTitle\s*:|accDescr\s*[:{]|namespace\b|autonumber\b|activate\b|deactivate\b|box\b|create\b|destroy\b)/im.test(
      code,
    )
  ) {
    return null;
  }
  const source = code
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("%%"))
    .join("\n")
    .trim();
  if (MISDRAWN_SYNTAX.some(({ header, syntax }) => header.test(source) && syntax.test(source))) {
    return null;
  }
  if (!/^sequenceDiagram\b/i.test(source) && /^\s*note\b/im.test(source)) {
    return null;
  }
  // xychart is left out: its colors live in the library's own <style>, which is removed.
  return /^(?:(?:graph|flowchart)\s+(?:TD|TB|LR|RL|BT)|stateDiagram(?:-v2)?|sequenceDiagram|classDiagram|erDiagram)[ \t]*(?:\n|$)/i.test(
    source,
  )
    ? source
    : null;
}

function themeStyle(id: string): string {
  const variables = DIAGRAM_THEME_VARIABLES.map(([name, value]) => `${name}:${value}`).join(";");
  return [
    `#${id}{${variables};background:var(--bg);border-radius:6px}`,
    `#${id} text{font-family:var(--font-sans)}`,
    `#${id} .mono{font-family:var(--font-mono)}`,
  ].join("");
}

/**
 * Draws flowchart, sequence, state, class and ER diagrams with beautiful-mermaid
 * in the app's palette and fonts. Returns null when Mermaid should render the
 * source instead: unsupported syntax, a parse failure, or a failed module load.
 *
 * `id` must be a unique CSS identifier. It names the SVG root, scopes the
 * theme, and prefixes marker IDs so diagrams on one page never share them.
 */
export async function renderBeautifulMermaid(code: string, id: string): Promise<string | null> {
  const source = supportedSource(code);
  if (source === null) return null;
  try {
    const { renderMermaidSVG } = await import("beautiful-mermaid");
    const rawSvg = renderMermaidSVG(source, { font: "system-ui", padding: 24, transparent: true });
    // The library's styles use document-wide selectors and import remote
    // fonts, so they go; themeStyle() supplies scoped rules instead.
    const fragment = DOMPurify.sanitize(rawSvg, {
      USE_PROFILES: { svg: true },
      FORBID_TAGS: ["style", "foreignObject", "image", "a", "use"],
      FORBID_ATTR: ["style", "href", "xlink:href"],
      RETURN_DOM_FRAGMENT: true,
    });
    const svg = fragment.querySelector("svg");
    if (!svg?.querySelector("text")) return null;
    const elements = [svg, ...svg.querySelectorAll("*")];
    for (const element of elements) {
      if (element.id) element.id = `${id}-${element.id}`;
      for (const name of element.getAttributeNames()) {
        const value = element.getAttribute(name) ?? "";
        if (!/url\s*\(|\\/i.test(value)) continue;
        // Keep local marker references. Drop authored URLs, including
        // CSS-escaped ones, which leaves the SVG default.
        const localId = LOCAL_URL_REFERENCE.exec(value)?.[1];
        if (localId === undefined) element.removeAttribute(name);
        else element.setAttribute(name, `url(#${id}-${localId})`);
      }
    }
    svg.id = id;
    svg.setAttribute(RENDERER_ATTRIBUTE, "beautiful");
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = themeStyle(id);
    svg.prepend(style);
    return svg.outerHTML;
  } catch {
    // A valid Mermaid diagram may use syntax the alternate parser lacks.
    return null;
  }
}

/**
 * A standalone diagram image cannot read the app's stylesheet, so this copies
 * the current values of the variables its theme reads onto the SVG root.
 * Mermaid's own output is left unchanged.
 */
export function inlineBeautifulMermaidTheme(svg: Element & ElementCSSInlineStyle): void {
  if (svg.getAttribute(RENDERER_ATTRIBUTE) !== "beautiful") return;
  const appStyle = getComputedStyle(document.body);
  for (const name of APP_THEME_VARIABLES) {
    svg.style.setProperty(name, appStyle.getPropertyValue(name));
  }
}
