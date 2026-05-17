import type { CodexRuntimeEvent } from "./events.js";

export type RunTurnInput = {
  workspacePath: string;
  input: string;
  title?: string;
};

export interface CodexSession {
  runTurn(input: RunTurnInput): AsyncIterable<CodexRuntimeEvent>;
  stop(): Promise<void>;
}
