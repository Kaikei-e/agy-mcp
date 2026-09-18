import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
);
const server = path.join(root, "dist", "index.js");
const fixture = path.join(root, "test", "fixtures", "agy.mjs");

function clientPair(extraEnv = {}, options = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd: root,
    stderr: "pipe",
    env: {
      ...process.env,
      AGY_MCP_BIN: fixture,
      AGY_MCP_DEFAULT_WORKSPACE: root,
      AGY_MCP_ALLOWED_ROOT: root,
      ...extraEnv,
    },
  });
  const client = new Client(
    { name: "agy-mcp-integration-test", version: "1.0.0" },
    options,
  );
  return { client, transport };
}

async function connected(extraEnv = {}, options = {}, connectOptions) {
  const pair = clientPair(extraEnv, options);
  await pair.client.connect(pair.transport, connectOptions);
  return pair;
}

async function closePair({ client, transport }) {
  await client.close().catch(() => {});
  await transport.close().catch(() => {});
}

function valueOf(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object")
    return result.structuredContent;
  const text = result?.content?.find((item) => item.type === "text")?.text;
  assert.ok(text, "MCP result has no text content");
  return JSON.parse(text);
}

async function waitFor(condition, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await delay(20);
  }
  assert.fail("condition did not become true before the deadline");
}

test("legacy and modern MCP negotiation expose all three tools", async (t) => {
  const legacy = await connected();
  t.after(() => closePair(legacy));
  assert.equal(legacy.client.getProtocolEra(), "legacy");
  const legacyTools = (await legacy.client.listTools()).tools
    .map((tool) => tool.name)
    .sort();
  assert.deepEqual(legacyTools, [
    "antigravity_continue",
    "antigravity_models",
    "antigravity_run",
  ]);

  const modern = await connected(
    {},
    { versionNegotiation: { mode: "auto", probe: { timeoutMs: 1_000 } } },
  );
  t.after(() => closePair(modern));
  assert.equal(modern.client.getProtocolEra(), "modern");
  assert.equal(modern.client.getNegotiatedProtocolVersion(), "2026-07-28");
  const modernTools = (await modern.client.listTools()).tools
    .map((tool) => tool.name)
    .sort();
  assert.deepEqual(modernTools, legacyTools);
});

test("models, new turns, and explicit or implicit continuation pass safe argv", async (t) => {
  const pair = await connected();
  t.after(() => closePair(pair));
  const models = await pair.client.callTool({
    name: "antigravity_models",
    arguments: {},
  });
  assert.equal(models.isError, false);
  assert.match(String(valueOf(models).response), /test-model/);

  const first = await pair.client.callTool({
    name: "antigravity_run",
    arguments: {
      prompt: "first",
      workspace: root,
      model: "test-model",
      mode: "accept-edits",
      autonomy: "sandbox",
      effort: "high",
      timeout_seconds: 10,
    },
  });
  const firstValue = valueOf(first);
  assert.equal(firstValue.ok, true);
  assert.ok(firstValue.conversation_id);
  const firstResponse = JSON.parse(firstValue.response);
  assert.equal(firstResponse.prompt, "first");
  assert.equal(firstResponse.cwd, root);
  assert.ok(firstResponse.argv.includes("--sandbox"));
  assert.ok(
    firstResponse.argv.includes("--model") &&
      firstResponse.argv.includes("test-model"),
  );
  assert.ok(
    firstResponse.argv.includes("--effort") &&
      firstResponse.argv.includes("high"),
  );

  const explicit = await pair.client.callTool({
    name: "antigravity_continue",
    arguments: {
      prompt: "explicit",
      conversation_id: firstValue.conversation_id,
      workspace: root,
      timeout_seconds: 10,
    },
  });
  assert.ok(
    JSON.parse(valueOf(explicit).response).argv.includes("--conversation"),
  );
  assert.ok(
    JSON.parse(valueOf(explicit).response).argv.includes(
      firstValue.conversation_id,
    ),
  );

  const implicit = await pair.client.callTool({
    name: "antigravity_continue",
    arguments: { prompt: "implicit", workspace: root, timeout_seconds: 10 },
  });
  assert.ok(JSON.parse(valueOf(implicit).response).argv.includes("--continue"));
});

test("validation, policy, and workspace failures are returned as tool errors", async (t) => {
  const pair = await connected();
  t.after(() => closePair(pair));
  let invalid;
  try {
    invalid = await pair.client.callTool({
      name: "antigravity_run",
      arguments: { prompt: "" },
    });
  } catch (error) {
    invalid = error;
  }
  if (invalid?.isError !== undefined) assert.equal(invalid.isError, true);
  else
    assert.match(
      String(invalid?.message ?? invalid),
      /prompt|invalid|validation/i,
    );
  const outside = await pair.client.callTool({
    name: "antigravity_run",
    arguments: { prompt: "ok", workspace: os.tmpdir(), timeout_seconds: 10 },
  });
  assert.equal(outside.isError, true);
  assert.equal(valueOf(outside).status, "CONFIG_ERROR");

  const denied = await pair.client.callTool({
    name: "antigravity_run",
    arguments: { prompt: "ok", autonomy: "full", timeout_seconds: 10 },
  });
  assert.equal(denied.isError, true);
  assert.equal(valueOf(denied).status, "POLICY_ERROR");

  const unsafeModel = await pair.client.callTool({
    name: "antigravity_run",
    arguments: {
      prompt: "ok",
      model: "--dangerously-skip-permissions",
      timeout_seconds: 10,
    },
  });
  assert.equal(unsafeModel.isError, true);
  assert.match(
    String(unsafeModel.content?.[0]?.text),
    /model must not start with a dash/i,
  );
});

test("progress notifications and bounded tool results survive the MCP boundary", async (t) => {
  const pair = await connected({ AGY_MCP_MAX_OUTPUT_CHARS: "1024" });
  t.after(() => closePair(pair));
  const progress = [];
  const result = await pair.client.callTool(
    {
      name: "antigravity_run",
      arguments: { prompt: "progress", timeout_seconds: 10 },
    },
    { onprogress: (notification) => progress.push(notification) },
  );
  assert.equal(valueOf(result).ok, true);
  assert.ok(
    progress.some(
      (item) => typeof item.message === "string" && item.message.length > 0,
    ),
  );

  const large = await pair.client.callTool({
    name: "antigravity_run",
    arguments: { prompt: "large", timeout_seconds: 10 },
  });
  const largeValue = valueOf(large);
  assert.equal(largeValue.ok, true);
  assert.equal(largeValue.truncated, true);
  assert.ok(large.content[0].text.length <= 1_024);
});

test(
  "client cancellation stops an active agy subprocess",
  { timeout: 8_000 },
  async (t) => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "agy-mcp-cancel-"));
    const pidFile = path.join(temp, "pid");
    const pair = await connected({ TEST_PID_FILE: pidFile });
    t.after(async () => {
      await closePair(pair);
      rmSync(temp, { recursive: true, force: true });
    });
    const controller = new AbortController();
    const pending = pair.client.callTool(
      {
        name: "antigravity_run",
        arguments: { prompt: "hang", timeout_seconds: 10 },
      },
      { signal: controller.signal },
    );
    await waitFor(() => existsSync(pidFile));
    const pid = Number(readFileSync(pidFile, "utf8"));
    controller.abort();
    await assert.rejects(pending, /abort|cancel|closed/i);
    await waitFor(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch (error) {
        return error?.code === "ESRCH";
      }
    }, 4_000);
    const models = await pair.client.callTool({
      name: "antigravity_models",
      arguments: {},
    });
    assert.equal(models.isError, false);
  },
);

test(
  "server stdin EOF shuts down an active subprocess",
  { timeout: 8_000 },
  async (t) => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "agy-mcp-eof-"));
    const pidFile = path.join(temp, "pid");
    const pair = await connected({ TEST_PID_FILE: pidFile });
    t.after(async () => {
      await closePair(pair);
      rmSync(temp, { recursive: true, force: true });
    });
    const pending = pair.client.callTool({
      name: "antigravity_run",
      arguments: { prompt: "hang", timeout_seconds: 10 },
    });
    await waitFor(() => existsSync(pidFile));
    const pid = Number(readFileSync(pidFile, "utf8"));
    const child = pair.transport._process;
    assert.ok(child, "stdio transport child process is unavailable");
    const childExit = new Promise((resolve) =>
      child.once("exit", (code, signal) => resolve({ code, signal })),
    );
    const pendingFailure = assert.rejects(pending, /closed|abort|cancel/i);
    child.stdin.end();
    await pendingFailure;
    const exit = await childExit;
    assert.equal(exit.code, 0);
    assert.equal(
      exit.signal,
      null,
      `server process was terminated by ${exit.signal ?? "unknown signal"}`,
    );
    await waitFor(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch (error) {
        return error?.code === "ESRCH";
      }
    }, 4_000);
  },
);
