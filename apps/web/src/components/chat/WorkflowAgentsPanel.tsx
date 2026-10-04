import type { EnvironmentId, OrchestrationV2Subagent, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isActiveSubagentStatus,
  isTerminalSubagentStatus,
  workflowStagesFromSubagent,
  type RuntimeSubagent,
  type RuntimeWorkflowStage,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { ArrowDownIcon, ArrowRightIcon, ChevronDownIcon, ExpandIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { useThreadProjection } from "../../state/entities";
import { Button } from "../ui/button";
import { CollapsibleSectionHeader, SectionHeaderStatus } from "../ui/collapsible-section-header";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AgentElapsed } from "./AgentElapsed";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { ThreadRelationshipIcon, threadRelationshipStatusLabel } from "./ThreadRelationshipIcon";

const PAGE_SIZE = 6;
const tokenFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function WorkflowTaskRow({ task }: { task: RuntimeSubagent }) {
  return (
    <li className="relative flex items-start gap-2 border-l border-border/70 py-2 pr-2 pl-3 before:absolute before:top-4 before:-left-px before:h-px before:w-2 before:bg-border/70">
      <ThreadRelationshipIcon status={task.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 text-xs font-medium wrap-anywhere">{task.title}</span>
          <span className="shrink-0 text-2xs text-muted-foreground">
            {threadRelationshipStatusLabel(task.status)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-2xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {[
              task.model,
              task.lastToolName,
              task.attempt !== null && task.attempt > 1 ? `Attempt ${task.attempt}` : null,
              task.usage ? `${tokenFormatter.format(task.usage.totalTokens)} tokens` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <AgentElapsed agent={task} />
        </div>
        {task.error ? (
          <p className="mt-0.5 text-2xs text-destructive wrap-anywhere">{task.error}</p>
        ) : null}
      </div>
    </li>
  );
}

function WorkflowStageCard({
  stage,
  showAllTasks,
}: {
  stage: RuntimeWorkflowStage;
  showAllTasks: boolean;
}) {
  const tasksId = useId();
  const [expanded, setExpanded] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const completedCount = stage.tasks.filter((task) => task.status === "completed").length;
  const failedCount = stage.tasks.filter((task) => task.status === "failed").length;
  const tasks = showAllTasks ? stage.tasks : stage.tasks.slice(0, visibleCount);
  const hiddenCount = stage.tasks.length - tasks.length;
  const status =
    stage.tasks.length === 0 ? "No tasks" : threadRelationshipStatusLabel(stage.status);

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={tasksId}
        onClick={() => setExpanded(!expanded)}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        <span
          aria-hidden
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md text-2xs font-medium",
            stage.status === "running" || stage.status === "waiting"
              ? "bg-info/10 text-info"
              : stage.status === "completed"
                ? "bg-success/10 text-success"
                : stage.status === "failed"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground",
          )}
        >
          {stage.index === null ? "·" : stage.index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <Tooltip>
            <TooltipTrigger render={<span className="block truncate text-xs font-medium" />}>
              {stage.title}
            </TooltipTrigger>
            <TooltipPopup>{stage.title}</TooltipPopup>
          </Tooltip>
          <span className="block text-3xs text-muted-foreground">
            {stage.tasks.length} {stage.tasks.length === 1 ? "task" : "tasks"}
            {stage.tasks.length > 0 ? ` · ${completedCount}/${stage.tasks.length} done` : ""}
            {failedCount > 0 ? ` · ${failedCount} failed` : ""}
          </span>
        </span>
        <span className="shrink-0 text-3xs text-muted-foreground">{status}</span>
        <ChevronDownIcon aria-hidden className={cn("size-3 shrink-0", expanded && "rotate-180")} />
      </button>
      {expanded ? (
        <div id={tasksId}>
          {stage.tasks.length === 0 ? (
            <p className="px-3 pb-2 text-2xs text-muted-foreground">No tasks yet</p>
          ) : (
            <ul aria-label={`Tasks in ${stage.title}`} className="m-0 list-none pr-1 pb-1 pl-5">
              {tasks.map((task) => (
                <WorkflowTaskRow key={task.id} task={task} />
              ))}
            </ul>
          )}
          {hiddenCount > 0 ? (
            <div className="px-2 pb-2">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              >
                Show {Math.min(hiddenCount, PAGE_SIZE)} more tasks
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Only ordered stages get arrows; unassigned tasks never acquire guessed dependencies. */
function WorkflowStageDiagram({
  name,
  stages,
  horizontal = false,
}: {
  name: string;
  stages: ReadonlyArray<RuntimeWorkflowStage>;
  horizontal?: boolean;
}) {
  return (
    <ol
      aria-label={`Stages in ${name}`}
      className={cn(
        "m-0 list-none p-0",
        horizontal ? "flex min-w-max items-start gap-6" : "space-y-2",
      )}
    >
      {stages.map((stage, index) => (
        <li key={stage.id} className={cn("relative", horizontal && "w-72 shrink-0")}>
          {index > 0 && stage.index !== null && stages[index - 1]?.index !== null ? (
            horizontal ? (
              <ArrowRightIcon
                aria-hidden
                className="absolute top-4 -left-5 size-4 text-muted-foreground/60"
              />
            ) : (
              <div className="flex justify-center pb-2">
                <ArrowDownIcon aria-hidden className="size-3 text-muted-foreground/60" />
              </div>
            )
          ) : null}
          <WorkflowStageCard stage={stage} showAllTasks={horizontal} />
        </li>
      ))}
    </ol>
  );
}

function WorkflowAgentGroup({ subagent }: { subagent: OrchestrationV2Subagent }) {
  const stages = useMemo(() => workflowStagesFromSubagent(subagent), [subagent]);
  const agents = stages.flatMap((stage) => stage.tasks);
  const [expanded, setExpanded] = useState(true);
  const [graphOpen, setGraphOpen] = useState(false);
  const activeCount = agents.filter((agent) => isActiveSubagentStatus(agent.status)).length;
  const failedCount = agents.filter((agent) => agent.status === "failed").length;
  const stageCount = stages.filter((stage) => stage.index !== null).length;
  const name = subagent.workflow?.name ?? subagent.title ?? "Workflow";

  return (
    <div>
      <CollapsibleSectionHeader
        expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        accessory={
          failedCount > 0 ? (
            <SectionHeaderStatus>{`${failedCount} failed`}</SectionHeaderStatus>
          ) : (
            <span className="shrink-0 text-3xs text-muted-foreground">
              {subagent.status === "idle"
                ? "Paused"
                : activeCount > 0
                  ? `${activeCount} active`
                  : threadRelationshipStatusLabel(subagent.status)}
            </span>
          )
        }
      >
        <Tooltip>
          <TooltipTrigger render={<span className="block max-w-32 truncate" />}>
            {name}
          </TooltipTrigger>
          <TooltipPopup>{name}</TooltipPopup>
        </Tooltip>
      </CollapsibleSectionHeader>
      {expanded ? (
        <>
          {subagent.progress ? (
            <p className="px-2 pb-1 text-2xs text-muted-foreground wrap-anywhere">
              {subagent.progress}
            </p>
          ) : null}
          {stages.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-2 px-2 pb-2">
                <span className="text-2xs text-muted-foreground">
                  {stageCount} {stageCount === 1 ? "stage" : "stages"} · {agents.length}{" "}
                  {agents.length === 1 ? "task" : "tasks"}
                </span>
                <Button variant="ghost" size="xs" onClick={() => setGraphOpen(true)}>
                  <ExpandIcon aria-hidden />
                  View graph
                </Button>
              </div>
              <div className="max-h-96 overflow-y-auto overscroll-contain px-1">
                <WorkflowStageDiagram name={name} stages={stages} />
              </div>
            </>
          ) : (
            <p className="px-2 pb-2 text-2xs text-muted-foreground">
              Waiting for workflow stages and tasks
            </p>
          )}
        </>
      ) : null}
      {graphOpen ? (
        <Dialog open onOpenChange={setGraphOpen}>
          <DialogPopup
            className="w-[calc(100vw-2rem)] max-w-6xl"
            bottomStickOnMobile={false}
            layer="popover"
            variant="solid"
          >
            <DialogHeader>
              <DialogTitle>{name}</DialogTitle>
              <DialogDescription>
                Live workflow stages and tasks. Arrows show stage order.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[65vh] overflow-auto overscroll-contain px-6 pb-6" tabIndex={0}>
              <WorkflowStageDiagram name={name} stages={stages} horizontal />
            </div>
          </DialogPopup>
        </Dialog>
      ) : null}
    </div>
  );
}

/**
 * The coordinator owns visibility: terminal workflows can retain stale member
 * snapshots. Paused workflows are unfinished and remain available to inspect.
 */
export function WorkflowAgentsPanel({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const projection = useThreadProjection(scopeThreadRef(environmentId, threadId))?.projection;
  const workflows =
    projection?.subagents.filter(
      (subagent) => subagent.workflow !== undefined && !isTerminalSubagentStatus(subagent.status),
    ) ?? [];
  if (workflows.length === 0) return null;
  return (
    <ThreadDetailsSection
      headingId="thread-details-workflow-agents-heading"
      title="Workflow agents"
    >
      {workflows.map((subagent) => (
        <WorkflowAgentGroup key={subagent.id} subagent={subagent} />
      ))}
    </ThreadDetailsSection>
  );
}
