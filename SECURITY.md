# Security policy

## Supported versions

Security fixes are made against the latest version on the default branch. This project is new and does not maintain separate release branches.

## Reporting a vulnerability

Please do not disclose a suspected vulnerability in a public issue. If this repository's GitHub security page offers private advisory reporting, use it. If it does not, open a public issue that asks the maintainer for a private reporting channel without including vulnerability details, credentials, private prompts, or workspace contents.

Include a clear description, affected version or commit, reproduction steps, impact, and any suggested mitigation. Do not include credentials, access tokens, private prompts, or private workspace contents. Once a private channel is established, reports are triaged there; response and fix timing depend on severity and reproducibility.

## Scope

Useful reports include flaws in workspace validation, command construction, process handling, output handling, MCP protocol behavior, dependency vulnerabilities, and documentation that overstates a security boundary. The Antigravity service, its CLI account authentication, and MCP client configuration are controlled by their respective providers, though integration issues are welcome when they affect this bridge.
