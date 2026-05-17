import { normalizeIssueState, type EffectiveConfig } from "../config/schema.js";
import type { Issue } from "../tracker/types.js";
import type { OrchestratorState } from "./state.js";

export function sortIssuesForDispatch(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    const priority = priorityRank(a.priority) - priorityRank(b.priority);
    if (priority !== 0) return priority;
    const created = dateRank(a.createdAt) - dateRank(b.createdAt);
    if (created !== 0) return created;
    return a.identifier.localeCompare(b.identifier);
  });
}

export function eligibleIssues(issues: Issue[], state: OrchestratorState, config: EffectiveConfig): Issue[] {
  const selected: Issue[] = [];
  for (const issue of issues) {
    if (isDispatchEligible(issue, state, config, selected)) selected.push(issue);
    if (selected.length >= availableGlobalSlots(state, config)) break;
  }
  return selected;
}

export function isDispatchEligible(
  issue: Issue,
  state: OrchestratorState,
  config: EffectiveConfig,
  pending: Issue[] = []
): boolean {
  if (!issue.id || !issue.identifier || !issue.title || !issue.state) return false;
  const issueState = normalizeIssueState(issue.state);
  const active = new Set(config.tracker.activeStates.map(normalizeIssueState));
  const terminal = new Set(config.tracker.terminalStates.map(normalizeIssueState));
  if (!active.has(issueState) || terminal.has(issueState)) return false;
  if (state.running.has(issue.id) || state.claimed.has(issue.id)) return false;
  if (availableGlobalSlots(state, config) - pending.length <= 0) return false;
  if (issueState === "todo" && issue.blockedBy.some((blocker) => blocker.state && !terminal.has(normalizeIssueState(blocker.state)))) {
    return false;
  }

  const limit = config.agent.maxConcurrentAgentsByState[issueState] ?? config.agent.maxConcurrentAgents;
  const runningInState = [...state.running.values()].filter((entry) => normalizeIssueState(entry.issue.state) === issueState).length;
  const pendingInState = pending.filter((candidate) => normalizeIssueState(candidate.state) === issueState).length;
  return runningInState + pendingInState < limit;
}

export function claimIssue(state: OrchestratorState, issue: Issue): void {
  state.claimed.add(issue.id);
}

function availableGlobalSlots(state: OrchestratorState, config: EffectiveConfig): number {
  return Math.max(config.agent.maxConcurrentAgents - state.running.size, 0);
}

function priorityRank(priority: number | null): number {
  return priority == null ? Number.MAX_SAFE_INTEGER : priority;
}

function dateRank(date: Date | null): number {
  return date?.getTime() ?? Number.MAX_SAFE_INTEGER;
}
