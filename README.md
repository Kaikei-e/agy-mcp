# agy-mcp

[日本語](README.ja.md) · [Apache-2.0](LICENSE)

`agy-mcp` is a local [Model Context Protocol](https://modelcontextprotocol.io/) server that lets an MCP client delegate a task to the Google Antigravity CLI (`agy`). It uses stdio, starts `agy` as a child process, and returns the CLI result as structured MCP content.

It is designed for a personal local installation that can also be inspected, adapted, and contributed to as open source. It is not an Antigravity product and does not replace Antigravity's own access controls or account requirements.

## What it provides

| MCP tool               | Purpose                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `antigravity_run`      | Starts a new Antigravity conversation and returns its result and, when supplied by the CLI, its `conversation_id`. |
| `antigravity_continue` | Continues a conversation by ID. Without an ID, it asks `agy` to continue its latest conversation.                  |
| `antigravity_models`   | Runs `agy models` and returns the CLI output. It does not start a model turn, but it may contact Antigravity.      |

`run` and `continue` accept a prompt, an absolute workspace, optional model and effort, a mode (`plan` or `accept-edits`), an autonomy level, and a hard timeout. The server runs one `agy` command at a time. A simultaneous call receives `BUSY`; do not rely on this server for parallel CLI sessions.

List model slugs with `antigravity_models`, then use one in `model`.

```json
{
  "prompt": "Review the authentication flow and identify likely edge cases.",
  "workspace": "/absolute/path/to/workspace",
  "model": "a-slug-returned-by-antigravity_models",
  "mode": "plan",
  "autonomy": "safe",
  "timeout_seconds": 300
}
```

`timeout_seconds` defaults to 300 and accepts integers from 10 through 3600.

## Requirements

- Node.js 22 or newer
- pnpm 10 or newer (the repository pins pnpm 10.18.1)
- An installed, authenticated Antigravity CLI available as `agy`, or an executable path supplied through `AGY_MCP_BIN`
- A workspace that Antigravity is allowed to use

Read the [Antigravity CLI headless documentation](https://antigravity.google/docs/cli/headless/) for the CLI's installation, authentication, trust, permissions, and current behavior. This project uses the [official TypeScript MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk).

## Install from source

```bash
git clone https://github.com/Kaikei-e/agy-mcp.git
cd agy-mcp
pnpm install --frozen-lockfile
pnpm build
pnpm run doctor
```

`pnpm run doctor` checks the configured workspace and verifies that the installed `agy` advertises the CLI flags this bridge needs. It does not start a model turn. Authentication and workspace trust must still be established with Antigravity itself.

For an optional live smoke test after authenticating `agy`:

```bash
pnpm run probe
```

The probe invokes `run` and then `continue` on the returned conversation. It can consume your Antigravity quota and create a conversation. It is deliberately not part of CI.

## Connect an MCP client

Build the server, then configure the client to launch the compiled entry point. Copy [examples/claude-code.mcp.json](examples/claude-code.mcp.json), replace every absolute path with your own, and add it to the client configuration appropriate for your installation.

For Claude Code, a project `.mcp.json` entry can look like this:

```json
{
  "mcpServers": {
    "antigravity": {
      "command": "node",
      "args": ["/absolute/path/to/agy-mcp/dist/index.js"],
      "env": {
        "AGY_MCP_DEFAULT_WORKSPACE": "/absolute/path/to/workspace",
        "AGY_MCP_ALLOWED_ROOT": "/absolute/path/to"
      }
    }
  }
}
```

The server communicates over standard input and output. Do not wrap it in a command that writes diagnostic text to stdout. Configure the MCP client's own timeout slightly longer than the tool's `timeout_seconds`; progress notifications and heartbeats are useful status signals, but they do not guarantee that a client resets its timeout.

## Safety and workspace boundaries

The default request settings are `mode: "plan"` and `autonomy: "safe"`.

- `safe` inherits the permissions and workspace trust decisions made by `agy`. It is not a read-only guarantee.
- `sandbox` adds the CLI's terminal restrictions. Its scope and behavior are defined by Antigravity.
- `full` passes the CLI permission-bypass flag. It is rejected unless the server environment explicitly sets `AGY_MCP_ALLOW_FULL_AUTONOMY=true`.

Every supplied `workspace` must be an absolute, accessible directory. The server canonicalizes it before use. `AGY_MCP_ALLOWED_ROOT`, when set, permits only canonical workspaces beneath that root. This limits the selected workspace; it does **not** sandbox a child process's filesystem access or network access. Only point the server at workspaces and permissions you trust.

The bridge disables CLI slash-command expansion for prompts, but output returned by an agent remains untrusted data. Review proposed commands and edits before acting on them.

## Configuration

| Variable                      | Default                  | Meaning                                                                                      |
| ----------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `AGY_MCP_BIN`                 | `agy`                    | CLI executable name, or an absolute path or path relative to the server's current directory. |
| `AGY_MCP_DEFAULT_WORKSPACE`   | server current directory | Default workspace after resolution and canonicalization.                                     |
| `AGY_MCP_ALLOWED_ROOT`        | unset                    | Optional canonical root that must contain every chosen workspace.                            |
| `AGY_MCP_MAX_OUTPUT_CHARS`    | `40000`                  | Maximum characters in each MCP result representation; integer from 1024 to 1000000.          |
| `AGY_MCP_MAX_BUFFER_BYTES`    | `8388608`                | Maximum captured CLI stdout before the process is stopped; integer from 1024 to 67108864.    |
| `AGY_MCP_ALLOW_FULL_AUTONOMY` | `false`                  | Set exactly `true` to allow requests with `autonomy: "full"`.                                |

Each tool response supplies `structuredContent` and the same JSON in its text content. The whole representation, including error and metadata fields, is capped by `AGY_MCP_MAX_OUTPUT_CHARS`; truncated results say so. CLI stdout is independently capped by `AGY_MCP_MAX_BUFFER_BYTES`.

Long-running calls emit MCP progress metadata when the client provides a progress token, plus a heartbeat while the CLI is waiting. On cancellation, timeout, or output-limit failure, the server attempts to terminate the CLI process group on Linux and macOS. Windows termination is best effort; verify that no child process remains when that matters.

## Development

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm format:check
```

`pnpm pack` runs the package's `prepack` build before creating an archive. There is no automated npm publishing workflow.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) before filing an issue or pull request. Changes are released under the [Apache License 2.0](LICENSE).
