import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { runAgy } from "../dist/agy.js";
import { loadConfig } from "../dist/config.js";
import { ProcessRunner } from "../dist/process.js";

const fixture = fileURLToPath(new URL("./fixtures/agy.mjs", import.meta.url));
const config = loadConfig({ AGY_MCP_BIN: fixture });
const options = (prompt, extra = {}) => ({
  bin: process.execPath,
  args: [fixture, "-p", prompt],
  cwd: process.cwd(),
  timeoutMs: 5_000,
  maxBufferBytes: 1_000_000,
  ...extra,
});

test("spawn failure, pre-canceled requests, and closed runners settle", async () => {
  const runner = new ProcessRunner();
  assert.equal(
    (await runner.run(options("ok", { bin: "/missing-agy-test" }))).failure,
    "SPAWN_ERROR",
  );
  assert.equal(
    (await runner.run(options("ok", { signal: AbortSignal.abort() }))).failure,
    "CANCELED",
  );
  await runner.close();
  assert.equal((await runner.run(options("ok"))).failure, "CANCELED");
});

test(
  "hard deadline escalates when a CLI ignores SIGTERM",
  { timeout: 6_000 },
  async () => {
    const runner = new ProcessRunner();
    const started = Date.now();
    assert.equal(
      (await runner.run(options("hang", { timeoutMs: 250 }))).failure,
      "TIMEOUT",
    );
    assert.ok(Date.now() - started < 4_000);
    await runner.close();
  },
);

test("output overflow and bounded stderr", async () => {
  const runner = new ProcessRunner();
  const overflow = await runner.run(
    options("overflow", { maxBufferBytes: 1_024 }),
  );
  assert.equal(overflow.failure, "OUTPUT_LIMIT");
  assert.ok(overflow.stdout.length <= 1_024);
  const stderr = await runner.run(options("stderr"));
  assert.equal(stderr.stderr.length, 4_000);
  assert.equal(stderr.exitCode, 2);
  await runner.close();
});

test(
  "overlapping calls return BUSY; shutdown cancels an active CLI",
  { timeout: 6_000 },
  async () => {
    const runner = new ProcessRunner();
    const active = runner.run(options("hang"));
    assert.equal((await runner.run(options("ok"))).failure, "BUSY");
    await runner.close();
    assert.equal((await active).failure, "CANCELED");
  },
);

test(
  "cancellation kills descendants in the CLI process group",
  { skip: process.platform !== "linux", timeout: 8_000 },
  async (t) => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "agy-tree-"));
    const previous = process.env.TEST_PID_FILE;
    process.env.TEST_PID_FILE = path.join(temp, "pid");
    const runner = new ProcessRunner();
    t.after(async () => {
      await runner.close();
      if (previous === undefined) delete process.env.TEST_PID_FILE;
      else process.env.TEST_PID_FILE = previous;
      rmSync(temp, { recursive: true, force: true });
    });
    const controller = new AbortController();
    const pending = runner.run(options("tree", { signal: controller.signal }));
    for (let i = 0; i < 150 && !existsSync(process.env.TEST_PID_FILE); i++)
      await delay(20);
    const pid = Number(readFileSync(process.env.TEST_PID_FILE, "utf8"));
    controller.abort();
    assert.equal((await pending).failure, "CANCELED");
    let state;
    try {
      state = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1][0];
    } catch {
      state = "gone";
    }
    assert.ok(
      state === "Z" || state === "gone",
      `descendant still running: ${state}`,
    );
  },
);

test("CLI result failures never masquerade as success", async (t) => {
  const runner = new ProcessRunner();
  t.after(() => runner.close());
  for (const prompt of ["error", "empty", "malformed", "nonzero", "denied"]) {
    const result = await runAgy(
      { prompt, workspace: process.cwd() },
      config,
      runner,
    );
    assert.equal(result.ok, false, prompt);
    assert.ok(result.error, prompt);
  }
  const success = await runAgy(
    { prompt: "literal ; $(touch must-not-exist)", workspace: process.cwd() },
    config,
    runner,
  );
  assert.equal(success.ok, true);
  assert.equal(
    JSON.parse(success.response).prompt,
    "literal ; $(touch must-not-exist)",
  );
  assert.equal(
    (
      await runAgy(
        { prompt: "ok", workspace: process.cwd(), autonomy: "full" },
        config,
        runner,
      )
    ).status,
    "POLICY_ERROR",
  );
});
