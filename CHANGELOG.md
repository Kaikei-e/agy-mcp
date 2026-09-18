# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial local MCP bridge for Antigravity CLI runs, conversation continuation, and model listing.
- OSS documentation, contribution guidance, security reporting guidance, a Claude Code configuration example, and continuous integration.
- Configurable parallel CLI execution with `AGY_MCP_MAX_CONCURRENT` (default 4, range 1–32), per-call cancellation, conversation-ID locks, and exclusive latest-conversation continuation. Set the limit to 1 for the previous serial behavior.
