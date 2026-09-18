import { spawn, type ChildProcess } from "node:child_process";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  failure?: "SPAWN_ERROR" | "TIMEOUT" | "CANCELED" | "OUTPUT_LIMIT" | "BUSY";
  error?: string;
}

export interface ProcessOptions {
  bin: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxBufferBytes: number;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
}

const failureResult = (
  failure: ProcessResult["failure"],
  error: string,
): ProcessResult => ({
  stdout: "",
  stderr: "",
  exitCode: null,
  failure,
  error,
});

function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") {
      // Windows has no POSIX process groups. taskkill terminates descendants too.
      const killer = spawn(
        "taskkill",
        ["/pid", String(child.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      );
      killer.on("error", () => {
        child.kill(signal);
      });
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill(signal);
  }
}

/** One active CLI per server: no accidental overlap of --continue or shared CLI state. */
export class ProcessRunner {
  private active?: { stop: () => void; done: Promise<ProcessResult> };
  private closed = false;

  async close(): Promise<void> {
    this.closed = true;
    const active = this.active;
    active?.stop();
    await active?.done;
  }

  run(options: ProcessOptions): Promise<ProcessResult> {
    if (this.closed || options.signal?.aborted)
      return Promise.resolve(
        failureResult("CANCELED", "Request canceled before starting agy"),
      );
    if (this.active)
      return Promise.resolve(
        failureResult(
          "BUSY",
          "Another agy call is running. Wait for it to finish before retrying.",
        ),
      );

    let cancel = () => {};
    const done = new Promise<ProcessResult>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(options.bin, options.args, {
          cwd: options.cwd,
          env: { ...process.env, NO_COLOR: "1" },
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
          windowsHide: true,
          shell: false,
        });
      } catch (error) {
        resolve(failureResult("SPAWN_ERROR", String(error)));
        return;
      }
      let stdout = "";
      let stderr = "";
      let bytes = 0;
      let failure: ProcessResult["failure"];
      let error: string | undefined;
      let finished = false;
      let killTimer: NodeJS.Timeout | undefined;
      const stop = (reason: ProcessResult["failure"], message: string) => {
        if (finished || failure) return;
        failure = reason;
        error = message;
        killTree(child, "SIGTERM");
        killTimer = setTimeout(() => killTree(child, "SIGKILL"), 1_000);
      };
      cancel = () => stop("CANCELED", "Request canceled");
      const timeout = setTimeout(
        () =>
          stop("TIMEOUT", `agy exceeded ${options.timeoutMs / 1_000} seconds`),
        options.timeoutMs,
      );
      const finish = (exitCode: number | null) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        clearTimeout(killTimer);
        options.signal?.removeEventListener("abort", cancel);
        // A CLI may exit without reaping a tool it started.
        killTree(child, "SIGKILL");
        resolve({ stdout, stderr, exitCode, failure, error });
      };
      child.stdout!.setEncoding("utf8");
      child.stderr!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => {
        if (failure) return;
        bytes += Buffer.byteLength(chunk);
        if (bytes > options.maxBufferBytes) {
          stop(
            "OUTPUT_LIMIT",
            `agy stdout exceeded ${options.maxBufferBytes} bytes; narrow the task or raise AGY_MCP_MAX_BUFFER_BYTES`,
          );
          return;
        }
        stdout += chunk;
        options.onStdout?.(chunk);
      });
      child.stderr!.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-4_000);
      });
      child.on("error", (cause) => {
        failure = "SPAWN_ERROR";
        error = `Could not start ${options.bin}: ${cause.message}. Install agy or set AGY_MCP_BIN to its executable path.`;
        finish(null);
      });
      child.on("close", finish);
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) cancel();
    });
    const active = { stop: () => cancel(), done };
    this.active = active;
    void done.then(() => {
      if (this.active === active) this.active = undefined;
    });
    return done;
  }
}
