import type { EffectiveConfig } from "./schema.js";
import { validateDispatchConfig } from "./resolve.js";
import { SymphonyError } from "../shared/errors.js";

export function assertDispatchConfig(config: EffectiveConfig): void {
  const errors = validateDispatchConfig(config);
  if (errors.length > 0) {
    throw new SymphonyError(errors[0] ?? "invalid_config", `Invalid dispatch config: ${errors.join(", ")}`);
  }
}
