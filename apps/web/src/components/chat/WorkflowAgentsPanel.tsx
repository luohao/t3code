import type { EnvironmentId, OrchestrationV2Subagent, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isActiveSubagentStatus,
  projectedSubagentsToRuntime,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { useMemo, useState } from "react";

import { useThreadProjection } from "../../state/entities";
import { Button } from "../ui/button";
import { CollapsibleSectionHeader, SectionHeaderStatus } from "../ui/collapsible-section-header";
import { AgentElapsed } from "./AgentElapsed";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { ThreadRelationshipIcon, threadRelationshipStatusLabel } from "./ThreadRelationshipIcon";

const PAGE_SIZE = 6;
const tokenFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function WorkflowAgentGroup({ subagent }: { subagent: OrchestrationV2Subagent }) {
  const agents = useMemo(() => projectedSubagentsToRuntime([subagent]).slice(1), [subagent]);
  const [expanded, setExpanded] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const activeCount = agents.filter((agent) => isActiveSubagentStatus(agent.status)).length;
  const failedCount = agents.filter((agent) => agent.status === "failed").length;
  const hiddenCount = Math.max(0, agents.length - visibleCount);
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
            <span className="shrink-0 text-3xs text-muted-foreground">{`${activeCount} active`}</span>
          )
        }
      >
        {name}
      </CollapsibleSectionHeader>
      {expanded ? (
        <>
          {subagent.progress ? (
            <p className="px-2 pb-1 text-2xs text-muted-foreground">{subagent.progress}</p>
          ) : null}
          <ul
            aria-label={`Agents in ${name}`}
            tabIndex={0}
            className="m-0 max-h-64 list-none overflow-y-auto overscroll-contain p-0"
          >
            {agents.slice(0, visibleCount).map((agent) => (
              <li key={agent.id} className="flex items-start gap-2 px-2 py-1.5">
                <ThreadRelationshipIcon status={agent.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {agent.title}
                    </span>
                    <span className="shrink-0 text-2xs text-muted-foreground">
                      {threadRelationshipStatusLabel(agent.status)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                    <span className="min-w-0 flex-1 truncate">
                      {[
                        agent.phaseTitle,
                        agent.model,
                        agent.lastToolName,
                        agent.attempt !== null && agent.attempt > 1
                          ? `Attempt ${agent.attempt}`
                          : null,
                        agent.usage
                          ? `${tokenFormatter.format(agent.usage.totalTokens)} tokens`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <AgentElapsed agent={agent} />
                  </div>
                  {agent.error ? (
                    <p className="mt-0.5 text-2xs text-destructive">{agent.error}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {hiddenCount > 0 ? (
            <div className="px-2 pt-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              >
                Show {Math.min(hiddenCount, PAGE_SIZE)} more agents
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Workflow members have no child sessions, so they belong beside the lineage list. */
export function WorkflowAgentsPanel({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const projection = useThreadProjection(scopeThreadRef(environmentId, threadId))?.projection;
  const workflows =
    projection?.subagents.filter((subagent) => subagent.workflow !== undefined) ?? [];
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
