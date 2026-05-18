#!/usr/bin/env node
import { loadLocalEnv } from "./config/env.js";
import { startSymphony } from "./main.js";

loadLocalEnv({ moduleUrl: import.meta.url });

const args = process.argv.slice(2);
const workflowPath = args.find((arg) => !arg.startsWith("--"));
const once = args.includes("--once");
const portArg = args.find((arg) => arg.startsWith("--port="));
const port = portArg ? Number(portArg.slice("--port=".length)) : null;

startSymphony({ workflowPath, once, port: Number.isFinite(port) ? port : null }).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
