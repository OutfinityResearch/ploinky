# Repository Guidelines

## Project Structure & Module Organization
- `cli/` contains the router, auth, and agent gateway services that power the local runtime.
- `Agent/` supplies shared scripts mounted into every agent container.
- `dashboard/` holds the lightweight web UI served by the router.
- `tests/` includes CLI regression scripts (`tests/cli/`) and focused smoke suites (`tests/smoke/`).
- `bin/` exposes entry points such as `p-cli` and `p-cloud` for workspace and cloud workflows.

## Build, Test, and Development Commands
- `npm install` downloads workspace dependencies and clones the shared agent library.
- `npm test` (or `./tests/run-all.sh`) executes the full regression harness, including smoke and CLI suites.
- `tests/smoke/test_all.sh` runs the fast “start→restart” and “start→stop→start” smoke checks; prefer this during iteration.
- `bin/p-cli` starts the interactive command-line experience for enabling agents, launching containers, and inspecting logs.

## Coding Style & Naming Conventions
- JavaScript/Node modules use ES module syntax with `import`/`export`, four-space indentation, and trailing commas for multi-line literals.
- New files should live beside related logic (e.g., `cli/server/` for router concerns) and use descriptive camelCase filenames.
- Configuration JSON (routing, agent manifests) is formatted with two-space indentation for readability.

## Testing Guidelines
- Smoke scripts live in `tests/smoke/` and must avoid redundant container restarts; add new checks as discrete functions that rely on the shared harness in `tests/smoke/common.sh`.
- CLI regression tests reside in `tests/cli/` and follow the pattern `*.sh` or `*.mjs`; name new files after the command under test (e.g., `agent_lifecycle.sh`).
- Always run `tests/smoke/test_all.sh` before submitting changes that touch startup, restart, or shell behaviour.
- Always run `tests/fast/test_all.sh` before submitting changes that touch startup, restart, or shell behaviour.

## Commit & Pull Request Guidelines
- Write commits in the style “verb present-tense: summary” (e.g., “Add smoke harness helpers”), grouping unrelated changes into separate commits.
- Pull requests should link any relevant issues, outline behavioural impact, and include reproduction steps or smoke-test output when touching runtime flows.
- Add screenshots or terminal captures when modifying dashboard UI or CLI user-facing prompts.
