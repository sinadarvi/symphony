import type { EffectiveConfig } from "../config/schema.js";
import { renderPrompt } from "../workflow/template.js";
import { WorkspaceManager } from "../workspace/manager.js";
import { authorizeImplementation } from "../planning/authorization.js";
import { descriptionHasPlanningRecord, formatPlanningRecord, latestCommentIsPlanningRecord } from "../planning/records.js";
import type { CodexRuntimeEvent } from "../codex/events.js";
import type { CodexSession } from "../codex/protocol.js";
import { CodexAppServerClient } from "../codex/app-server-client.js";
import type { Issue, IssueTrackerClient } from "../tracker/types.js";

export type AgentWorkerResult = {
  status: "succeeded" | "failed" | "skipped";
  mode: "planning" | "implementation";
  reason?: "planning_record_exists";
  error?: unknown;
};

export type AgentWorkerOptions = {
  config: EffectiveConfig;
  tracker: Pick<IssueTrackerClient, "fetchIssueDiscussion" | "writePlanningRecord" | "fetchIssueStatesByIds">;
  workflowPromptTemplate: string;
  codexClientFactory?: () => CodexSession;
  onEvent?: (event: CodexRuntimeEvent) => void;
};

export class AgentWorker {
  private readonly workspaceManager: WorkspaceManager;

  constructor(private readonly options: AgentWorkerOptions) {
    this.workspaceManager = new WorkspaceManager(options.config);
  }

  async run(issue: Issue, attempt: number | null): Promise<AgentWorkerResult> {
    let workspacePath: string | null = null;
    let mode: "planning" | "implementation" = "planning";
    let client: CodexSession | null = null;

    try {
      const discussion = await this.options.tracker.fetchIssueDiscussion(issue.id);
      if (
        this.options.config.planning.planningRecordLocation === "comment" &&
        latestCommentIsPlanningRecord(issue.identifier, discussion, this.options.config.planning)
      ) {
        return { status: "skipped", mode: "planning", reason: "planning_record_exists" };
      }
      const authorization = authorizeImplementation(discussion.comments, this.options.config.planning);
      mode = authorization.authorized ? "implementation" : "planning";
      if (
        mode === "planning" &&
        this.options.config.planning.planningRecordLocation === "description" &&
        descriptionHasPlanningRecord(issue.identifier, discussion)
      ) {
        return { status: "skipped", mode: "planning", reason: "planning_record_exists" };
      }

      const workspace = await this.workspaceManager.ensureForIssue(issue.identifier);
      workspacePath = workspace.path;
      await this.workspaceManager.runBeforeRun(workspacePath);

      const prompt = await renderPrompt(this.options.workflowPromptTemplate, {
        issue,
        attempt,
        mode,
        planning: {
          authorization,
          discussion
        }
      });

      client = this.options.codexClientFactory?.() ?? new CodexAppServerClient(this.options.config.codex);
      let planningRecord = "";
      let turns = 0;

      while (turns < this.options.config.agent.maxTurns) {
        turns += 1;
        const input = turns === 1 ? prompt : `Continue working on ${issue.identifier}. Do not repeat the initial prompt.`;
        for await (const event of client.runTurn({ workspacePath, input, title: `${issue.identifier}: ${issue.title}` })) {
          this.options.onEvent?.(event);
          if (mode === "planning" && event.message) planningRecord = event.message;
        }

        if (mode === "planning") {
          await this.options.tracker.writePlanningRecord(issue.id, formatPlanningRecord(planningRecord), this.options.config.planning.planningRecordLocation);
          break;
        }

        const [latest] = await this.options.tracker.fetchIssueStatesByIds([issue.id]);
        if (!latest || !this.options.config.tracker.activeStates.map((state) => state.toLowerCase()).includes(latest.state.toLowerCase())) break;
      }

      return { status: "succeeded", mode };
    } catch (error) {
      return { status: "failed", mode, error };
    } finally {
      await client?.stop();
      if (workspacePath) await this.workspaceManager.runAfterRun(workspacePath);
    }
  }
}
