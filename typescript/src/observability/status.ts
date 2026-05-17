import type { OrchestratorState } from "../orchestrator/state.js";
import { snapshotState } from "../orchestrator/snapshot.js";

export function statusJson(state: OrchestratorState): string {
  return JSON.stringify(snapshotState(state), null, 2);
}
