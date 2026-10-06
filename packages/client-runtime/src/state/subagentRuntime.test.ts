import { expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import { IsoDateTime, NonNegativeInt } from "@t3tools/contracts";

import { projectedSubagentsToRuntime } from "./subagentRuntime.ts";

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
