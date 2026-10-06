import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { IsoDateTime, NonNegativeInt, type OrchestrationV2Subagent } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

type Workflow = NonNullable<OrchestrationV2Subagent["workflow"]>;
type WorkflowAgent = Workflow["agents"][number];

const WorkflowEntry = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("workflow_phase"),
    index: NonNegativeInt,
    title: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("workflow_agent"),
    index: NonNegativeInt,
    state: Schema.String,
    label: Schema.optional(Schema.String),
    phaseIndex: Schema.optional(NonNegativeInt),
    phaseTitle: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    attempt: Schema.optional(NonNegativeInt),
    lastToolName: Schema.optional(Schema.String),
    startedAt: Schema.optional(Schema.Union([IsoDateTime, NonNegativeInt])),
    error: Schema.optional(Schema.String),
    tokens: Schema.optional(NonNegativeInt),
    toolCalls: Schema.optional(NonNegativeInt),
  }),
]);
const decodeEntry = Schema.decodeUnknownOption(WorkflowEntry);

/** Claude reports epoch milliseconds; projections persist ISO timestamps. */
function workflowStartedAt(startedAt: string | number | undefined): string | undefined {
  return typeof startedAt === "number"
    ? Option.getOrUndefined(Option.map(DateTime.make(startedAt), DateTime.formatIso))
    : startedAt;
}

function memberStatus(state: string, startedAt: string | null): WorkflowAgent["status"] {
  switch (state) {
    case "queued":
    case "pending":
      return "pending";
    case "progress":
    case "running":
      return "running";
    case "done":
      return "completed";
    case "error":
      return "failed";
    default:
      return startedAt === null ? "pending" : "running";
  }
}

/**
 * Normalizes Claude's optional workflow telemetry into a bounded member roster.
 * Stable slot indices survive retries; missing telemetry leaves the previous roster intact.
 */
export function claudeWorkflowFromMessage(
  message: SDKMessage,
  previous: Workflow | undefined,
  now: DateTime.Utc,
): Workflow | undefined {
  if (message.type !== "system") return previous;
  if (message.subtype === "task_started" && message.task_type === "local_workflow") {
    return { name: message.workflow_name ?? previous?.name ?? null, phases: [], agents: [] };
  }
  if (message.subtype !== "task_progress") return previous;

  // This field is emitted by Claude Code but is not declared in SDKMessage.
  const raw = Reflect.get(message, "workflow_progress");
  if (!Array.isArray(raw)) return previous;
  const phases = new Map(previous?.phases.map((phase) => [phase.index, phase]) ?? []);
  const agents = new Map(previous?.agents.map((agent) => [agent.index, agent]) ?? []);
  const seenPhases = new Set<number>();
  const seenAgents = new Set<number>();
  for (const value of raw) {
    const entry = Option.getOrUndefined(decodeEntry(value));
    if (entry === undefined) continue;
    if (entry.type === "workflow_phase") {
      if (seenPhases.has(entry.index) || entry.title.trim().length === 0) continue;
      seenPhases.add(entry.index);
      if (phases.has(entry.index) || phases.size < 64) {
        phases.set(entry.index, { index: entry.index, title: entry.title.trim() });
      }
      continue;
    }
    if (seenAgents.has(entry.index) || entry.state.trim().length === 0) continue;
    seenAgents.add(entry.index);
    if (!agents.has(entry.index) && agents.size >= 100) continue;
    const prior = agents.get(entry.index);
    if (
      prior?.attempt !== undefined &&
      entry.attempt !== undefined &&
      entry.attempt < prior.attempt
    )
      continue;
    const retry =
      prior?.attempt !== undefined && entry.attempt !== undefined && entry.attempt > prior.attempt;
    const startedAt =
      workflowStartedAt(entry.startedAt) ?? (retry ? null : (prior?.startedAt ?? null));
    const status = memberStatus(entry.state, startedAt);
    if (
      !retry &&
      (prior?.status === "completed" || prior?.status === "failed") &&
      status !== "completed" &&
      status !== "failed"
    )
      continue;
    agents.set(entry.index, {
      ...prior,
      index: entry.index,
      title: entry.label?.trim() || prior?.title || `Agent ${entry.index + 1}`,
      status,
      ...(entry.model === undefined ? {} : { model: entry.model }),
      ...(entry.phaseIndex === undefined ? {} : { phaseIndex: entry.phaseIndex }),
      ...(entry.phaseTitle === undefined ? {} : { phaseTitle: entry.phaseTitle }),
      ...(entry.attempt === undefined ? {} : { attempt: entry.attempt }),
      ...(retry ? { error: undefined, usage: undefined, lastToolName: undefined } : {}),
      ...(entry.lastToolName === undefined ? {} : { lastToolName: entry.lastToolName }),
      ...(entry.error === undefined ? {} : { error: entry.error }),
      ...(entry.tokens === undefined
        ? {}
        : {
            usage: {
              totalTokens: entry.tokens,
              ...(entry.toolCalls === undefined ? {} : { toolUses: entry.toolCalls }),
            },
          }),
      startedAt,
      completedAt:
        status === "completed" || status === "failed"
          ? (!retry && prior?.completedAt) || DateTime.formatIso(now)
          : null,
    });
  }
  if (previous === undefined && phases.size === 0 && agents.size === 0) return undefined;
  const workflow = {
    name: previous?.name ?? null,
    phases: [...phases.values()].toSorted((a, b) => a.index - b.index),
    agents: [...agents.values()].toSorted((a, b) => a.index - b.index),
  };
  return JSON.stringify(workflow) === JSON.stringify(previous) ? previous : workflow;
}
