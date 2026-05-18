import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnvFile } from "dotenv";

export function loadLocalEnv(options: { cwd?: string; moduleUrl?: string } = {}): void {
  const cwd = options.cwd ?? process.cwd();
  loadDotEnvFile({ path: path.join(cwd, ".env"), override: false });

  if (options.moduleUrl) {
    const moduleDir = path.dirname(fileURLToPath(options.moduleUrl));
    const packageRoot = path.resolve(moduleDir, "..", "..");
    loadDotEnvFile({ path: path.join(packageRoot, ".env"), override: false });
  }
}
