import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { claudeWorkflowFromMessage } from "./ClaudeWorkflowProgress.ts";

const now = DateTime.makeUnsafe("2026-10-03T12:00:00Z");
const later = DateTime.makeUnsafe("2026-10-03T12:01:00Z");
function progress(entries: ReadonlyArray<unknown>): SDKMessage {
  return Object.assign(
    {
      type: "system",
      subtype: "task_progress",
      task_id: "workflow",
      description: "Review",
      usage: { total_tokens: 100, tool_uses: 1, duration_ms: 1000 },
      uuid: "00000000-0000-4000-8000-000000000001",
      session_id: "session",
    } satisfies SDKMessage,
    { workflow_progress: entries },
  );
}

describe("Claude workflow member telemetry", () => {
  it("follows native start, progress, and done snapshots with millisecond timestamps", () => {
    // Claude's native roster starts without a start time, then reports epoch
    // milliseconds on every running and completed snapshot.
    const queuedAt = 1791081305405;
    const startedAt = queuedAt + 9;
    const observedAt = DateTime.makeUnsafe(startedAt);
    const finishedAt = DateTime.makeUnsafe(startedAt + 60_000);
    const member = {
      type: "workflow_agent",
      index: 2,
      label: "Implement runtime",
      phaseIndex: 1,
      phaseTitle: "Build",
      model: "claude-sonnet-4-6",
      queuedAt,
    };
    const queued = claudeWorkflowFromMessage(
      progress([{ ...member, state: "start" }]),
      undefined,
      observedAt,
    );
    expect(queued?.agents[0]).toMatchObject({ status: "pending", startedAt: null });

    const started = claudeWorkflowFromMessage(
      progress([{ ...member, state: "start", startedAt, attempt: 1 }]),
      queued,
      observedAt,
    );
    expect(started?.agents[0]).toMatchObject({
      status: "running",
      startedAt: DateTime.formatIso(DateTime.makeUnsafe(startedAt)),
      attempt: 1,
    });

    const active = claudeWorkflowFromMessage(
      progress([
        {
          ...member,
          state: "progress",
          startedAt,
          attempt: 1,
          lastToolName: "Read",
          tokens: 2100,
          toolCalls: 3,
        },
      ]),
      started,
      finishedAt,
    );
    expect(active?.agents[0]).toMatchObject({
      status: "running",
      title: "Implement runtime",
      phaseTitle: "Build",
      lastToolName: "Read",
      usage: { totalTokens: 2100, toolUses: 3 },
    });

    const completed = claudeWorkflowFromMessage(
      progress([{ ...member, state: "done", startedAt, attempt: 1 }]),
      active,
      finishedAt,
    );
    expect(completed?.agents[0]).toMatchObject({
      status: "completed",
      startedAt: DateTime.formatIso(DateTime.makeUnsafe(startedAt)),
      completedAt: DateTime.formatIso(finishedAt),
      usage: { totalTokens: 2100, toolUses: 3 },
    });
    expect(
      claudeWorkflowFromMessage(
        progress([{ ...member, state: "progress", startedAt, attempt: 1 }]),
        completed,
        finishedAt,
      ),
    ).toBe(completed);
  });

  it.each(["progress", "running"])(
    "reports %s even when the native start time is omitted",
    (state) => {
      const active = claudeWorkflowFromMessage(
        progress([{ type: "workflow_agent", index: 0, state, lastToolName: "Read" }]),
        undefined,
        now,
      );
      expect(active?.agents[0]).toMatchObject({ status: "running", startedAt: null });
    },
  );

  it("retains stable slots across retries, ignores late snapshots, and preserves fields omitted by later ticks", () => {
    const first = claudeWorkflowFromMessage(
      progress([
        { type: "workflow_phase", index: 0, title: "Review" },
        {
          type: "workflow_agent",
          index: 0,
          label: "Reviewer",
          state: "error",
          attempt: 1,
          startedAt: "2026-10-03T11:59:00Z",
          model: "claude-sonnet-4-6",
          error: "Read failed",
        },
      ]),
      undefined,
      now,
    );
    expect(first?.agents[0]?.status).toBe("failed");
    const retried = claudeWorkflowFromMessage(
      progress([
        {
          type: "workflow_agent",
          index: 0,
          state: "running",
          attempt: 2,
          startedAt: "2026-10-03T12:00:30Z",
          lastToolName: "Read",
          tokens: 200,
        },
      ]),
      first,
      later,
    );
    expect(retried?.agents).toHaveLength(1);
    expect(retried?.agents[0]).toMatchObject({
      title: "Reviewer",
      status: "running",
      attempt: 2,
      model: "claude-sonnet-4-6",
      lastToolName: "Read",
      completedAt: null,
      usage: { totalTokens: 200 },
    });
    expect(retried?.agents[0]?.error).toBeUndefined();
    expect(retried?.phases).toEqual(first?.phases);
    expect(
      claudeWorkflowFromMessage(
        progress([
          { type: "workflow_agent", index: 0, state: "error", attempt: 1, error: "Old error" },
        ]),
        retried,
        later,
      ),
    ).toBe(retried);
    const completed = claudeWorkflowFromMessage(
      progress([{ type: "workflow_agent", index: 0, state: "done", attempt: 2 }]),
      retried,
      later,
    );
    expect(completed?.agents[0]?.status).toBe("completed");
    expect(
      claudeWorkflowFromMessage(
        progress([{ type: "workflow_agent", index: 0, state: "running", attempt: 2 }]),
        completed,
        later,
      ),
    ).toBe(completed);
  });

  it("ignores malformed and duplicate entries and bounds a large fleet", () => {
    const roster = claudeWorkflowFromMessage(
      progress([
        null,
        { type: "workflow_agent", index: -1, state: "running" },
        { type: "workflow_agent", index: 0, label: "First", state: "queued" },
        { type: "workflow_agent", index: 0, label: "Duplicate", state: "done" },
        ...Array.from({ length: 120 }, (_, index) => ({
          type: "workflow_agent",
          index: index + 1,
          state: "queued",
        })),
        ...Array.from({ length: 80 }, (_, index) => ({
          type: "workflow_phase",
          index,
          title: `Phase ${index}`,
        })),
      ]),
      undefined,
      now,
    );
    expect(roster?.agents).toHaveLength(100);
    expect(roster?.phases).toHaveLength(64);
    expect(roster?.agents[0]?.title).toBe("First");
    expect(roster?.agents[0]?.status).toBe("pending");
    expect(
      claudeWorkflowFromMessage(progress([null, { type: "future_entry" }]), roster, later),
    ).toBe(roster);
    expect(claudeWorkflowFromMessage(progress([null]), undefined, now)).toBeUndefined();
  });
});
