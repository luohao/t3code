import { act, cloneElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { afterEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ subagents: [] as unknown[] }));
vi.mock("../../state/entities", () => ({
  useThreadProjection: () => ({ projection: { subagents: state.subagents } }),
}));
vi.mock("./ThreadRelationshipIcon", () => ({
  ThreadRelationshipIcon: () => null,
  threadRelationshipStatusLabel: (status: string) => status,
}));
vi.mock("./AgentElapsed", () => ({ AgentElapsed: () => null }));
vi.mock("../ui/button", () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

import { WorkflowAgentsPanel } from "./WorkflowAgentsPanel";

let renderer: ReactTestRenderer;
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  state.subagents = [];
});

it("shows new workflow agents, live transitions, failures, and bounded expandable fleets", async () => {
  const now = DateTime.makeUnsafe("2026-10-03T12:00:00Z");
  const workflow = {
    id: "workflow",
    title: "Review",
    prompt: "Review",
    model: "claude-sonnet-4-6",
    status: "running",
    result: null,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    workflow: {
      name: "review",
      phases: [{ index: 0, title: "Review phase" }],
      agents: Array.from({ length: 8 }, (_, index) => ({
        index,
        title: `Reviewer ${index}`,
        status: "running",
        phaseIndex: 0,
        startedAt: "2026-10-03T12:00:00Z",
        completedAt: null,
        lastToolName: "Read",
      })),
    },
  };
  const panel = (
    <WorkflowAgentsPanel
      environmentId={EnvironmentId.make("test")}
      threadId={ThreadId.make("thread")}
    />
  );
  await act(async () => {
    renderer = create(panel);
  });
  expect(renderer.toJSON()).toBeNull();
  state.subagents = [workflow];
  await act(async () => renderer.update(cloneElement(panel)));
  const text = () =>
    renderer.root
      .findAll((node) => typeof node.type === "string")
      .flatMap((node) => node.children.filter((child) => typeof child === "string"))
      .join(" ");
  expect(text()).toContain("Reviewer 0");
  expect(text()).toContain("running");
  expect(text()).toContain("Review phase");
  expect(text()).toContain("claude-sonnet-4-6");
  expect(text()).not.toContain("Reviewer 7");
  await act(async () =>
    renderer.root
      .findAllByType("button")
      .find((button) => button.children.join("").includes("more agents"))!
      .props.onClick(),
  );
  expect(text()).toContain("Reviewer 7");

  state.subagents = [
    {
      ...workflow,
      workflow: {
        ...workflow.workflow,
        agents: workflow.workflow.agents.map((agent, index) =>
          index === 0
            ? {
                ...agent,
                status: "failed",
                error: "Read failed",
                completedAt: "2026-10-03T12:01:00Z",
              }
            : agent,
        ),
      },
    },
  ];
  await act(async () => renderer.update(cloneElement(panel)));
  expect(text()).toContain("1 failed");
  expect(text()).toContain("Read failed");
  await act(async () => renderer.root.findByProps({ "aria-expanded": true }).props.onClick());
  expect(text()).not.toContain("Reviewer 0");
  await act(async () => renderer.root.findByProps({ "aria-expanded": false }).props.onClick());
  expect(text()).toContain("Reviewer 0");
});
