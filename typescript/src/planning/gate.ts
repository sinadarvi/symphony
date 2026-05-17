import type { EffectiveConfig } from "../config/schema.js";
import type { IssueTrackerClient } from "../tracker/types.js";
import { authorizeImplementation, type AuthorizationResult } from "./authorization.js";

export type PlanningModeDecision =
  | { mode: "implementation"; authorization: Extract<AuthorizationResult, { authorized: true }> }
  | { mode: "planning"; authorization: { authorized: false } };

export async function decidePlanningMode(
  tracker: Pick<IssueTrackerClient, "fetchIssueDiscussion">,
  issueId: string,
  config: EffectiveConfig
): Promise<PlanningModeDecision> {
  const discussion = await tracker.fetchIssueDiscussion(issueId);
  const authorization = authorizeImplementation(discussion.comments, config.planning);
  return authorization.authorized ? { mode: "implementation", authorization } : { mode: "planning", authorization };
}
