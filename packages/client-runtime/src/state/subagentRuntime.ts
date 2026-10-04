/**
 * Subagent status helpers shared by web and mobile, and the runtime shape the
 * web agent rows render.
 */
import * as DateTime from "effect/DateTime";
import type { OrchestrationV2Subagent } from "@t3tools/contracts";
import { isOrchestrationV2WorkActive } from "@t3tools/contracts";

export type RuntimeSubagentStatus =
  | "pending"
  | "running"
  | "waiting"
  | "idle"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface SubagentUsage {
  readonly totalTokens: number;
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly toolUses?: number;
  readonly durationMs?: number;
}

export interface SubagentActivityEntry {
  readonly at: string;
  readonly summary: string;
}

export interface SubagentWorkflowPhase {
  readonly index: number;
  readonly title: string;
}

export interface SubagentRunHandles {
  readonly runId?: string;
  readonly scriptPath?: string;
  readonly transcriptDir?: string;
  readonly sessionUrl?: string;
}

export interface RuntimeSubagent {
  readonly id: string;
  readonly kind: "subagent" | "subagent_batch" | "workflow" | "workflow_agent";
  readonly title: string;
  readonly role: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  readonly status: RuntimeSubagentStatus;
  readonly activationCount: number;
  readonly usage: SubagentUsage | null;
  readonly progress: string | null;
  readonly lastToolName: string | null;
  readonly result: string | null;
  readonly error: string | null;
  readonly outputFile: string | null;
  readonly parentAgentId: string | null;
  readonly agentIndex: number | null;
  readonly phaseIndex: number | null;
  readonly phaseTitle: string | null;
  readonly attempt: number | null;
  readonly workflowName: string | null;
  readonly phases: ReadonlyArray<SubagentWorkflowPhase>;
  readonly runHandles: SubagentRunHandles | null;
  readonly recentActivity: ReadonlyArray<SubagentActivityEntry>;
  /** First retained observation, used as the roster's stable display order. */
  readonly firstSeenAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly updatedAt: string;
}

export interface RuntimeWorkflowStage {
  readonly id: string;
  /** Null when Claude has not supplied an ordered phase index. */
  readonly index: number | null;
  readonly title: string;
  /** Aggregate task state; Claude does not report a phase lifecycle. */
  readonly status: RuntimeSubagentStatus;
  readonly tasks: ReadonlyArray<RuntimeSubagent>;
}

type ProjectedSubagent = {
  readonly id: string;
  readonly title: string | null;
  readonly prompt: string;
  readonly model: string | null;
  readonly status: OrchestrationV2Subagent["status"];
  readonly progress?: string | undefined;
  readonly workflow?: OrchestrationV2Subagent["workflow"];
  readonly result: string | null;
  readonly startedAt: DateTime.Utc | null;
  readonly completedAt: DateTime.Utc | null;
  readonly updatedAt: DateTime.Utc;
};

const TERMINAL_STATUSES: ReadonlySet<RuntimeSubagentStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export function isTerminalSubagentStatus(status: RuntimeSubagentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Active = the user may still need to care while it runs. Idle is settled-ish
 * but resumable; waiting counts as active because it needs the user. */
export function isActiveSubagentStatus(status: RuntimeSubagentStatus): boolean {
  return isOrchestrationV2WorkActive(status);
}

/**
 * Projects orchestration-v2 subagent entities into the runtime shape the web
 * agent rows render.
 */
export function projectedSubagentsToRuntime(
  subagents: ReadonlyArray<ProjectedSubagent>,
): ReadonlyArray<RuntimeSubagent> {
  return subagents.flatMap((subagent) => {
    const updatedAt = DateTime.formatIso(subagent.updatedAt);
    const startedAt = subagent.startedAt === null ? null : DateTime.formatIso(subagent.startedAt);
    const coordinator = {
      id: subagent.id,
      kind: subagent.workflow === undefined ? ("subagent" as const) : ("workflow" as const),
      title:
        subagent.title ??
        (subagent.prompt.length > 80 ? `${subagent.prompt.slice(0, 77)}...` : subagent.prompt),
      role: null,
      model: subagent.model,
      effort: null,
      status: subagent.status,
      activationCount: 1,
      usage: null,
      progress: subagent.progress ?? null,
      lastToolName: null,
      result: subagent.result,
      error: subagent.status === "failed" ? (subagent.result ?? null) : null,
      outputFile: null,
      parentAgentId: null,
      agentIndex: null,
      phaseIndex: null,
      phaseTitle: null,
      attempt: null,
      workflowName: subagent.workflow?.name ?? null,
      phases: subagent.workflow?.phases ?? [],
      runHandles: null,
      recentActivity: [],
      firstSeenAt: startedAt ?? updatedAt,
      startedAt,
      completedAt: subagent.completedAt === null ? null : DateTime.formatIso(subagent.completedAt),
      updatedAt,
    } satisfies RuntimeSubagent;
    const members =
      subagent.workflow?.agents.map((agent) => {
        // A coordinator can finish without a last roster tick. Keep terminal
        // members' outcomes; settle unfinished work so it cannot look live forever.
        const status =
          isActiveSubagentStatus(agent.status) && isTerminalSubagentStatus(coordinator.status)
            ? agent.status === "pending"
              ? "cancelled"
              : coordinator.status
            : coordinator.status === "idle" && isActiveSubagentStatus(agent.status)
              ? "idle"
              : agent.status;
        const phaseTitle =
          agent.phaseTitle ??
          subagent.workflow?.phases.find((phase) => phase.index === agent.phaseIndex)?.title ??
          null;
        return {
          ...coordinator,
          id: `${subagent.id}:wf:${agent.index}`,
          kind: "workflow_agent" as const,
          title: agent.title,
          role: phaseTitle,
          model: agent.model ?? coordinator.model,
          status,
          progress: agent.lastToolName ?? phaseTitle,
          lastToolName: agent.lastToolName ?? null,
          usage: agent.usage ?? null,
          result: null,
          error: agent.error ?? (status === "failed" ? coordinator.error : null),
          parentAgentId: subagent.id,
          agentIndex: agent.index,
          phaseIndex: agent.phaseIndex ?? null,
          phaseTitle,
          attempt: agent.attempt ?? null,
          startedAt: agent.startedAt,
          completedAt: isTerminalSubagentStatus(status)
            ? (agent.completedAt ?? coordinator.completedAt ?? updatedAt)
            : null,
          firstSeenAt: agent.startedAt ?? coordinator.firstSeenAt,
        } satisfies RuntimeSubagent;
      }) ?? [];
    return [coordinator, ...members];
  });
}

/**
 * Groups the normalized roster into Claude's reported stages, retaining empty
 * stages and tasks whose phase metadata has not arrived yet. Stage indices
 * describe order; the native stream does not supply task dependency edges.
 */
export function workflowStagesFromSubagent(
  subagent: ProjectedSubagent,
): ReadonlyArray<RuntimeWorkflowStage> {
  if (subagent.workflow === undefined) return [];
  const stages = new Map<
    string,
    { id: string; index: number | null; title: string; tasks: RuntimeSubagent[] }
  >();
  for (const phase of subagent.workflow.phases) {
    const id = `phase:${phase.index}`;
    stages.set(id, { id, index: phase.index, title: phase.title, tasks: [] });
  }
  for (const task of projectedSubagentsToRuntime([subagent]).slice(1)) {
    const phaseTitle = task.phaseTitle?.trim() || null;
    const namedPhases = subagent.workflow.phases.filter((phase) => phase.title === phaseTitle);
    const index = task.phaseIndex ?? (namedPhases.length === 1 ? namedPhases[0]!.index : null);
    const id = index !== null ? `phase:${index}` : `title:${phaseTitle ?? ""}`;
    let stage = stages.get(id);
    if (stage === undefined) {
      stage = {
        id,
        index,
        title: phaseTitle ?? (index === null ? "Tasks" : `Stage ${index + 1}`),
        tasks: [],
      };
      stages.set(id, stage);
    }
    stage.tasks.push(task);
  }
  const statusPriority: ReadonlyArray<RuntimeSubagentStatus> = [
    "running",
    "waiting",
    "pending",
    "failed",
    "interrupted",
    "cancelled",
    "idle",
  ];
  return [...stages.values()]
    .sort((a, b) => {
      if (a.index === null) return b.index === null ? 0 : 1;
      if (b.index === null) return -1;
      return a.index - b.index;
    })
    .map((stage) => ({
      ...stage,
      status:
        stage.tasks.length === 0
          ? "pending"
          : (statusPriority.find((status) => stage.tasks.some((task) => task.status === status)) ??
            "completed"),
    }));
}
