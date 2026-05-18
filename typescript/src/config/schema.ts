export type PlanningRecordLocation = "description" | "comment";

export type EffectiveConfig = {
  workflowPath: string;
  tracker: {
    kind: string | null;
    endpoint: string;
    apiKey: string | null;
    projectSlug: string | null;
    activeStates: string[];
    terminalStates: string[];
  };
  polling: {
    intervalMs: number;
  };
  workspace: {
    root: string;
  };
  hooks: {
    afterCreate: string | null;
    beforeRun: string | null;
    afterRun: string | null;
    beforeRemove: string | null;
    timeoutMs: number;
  };
  agent: {
    maxConcurrentAgents: number;
    maxTurns: number;
    maxRetryBackoffMs: number;
    maxConcurrentAgentsByState: Record<string, number>;
  };
  planning: {
    assistantMention: string;
    assistantAuthors: string[] | null;
    implementationPhrase: string;
    authorizedRequesters: string[] | null;
    planningRecordLocation: PlanningRecordLocation;
  };
  codex: {
    command: string;
    approvalPolicy: unknown;
    threadSandbox: unknown;
    turnSandboxPolicy: unknown;
    turnTimeoutMs: number;
    readTimeoutMs: number;
    stallTimeoutMs: number;
  };
  server: {
    port: number | null;
  };
};

export function normalizeIssueState(state: string): string {
  return state.trim().toLowerCase();
}
