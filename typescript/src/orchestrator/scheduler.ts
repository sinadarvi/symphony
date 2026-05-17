import type { EffectiveConfig } from "../config/schema.js";
import type { Issue, IssueTrackerClient } from "../tracker/types.js";
import { eligibleIssues, sortIssuesForDispatch } from "./dispatch.js";
import { releaseClaim } from "./retry.js";
import type { OrchestratorState } from "./state.js";

export type DispatchWorker = (issue: Issue) => Promise<void> | void;

export class Scheduler {
  constructor(
    private readonly state: OrchestratorState,
    private readonly config: EffectiveConfig,
    private readonly tracker: Pick<IssueTrackerClient, "fetchCandidateIssues">,
    private readonly dispatchWorker: DispatchWorker
  ) {}

  async tick(): Promise<Issue[]> {
    const candidates = sortIssuesForDispatch(await this.tracker.fetchCandidateIssues());
    const selected = eligibleIssues(candidates, this.state, this.config);
    for (const issue of selected) {
      this.state.claimed.add(issue.id);
      void Promise.resolve(this.dispatchWorker(issue)).catch(() => releaseClaim(this.state, issue.id));
    }
    return selected;
  }
}
