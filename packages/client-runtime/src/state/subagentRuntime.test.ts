import { expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import { IsoDateTime, NonNegativeInt } from "@t3tools/contracts";

import { projectedSubagentsToRuntime, workflowStagesFromSubagent } from "./subagentRuntime.ts";

const now = DateTime.makeUnsafe("2026-10-03T12:00:00Z");
const coordinator: Parameters<typeof projectedSubagentsToRuntime>[0][number] = {
  id: "coordinator",
  title: "Review workflow",
  prompt: "Review the change",
  model: "claude-sonnet-4-6",
  status: "running",
  result: null,
  startedAt: now,
  completedAt: null,
  updatedAt: now,
  workflow: {
    name: "review",
    phases: [{ index: NonNegativeInt.make(0), title: "Review" }],
    agents: [
      {
        index: NonNegativeInt.make(0),
        title: "Reviewer",
        status: "running",
        phaseIndex: NonNegativeInt.make(0),
        startedAt: IsoDateTime.make("2026-10-03T12:00:00Z"),
        completedAt: null,
      },
      {
        index: NonNegativeInt.make(1),
        title: "Verifier",
        status: "pending",
        startedAt: null,
        completedAt: null,
      },
      {
        index: NonNegativeInt.make(2),
        title: "Failed reviewer",
        status: "failed",
        error: "Read failed",
        startedAt: IsoDateTime.make("2026-10-03T11:59:00Z"),
        completedAt: IsoDateTime.make("2026-10-03T12:00:00Z"),
      },
    ],
  },
};

it("projects stable workflow member identities and their phase and model", () => {
  const agents = projectedSubagentsToRuntime([coordinator]);
  expect(agents[0]?.kind).toBe("workflow");
  expect(agents[1]).toMatchObject({
    id: "coordinator:wf:0",
    kind: "workflow_agent",
    parentAgentId: "coordinator",
    title: "Reviewer",
    model: "claude-sonnet-4-6",
    phaseTitle: "Review",
    status: "running",
  });
});

it.each(["completed", "cancelled", "failed", "interrupted"] as const)(
  "settles unfinished members when the workflow is %s without replacing a member's failure",
  (status) => {
    const agents = projectedSubagentsToRuntime([{ ...coordinator, status, completedAt: now }]);
    expect(agents[1]?.status).toBe(status);
    expect(agents[2]?.status).toBe("cancelled");
    expect(agents[3]).toMatchObject({ status: "failed", error: "Read failed" });
    expect(agents.slice(1).every((agent) => agent.completedAt !== null)).toBe(true);
  },
);

it("does not leave paused members running or change ordinary agent projections", () => {
  const paused = projectedSubagentsToRuntime([{ ...coordinator, status: "idle" }]);
  expect(paused[1]?.status).toBe("idle");
  expect(paused[2]?.status).toBe("idle");
  const { workflow: _workflow, ...ordinary } = coordinator;
  const agents = projectedSubagentsToRuntime([ordinary]);
  expect(agents).toHaveLength(1);
  expect(agents[0]).toMatchObject({ kind: "subagent", parentAgentId: null, status: "running" });
});

type Workflow = NonNullable<typeof coordinator.workflow>;
function task(index: number, title: string, fields: Partial<Workflow["agents"][number]> = {}) {
  return {
    index: NonNegativeInt.make(index),
    title,
    status: "running" as const,
    startedAt: IsoDateTime.make("2026-10-03T12:00:00Z"),
    completedAt: null,
    ...fields,
  };
}

it("orders declared and observed stages, retaining completed tasks and empty future stages", () => {
  const stages = workflowStagesFromSubagent({
    ...coordinator,
    workflow: {
      name: "evaluation",
      phases: [
        { index: NonNegativeInt.make(2), title: "Report" },
        { index: NonNegativeInt.make(0), title: "Explore" },
      ],
      agents: [
        task(0, "Read data", { phaseIndex: NonNegativeInt.make(0), status: "completed" }),
        task(1, "Evaluate", { phaseIndex: NonNegativeInt.make(1), phaseTitle: "Run" }),
        task(2, "Prepare report"),
      ],
    },
  });
  expect(stages.map((stage) => [stage.index, stage.title, stage.status])).toEqual([
    [0, "Explore", "completed"],
    [1, "Run", "running"],
    [2, "Report", "pending"],
    [null, "Tasks", "running"],
  ]);
  expect(stages[0]?.tasks[0]).toMatchObject({
    id: "coordinator:wf:0",
    title: "Read data",
    status: "completed",
  });
  expect(stages[2]?.tasks).toEqual([]);
  expect(stages.flatMap((stage) => stage.tasks).map((agent) => agent.agentIndex)).toEqual([
    0, 1, 2,
  ]);
});

it("groups title-only metadata without guessing ambiguous stage membership", () => {
  const stages = workflowStagesFromSubagent({
    ...coordinator,
    workflow: {
      name: "review",
      phases: [
        { index: NonNegativeInt.make(0), title: "Review" },
        { index: NonNegativeInt.make(1), title: "Review" },
        { index: NonNegativeInt.make(2), title: "Verify" },
      ],
      agents: [
        task(0, "Check output", { phaseTitle: "Verify" }),
        task(1, "Review output", { phaseTitle: "Review" }),
        task(2, "Unknown indexed task", { phaseIndex: NonNegativeInt.make(3) }),
        task(3, "Unknown stage title", { phaseTitle: "  " }),
      ],
    },
  });
  expect(stages.map((stage) => [stage.index, stage.title, stage.tasks.length])).toEqual([
    [0, "Review", 0],
    [1, "Review", 0],
    [2, "Verify", 1],
    [3, "Stage 4", 1],
    [null, "Review", 1],
    [null, "Tasks", 1],
  ]);
});

it.each([
  ["running", "failed", "running"],
  ["waiting", "pending", "waiting"],
  ["pending", "completed", "pending"],
  ["completed", "completed", "completed"],
  ["failed", "completed", "failed"],
  ["cancelled", "completed", "cancelled"],
] as const)("summarizes %s and %s tasks as %s", (first, second, expected) => {
  const stages = workflowStagesFromSubagent({
    ...coordinator,
    workflow: {
      name: "review",
      phases: [],
      agents: [task(0, "First", { status: first }), task(1, "Second", { status: second })],
    },
  });
  expect(stages[0]?.status).toBe(expected);
});

it("retains member identities when late metadata moves tasks into their stage", () => {
  const before = workflowStagesFromSubagent({
    ...coordinator,
    workflow: { name: "review", phases: [], agents: [task(0, "Reviewer")] },
  });
  const after = workflowStagesFromSubagent({
    ...coordinator,
    workflow: {
      name: "review",
      phases: [{ index: NonNegativeInt.make(0), title: "Review" }],
      agents: [task(0, "Reviewer", { phaseIndex: NonNegativeInt.make(0) })],
    },
  });
  expect(before[0]?.index).toBeNull();
  expect(after[0]?.index).toBe(0);
  expect(after[0]?.tasks[0]?.id).toBe(before[0]?.tasks[0]?.id);
  expect(after.flatMap((stage) => stage.tasks)).toHaveLength(1);
  expect(workflowStagesFromSubagent({ ...coordinator, workflow: undefined })).toEqual([]);
  expect(
    workflowStagesFromSubagent({
      ...coordinator,
      workflow: { name: "review", phases: [], agents: [] },
    }),
  ).toEqual([]);
});
