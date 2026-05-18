import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadLocalEnv } from "../src/config/env.js";

describe("local .env loading", () => {
  afterEach(() => {
    delete process.env.SYMPHONY_DOTENV_TEST_KEY;
  });

  it("loads variables from .env in the current working directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "symphony-env-"));
    await writeFile(path.join(dir, ".env"), "SYMPHONY_DOTENV_TEST_KEY=from-env-file\n");

    loadLocalEnv({ cwd: dir });

    expect(process.env.SYMPHONY_DOTENV_TEST_KEY).toBe("from-env-file");
  });

  it("does not overwrite variables already provided by the shell", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "symphony-env-"));
    await writeFile(path.join(dir, ".env"), "SYMPHONY_DOTENV_TEST_KEY=from-env-file\n");
    process.env.SYMPHONY_DOTENV_TEST_KEY = "from-shell";

    loadLocalEnv({ cwd: dir });

    expect(process.env.SYMPHONY_DOTENV_TEST_KEY).toBe("from-shell");
  });
});
