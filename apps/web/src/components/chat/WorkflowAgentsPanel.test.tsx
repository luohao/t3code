// @vitest-environment jsdom
import { act, cloneElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnvironmentId, IsoDateTime, NonNegativeInt, ThreadId } from "@t3tools/contracts";
import type { workflowStagesFromSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import * as DateTime from "effect/DateTime";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

type WorkflowProjection = Parameters<typeof workflowStagesFromSubagent>[0];
const state = vi.hoisted(() => ({ subagents: [] as WorkflowProjection[] }));
vi.mock("../../state/entities", () => ({
  useThreadProjection: () => ({ projection: { subagents: state.subagents } }),
}));
vi.mock("./AgentElapsed", () => ({ AgentElapsed: () => null }));

import { WorkflowAgentsPanel } from "./WorkflowAgentsPanel";

const now = DateTime.makeUnsafe("2026-10-03T12:00:00Z");
const panel = (
  <WorkflowAgentsPanel
    environmentId={EnvironmentId.make("test")}
    threadId={ThreadId.make("thread")}
  />
);
function workflow(name = "review"): WorkflowProjection {
  return {
    id: name,
    title: name,
    prompt: "Review",
    model: "claude-sonnet-4-6",
    status: "running",
    result: null,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    workflow: {
      name,
      phases: [{ index: NonNegativeInt.make(0), title: "Review phase" }],
      agents: Array.from({ length: 8 }, (_, index) => ({
        index: NonNegativeInt.make(index),
        title: `Reviewer ${index}`,
        status: "running",
        phaseIndex: NonNegativeInt.make(0),
        startedAt: IsoDateTime.make("2026-10-03T12:00:00Z"),
        completedAt: null,
        lastToolName: "Read",
      })),
    },
  };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  state.subagents = [];
  vi.unstubAllGlobals();
});

async function render(subagents: WorkflowProjection[]) {
  state.subagents = subagents;
  await act(async () => root.render(cloneElement(panel)));
}

function button(text: string, scope: ParentNode = host) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((element) =>
    element.textContent?.includes(text),
  );
  if (!found) throw new Error(`No button matching ${text}`);
  return found;
}

async function click(element: HTMLButtonElement) {
  await act(async () => element.click());
}

it("shows live stages, pages tasks, and keeps failures visible within ongoing workflows", async () => {
  await render([]);
  expect(host.textContent).toBe("");
  const active = workflow();
  await render([active]);
  expect(host.textContent).toContain("Reviewer 0");
  expect(host.textContent).toContain("Running");
  expect(host.textContent).toContain("Review phase");
  expect(host.textContent).toContain("claude-sonnet-4-6");
  expect(host.textContent).not.toContain("Reviewer 7");
  await click(button("more tasks"));
  expect(host.textContent).toContain("Reviewer 7");
  await click(button("Review phase"));
  expect(host.textContent).not.toContain("Reviewer 0");
  await click(button("Review phase"));
  expect(host.textContent).toContain("Reviewer 0");

  await render([
    {
      ...active,
      workflow: {
        ...active.workflow!,
        agents: active.workflow!.agents.map((agent, index) =>
          index === 0
            ? {
                ...agent,
                status: "failed",
                error: "Read failed",
                completedAt: IsoDateTime.make("2026-10-03T12:01:00Z"),
              }
            : agent,
        ),
      },
    },
  ]);
  expect(host.textContent).toContain("1 failed");
  expect(host.textContent).toContain("Read failed");
  await click(button("review"));
  expect(host.textContent).not.toContain("Reviewer 0");
  await click(button("review"));
  expect(host.textContent).toContain("Reviewer 0");
});

it.each(["completed", "failed", "cancelled", "interrupted"] as const)(
  "hides %s workflows even when their last member snapshot says running",
  async (status) => {
    const finished = { ...workflow("finished-workflow"), status, completedAt: now };
    await render([workflow("ongoing-workflow"), finished]);
    expect(host.textContent).toContain("ongoing-workflow");
    expect(host.textContent).not.toContain("finished-workflow");
    await render([finished, { ...workflow("ordinary-agent"), workflow: undefined }]);
    expect(host.textContent).toBe("");
  },
);

it.each(["pending", "running", "waiting", "idle"] as const)(
  "retains %s workflows while the coordinator is unfinished",
  async (status) => {
    const active = workflow();
    await render([
      {
        ...active,
        status,
        workflow: {
          ...active.workflow!,
          agents: active.workflow!.agents.map((agent) => ({
            ...agent,
            status: "completed",
            completedAt: IsoDateTime.make("2026-10-03T12:01:00Z"),
          })),
        },
      },
    ]);
    expect(host.textContent).toContain("Reviewer 0");
    expect(host.textContent).toContain("Done");
    if (status === "idle") expect(host.textContent).toContain("Paused");
  },
);

it("shows stages in native order, completed tasks, empty stages and unassigned tasks", async () => {
  const active = workflow();
  await render([
    {
      ...active,
      workflow: {
        name: "evaluation",
        phases: [
          { index: NonNegativeInt.make(2), title: "Report" },
          { index: NonNegativeInt.make(0), title: "Explore" },
        ],
        agents: [
          { ...active.workflow!.agents[0]!, title: "Read data", status: "completed" },
          {
            ...active.workflow!.agents[1]!,
            title: "Run tests",
            phaseIndex: NonNegativeInt.make(1),
            phaseTitle: "Evaluate",
          },
          { ...active.workflow!.agents[2]!, title: "Monitor output", phaseIndex: undefined },
        ],
      },
    },
  ]);
  const stages = host.querySelector('ol[aria-label="Stages in evaluation"]')!;
  expect([...stages.children].map((stage) => stage.querySelector("button")?.textContent)).toEqual([
    expect.stringContaining("Explore"),
    expect.stringContaining("Evaluate"),
    expect.stringContaining("Report"),
    expect.stringContaining("Tasks"),
  ]);
  const explore = stages.querySelector('ul[aria-label="Tasks in Explore"]')!;
  expect(explore.textContent).toContain("Read data");
  expect(explore.textContent).toContain("Done");
  expect(explore.textContent).not.toContain("Run tests");
  expect(stages.textContent).toContain("No tasks yet");
  expect(stages.textContent).toContain("Monitor output");
});

it("opens the live graph with all tasks, closes it and removes it when the workflow finishes", async () => {
  const active = workflow();
  await render([active]);
  expect(host.textContent).not.toContain("Reviewer 7");
  await click(button("View graph"));
  let dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Reviewer 7");
  expect(dialog.textContent).toContain("Arrows show stage order");

  await render([
    {
      ...active,
      workflow: {
        ...active.workflow!,
        agents: active.workflow!.agents.map((agent, index) =>
          index === 7 ? { ...agent, lastToolName: "Write" } : agent,
        ),
      },
    },
  ]);
  dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Write");
  await click(dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click(button("View graph"));
  await render([{ ...active, status: "completed", completedAt: now }]);
  expect(host.textContent).toBe("");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("keeps a newly started workflow visible before stage metadata arrives", async () => {
  const active = workflow();
  await render([{ ...active, workflow: { name: "review", phases: [], agents: [] } }]);
  expect(host.textContent).toContain("Waiting for workflow stages and tasks");
  await render([active]);
  expect(host.textContent).toContain("Review phase");
  expect(host.textContent).toContain("Reviewer 0");
});
