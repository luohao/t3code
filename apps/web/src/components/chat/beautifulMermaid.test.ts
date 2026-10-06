// @vitest-environment jsdom

import { describe, expect, it } from "vite-plus/test";

import { inlineBeautifulMermaidTheme, renderBeautifulMermaid } from "./beautifulMermaid";

function svgElement(svg: string) {
  const host = document.createElement("div");
  host.innerHTML = svg;
  return host.querySelector("svg")!;
}

describe("beautiful Mermaid rendering", () => {
  it.each([
    ["flowchart LR\nStart[Start] --> Finish[Finish]", "Start", "Finish"],
    [
      "%% A leading comment\nsequenceDiagram\nClient->>Server: Request\nNote over Client,Server: Connected",
      "Client",
      "Connected",
    ],
    ["stateDiagram-v2\nIdle --> Running", "Idle", "Running"],
    ["classDiagram\nclass Customer {\n+String name\n}", "Customer", "name"],
    ["erDiagram\nCUSTOMER ||--o{ ORDER : places", "CUSTOMER", "places"],
    ['flowchart TD\nA["Start"] --> B{OK?}\nB -->|Yes| C["Ship"]\nB -->|No| D[Fix]', "Ship", "Fix"],
    ['flowchart LR\nA["Plan"] --> B["Build"]', "Plan", "Build"],
  ])("draws %s in the app theme", async (source, firstLabel, secondLabel) => {
    const svg = svgElement((await renderBeautifulMermaid(source, "diagram-1"))!);
    expect(svg.textContent).toContain(firstLabel);
    expect(svg.textContent).toContain(secondLabel);
    expect(svg.id).toBe("diagram-1");
    expect(svg.dataset.diagramRenderer).toBe("beautiful");
    expect(svg.querySelector("script, foreignObject, image, [style]")).toBeNull();
    // Only the scoped theme remains; the library's global styles are removed.
    const styles = [...svg.querySelectorAll("style")].map((style) => style.textContent);
    expect(styles).toHaveLength(1);
    expect(styles[0]).toMatch(/^#diagram-1\{--bg:var\(--background\);/);
    expect(styles[0]).not.toContain("@import");
  });

  it("treats markup in labels as text and strips remote SVG resources", async () => {
    const svg = svgElement(
      (await renderBeautifulMermaid(
        'flowchart LR\nA["<img src=x onerror=alert>"] --> B[Safe]\nstyle B fill:url(https://example.invalid/pixel)',
        "untrusted",
      ))!,
    );
    expect(svg.dataset.diagramRenderer).toBe("beautiful");
    expect(svg.querySelector("img, script, [onerror], [onload], [href]")).toBeNull();
    expect(svg.outerHTML).not.toContain("https://example.invalid");
    expect(svg.textContent).toContain("Safe");
  });

  it("strips CSS-escaped resource URLs", async () => {
    const svg = svgElement(
      (await renderBeautifulMermaid(
        "flowchart LR\nA[Start] --> B[End]\nstyle B fill:\\75 rl(https://example.invalid/pixel)",
        "escaped",
      ))!,
    );
    expect(svg.dataset.diagramRenderer).toBe("beautiful");
    expect(svg.outerHTML).not.toContain("example.invalid");
  });

  it("gives each render its own marker IDs", async () => {
    const source = "flowchart LR\nA --> B";
    const renders = await Promise.all(
      ["first", "second"].map(async (id) =>
        svgElement((await renderBeautifulMermaid(source, id))!),
      ),
    );
    const allIds: string[] = [];
    for (const svg of renders) {
      const ids = [...svg.querySelectorAll("[id]")].map((element) => element.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every((id) => id.startsWith(`${svg.id}-`))).toBe(true);
      allIds.push(...ids);
      const references = [...svg.querySelectorAll("[marker-end]")].map((element) =>
        element.getAttribute("marker-end")!.slice(5, -1),
      );
      expect(references.length).toBeGreaterThan(0);
      for (const reference of references) expect(ids).toContain(reference);
    }
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it.each([
    'pie title Results\n"Pass" : 9\n"Fail" : 1',
    "---\ntitle: Important title\n---\nflowchart LR\nA-->B",
    '%%{init: {"theme": "neutral"}}%%\nflowchart LR\nA-->B',
    "flowchart LR; A-->B;",
    "flowchart LR\nA-->B",
    "flowchart LR\nfoo-bar-.->baz",
    "flowchart LR\nA ----> B",
    "flowchart LR\nA@{shape: cloud, label: Cloud}",
    "sequenceDiagram\nautonumber\nA->>B: Request",
    "sequenceDiagram\nactivate A\nA->>B: Request\ndeactivate A",
    "classDiagram\nnamespace Account {\nclass User\n}",
    "stateDiagram-v2\nstate forkState <<fork>>\n[*] --> forkState",
    "xychart-beta\nx-axis [Jan, Feb]\nbar [10, 20]",
    "flowchart LR\n%% Nothing to render",
    "flowchart TD\nA[Start] --> B{OK?}\nB --> |Yes| C[Ship]",
    "flowchart LR\nA --o B",
    "flowchart LR\nA --x B",
    "flowchart LR\nA ===> B",
    "flowchart LR\nA ~~~ B",
    'flowchart LR\nA("Start (init)") --> B',
    "flowchart LR\nA & B --> C",
    "sequenceDiagram\nparent->>child: spawn\nchild-->>parent: done",
    "sequenceDiagram\nrect rgb(200, 220, 255)\nA->>B: Request\nend",
    "sequenceDiagram\ncritical Connect\nA->>B: Open\noption Timeout\nA->>B: Retry\nend",
    "sequenceDiagram\nA<<->>B: Sync",
    "classDiagram\nAnimal <|-- Duck\nDuck .. Pond",
    "classDiagram\nA -- B",
    "stateDiagram-v2\nA --> B\nclassDef bad fill:#f00\nclass A bad",
    "stateDiagram-v2\nA:::bad --> B",
    `flowchart LR\n${"A --> B\n".repeat(250)}`,
    `flowchart LR\n${"A --> B\n".repeat(7_000)}`,
  ])("leaves diagrams it cannot draw faithfully to Mermaid: %s", async (source) => {
    await expect(renderBeautifulMermaid(source, "fallback")).resolves.toBeNull();
  });
});

describe("standalone diagram images", () => {
  it("copies the app theme onto beautiful diagrams only", async () => {
    document.body.style.setProperty("--primary", "rgb(1, 2, 3)");
    document.body.style.setProperty("--font-sans", "Test Sans");
    const beautiful = svgElement((await renderBeautifulMermaid("flowchart LR\nA --> B", "image"))!);
    const mermaid = svgElement('<svg id="mermaid-diagram-0"><text>A</text></svg>');

    inlineBeautifulMermaidTheme(beautiful);
    inlineBeautifulMermaidTheme(mermaid);

    expect(beautiful.style.getPropertyValue("--primary")).toBe("rgb(1, 2, 3)");
    expect(beautiful.style.getPropertyValue("--font-sans")).toBe("Test Sans");
    expect(mermaid.getAttribute("style")).toBeNull();
  });
});
