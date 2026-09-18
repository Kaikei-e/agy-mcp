#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const prompt = value("-p");
const id = "055a398f-db14-4c5f-abbb-1bf03f8120a7";
const emit = (object) => process.stdout.write(`${JSON.stringify(object)}\n`);
if (args[0] === "--version") {
  console.log("1.2.6-test");
} else if (args[0] === "--help") {
  console.log(
    "--output-format --print-timeout --disable-slash-commands --conversation --mode --sandbox",
  );
} else if (args[0] === "models") {
  console.log("test-model\tTest Model");
} else if (prompt === "hang" || prompt === "tree") {
  process.on("SIGTERM", () => {});
  if (prompt === "tree") {
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    child.stdout.once("data", () =>
      writeFileSync(process.env.TEST_PID_FILE, String(child.pid)),
    );
  } else if (process.env.TEST_PID_FILE)
    writeFileSync(process.env.TEST_PID_FILE, String(process.pid));
  emit({ event: "init", conversation_id: id });
  setInterval(() => {}, 1_000);
} else if (prompt === "overflow") {
  process.stdout.write("x".repeat(100_000));
  setInterval(() => {}, 1_000);
} else if (prompt === "malformed") {
  console.log("Authentication required");
} else {
  emit({ event: "init", conversation_id: id });
  emit({
    event: "step_update",
    step_update: {
      step_type: "agent_response",
      text_delta: "not forwarded as progress",
    },
  });
  const result = {
    status: prompt === "error" ? "ERROR" : "SUCCESS",
    response:
      prompt === "empty"
        ? ""
        : prompt === "large"
          ? "語".repeat(80_000)
          : JSON.stringify({
              prompt,
              argv: args,
              cwd: process.cwd(),
              stdinIsTTY: Boolean(process.stdin.isTTY),
            }),
    conversation_id: id,
    duration_seconds: 0.01,
    usage: { total_tokens: 42 },
    ...(prompt === "error" ? { error: { message: "Model unavailable" } } : {}),
    ...(prompt === "denied"
      ? { denied_actions: [{ tool: "write_to_file" }] }
      : {}),
  };
  if (prompt === "stderr") process.stderr.write("diagnostic ".repeat(1_000));
  emit({ event: "result", result });
  // A diagnostic after the result must not replace it.
  emit({ event: "log", message: "done" });
  if (prompt === "nonzero" || prompt === "stderr") process.exitCode = 2;
}
