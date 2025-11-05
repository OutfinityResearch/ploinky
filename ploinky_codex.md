# Vision
Ploinky is a lightweight multi-agent runtime that turns ordinary console programs into collaborative services. Every agent runs inside its own Docker/Podman container with the project workspace mounted in, while a local RoutingServer fronts the fleet with static asset hosting, token-protected web surfaces, and `/mcps/<agent>` HTTP proxies. The CLI keeps configuration in the `.ploinky` directory, so workspaces stay portable and reproducible. Although a hosted cloud is on the roadmap, the current focus is empowering local builders to compose agents, route traffic between them, and ship bespoke tooling without leaving their machine.

## User Stories

### Story 1 – Launch and Initialize the Workspace
**User story:** As a developer, I want to prepare a local Ploinky workspace so that I can manage agents from the CLI.

**How to do it in Ploinky**
1. Install prerequisites: Node.js 18+, Docker or Podman, and Git.
2. Clone the repository and add `bin/` to your `PATH` so the `p-cli` launcher is available.
3. Run `p-cli` once from your project directory; the CLI bootstraps `.ploinky/` (agents registry, repos folder, secrets file) on first run.
4. Type `help` inside the CLI to review the available commands and categories.

### Story 2 – Manage the Repository Catalog
**User story:** As a workspace maintainer, I want to control which agent repos are installed and enabled so that my team sees the right catalog.

**How to do it in Ploinky**
1. Run `list repos` to view predefined catalogs (`basic`, `cloud`, `vibe`, `security`, `extra`, `demo`) along with install/enabled flags.
2. Enable a catalog with `enable repo <name>`; the CLI clones it into `.ploinky/repos/<name>` if needed and records the preference.
3. Disable a catalog with `disable repo <name>` when you want it hidden from listings but still on disk.
4. Add a new remote catalog with `add repo <alias> <git-url>` for private or experimental agents.
5. Keep a repo current with `update repo <name>`; this runs `git pull --rebase --autostash` inside the local clone.

### Story 3 – Discover Available Agents
**User story:** As a builder, I want to browse the agents shipped in my enabled repos so I can decide which ones to use.

**How to do it in Ploinky**
1. After enabling repos, run `list agents` to print each repo header followed by its agents and `about` text from `manifest.json`.
2. Note that the listing mirrors the data under `.ploinky/repos/<repo>/<agent>`, so you can inspect manifests directly if you need richer detail.
3. Repeat `list agents` whenever you install or enable additional repositories to refresh the catalog.

### Story 4 – Register Agents in the Workspace
**User story:** As an operator, I want specific agents to be managed by this workspace so that `start`, `status`, and lifecycle commands include them.

**How to do it in Ploinky**
1. Enable an agent with `enable agent <name>`; accept short names when unique, or use `repo/name` (or `repo:name`) to disambiguate.
2. The CLI writes a record into `.ploinky/agents` with the container image, mounts, and metadata; the command output confirms the repo and short name.
3. Run `status` to verify the agent now appears under the **Agents** section with container details and route hints.
4. Repeat for every agent you want in the workspace; `start` will respect the registry entries and launch containers only for registered agents.

### Story 5 – Create a New Agent Skeleton
**User story:** As an agent author, I want a boilerplate agent directory so that I can begin coding immediately.

**How to do it in Ploinky**
1. Choose a target repo under `.ploinky/repos/` (for example `basic`).
2. Run `new agent <repo> <agent-name> [image]`; the CLI scaffolds `<repo>/<agent-name>/manifest.json` using the optional base image (default `node:18-alpine`).
3. Open the generated manifest to fill in fields such as `about`, `agent`, `cli`, `install`, or `commands.run` according to your runtime needs.
4. Commit the new agent directory back to source control or keep it local for experimentation.

### Story 6 – Update or Refresh Existing Agents
**User story:** As a maintainer, I want to adjust agent behaviour or recover failed installs so that containers stay in sync with manifests.

**How to do it in Ploinky**
1. Edit the agent's `manifest.json` directly to adjust fields such as container image, install/update commands, CLI command, agent command, and description.
2. Apply filesystem edits or dependency changes to your agent code as needed.
3. Run `refresh agent <name>` to force the service container to stop, rebuild with the latest manifest, rerun `install`, and restart the long-lived command.
4. For single-run CLI containers, re-run `cli` or `shell` after the refresh to pick up the new environment.

### Story 7 – Manage Secrets and Environment Exposure
**User story:** As a developer, I want to store secrets once and surface them to specific agents so that sensitive data stays centralized.

**How to do it in Ploinky**
1. Store a value with `var <VAR> <value>`; secrets live in `.ploinky/.secrets` and can reference other variables via `$OTHER` aliases.
2. Print values with `echo <VAR>` or resolved aliases with `echo $VAR` to confirm configuration.
3. Call `expose <ENV_NAME> <$VAR|value> [agent]` to write the exposure into an agent manifest; omit the agent to target the static agent configured via `start`.
4. Restart or refresh the agent so the new environment variable is available inside the container via `process.env` (Node) or `os.getenv` (Python).

### Story 8 – Start the Workspace Router and Static App
**User story:** As an operator, I want to serve my agents through the Ploinky router so that web apps and /mcps routes become available.

**How to do it in Ploinky**
1. Make sure the desired static agent is enabled; this agent contributes static assets and optionally depends on additional agents via its `manifest.enable` list.
2. Run `start <staticAgent> <port>` the first time (for example `start demo 8088`); subsequent launches can omit arguments to reuse the stored configuration.
3. The CLI updates `.ploinky/routing.json`, refreshes component tokens quietly, ensures containers exist for every registered agent, and spawns the RoutingServer.
4. Watch for the `Static: agent=<name> port=<port>` banner and the container creation logs to confirm everything started successfully.

### Story 9 – Monitor Workspace Status and Routing
**User story:** As an operator, I want a quick health report so that I can understand which agents are running and how to reach them.

**How to do it in Ploinky**
1. Run `status` at any time; it prints workspace identity, static agent, interface token hints, router PID status, and each enabled agent with container info.
2. Inspect the `api` URL shown for running agents (e.g., `http://127.0.0.1:<hostPort>/mcp`) to confirm reverse proxies are active.
3. Use the command output to identify stopped containers, exit codes, required ports, or missing tokens before troubleshooting further.

### Story 10 – Rotate Web Interface Tokens and Configure WebMeet
**User story:** As an administrator, I want to control browser access to terminals, chat, dashboards, and meetings so the workspace stays secure.

**How to do it in Ploinky**
1. Run `webtty`, `webchat`, or `dashboard` to mint new 32-byte tokens; each command prints a ready-to-open URL like `http://127.0.0.1:8088/webtty?token=...` and stores the value in `.ploinky/.secrets`.
2. Use `webmeet` to rotate the meeting token; pass an optional moderator agent (`webmeet demo/moderator`) to store it in `WEBMEET_AGENT` before refreshing the token.
3. Share the generated URLs (or just the token) with trusted collaborators; they gate access to the router’s `/webtty`, `/webchat`, `/webmeet`, and `/dashboard` endpoints.
4. Re-run the commands any time you need to revoke prior tokens.

### Story 11 – Interact with an Agent’s CLI Entry Point
**User story:** As a developer, I want to trigger the command-line behaviour defined by an agent so I can test or drive it manually.

**How to do it in Ploinky**
1. Ensure the target agent is enabled and running (via `start` or `refresh agent`).
2. Run `cli <agentName> [args...]`; the CLI resolves `manifest.cli` (or fallback) and attaches an interactive TTY to the agent container.
3. Work within the agent’s REPL or command interface; exit the session to return to the Ploinky CLI without stopping the container.

### Story 12 – Open a Shell Inside an Agent Container
**User story:** As an engineer, I want direct shell access to debug or inspect runtime state inside an agent container.

**How to do it in Ploinky**
1. Run `shell <agentName>`; the CLI ensures the container exists, starts it if necessary, and attaches `/bin/sh` with your workspace mounted at the same path.
2. Inspect files under `/code` (agent repo) or your project directory; run diagnostics or edit configuration as needed.
3. Exit the shell to detach; the container keeps running if the agent command is long-lived.

### Story 13 – Send API Requests Through the Router Client
**User story:** As a tester, I want to call agent APIs without leaving the terminal so I can verify behaviour quickly.

**How to do it in Ploinky**
1. Use `client methods <agent>` to send `{command:"methods"}` through the router and list exposed capabilities (if implemented by the agent).
2. Run `client status <agent>` to check the agent’s health response and HTTP code.
3. Send structured payloads with `client task <agent> -key value ...`; omit the agent name to target the static agent configured via `start`.
4. Inspect the JSON response printed to the terminal; the command uses `/mcps/<agent>` on the router at the current port recorded in `.ploinky/routing.json`.

### Story 14 – Manage Agent and Router Lifecycles
**User story:** As an operator, I want to keep containers healthy and reclaim resources when needed.

**How to do it in Ploinky**
1. Restart a single agent container with `restart <agent>`; the CLI rebuilds the service container and reports the new container name.
2. Restart the entire workspace with plain `restart`; it stops the router, stops all registered agent containers, and re-runs `start`.
3. Stop containers without removing them via `stop`; use `shutdown` to stop and remove only the registered agent containers in `.ploinky/agents`.
4. Use `destroy` or `clean` to remove every workspace container tracked by Ploinky (after killing the router); prefer `destroy` when you want a full reset.
5. For one-off reinstall of an agent’s dependencies, rely on `refresh agent <name>` (see Story 6).
6. Agents can now define `health` probes inside their manifest so the CLI can automatically re-check liveness/readiness:
   ```json
   "health": {
       "liveness": { "script": "liveness_probe.sh", "interval": 2, "timeout": 5, "failureThreshold": 5, "successThreshold": 1 },
       "readiness": { "script": "readiness_probe.sh" }
   }
   ```
   Scripts live in the agent root (mounted at `/code`), run via `docker exec`, and rely on exit codes for pass/fail. Missing probes default to “healthy”; repeated liveness failures trigger container restarts with a CrashLoopBackOff (base delay 10s, exponential up to 5 minutes, reset after 10 minutes of stable uptime or any manual stop/restart/refresh), while readiness failures only emit `Container failed to become ready` warnings for now.

### Story 15 – Inspect Router and WebTTY Logs
**User story:** As a troubleshooter, I want tail access to router-side logs so that I can diagnose routing or UI issues.

**How to do it in Ploinky**
1. Run `logs tail router` to follow live RoutingServer output; use `logs tail webtty` for the WebTTY process.
2. Grab the last N lines with `logs last <count> [router|webtty]`, e.g., `logs last 200 router`.
3. Combine these logs with `status` output and container logs (`docker logs <name>`) if deeper debugging is required.

### Story 16 – Understand Workspace Files and Mounted Resources
**User story:** As a contributor, I want to know where Ploinky stores its state so that I can back it up or inspect it manually.

**How to do it in Ploinky**
1. Recognize that `.ploinky/agents` is the JSON registry used for lifecycle commands; edit with caution.
2. `.ploinky/repos/` holds cloned agent repositories; you can open them directly in your editor for development.
3. `.ploinky/.secrets` stores key-value pairs created by `set`, interface tokens, and other workspace secrets.
4. The `Agent/` directory inside the codebase is mounted read-only at `/Agent` in every container, providing the default supervisor and boot scripts.
5. Use `start` and `status` to regenerate derived files (`.ploinky/routing.json`, `.ploinky/running/router.pid`) instead of manual edits.

## Codex Notes (2025-10-21)
- **CLI core (`cli/index.js`)** boots readline shell, wires commands from `cli/commands/cli.js`, and relies on services under `cli/services/` for repo/agent lifecycle, Docker orchestration, auth tokens, and environment bootstrap (`config.js`, `workspace.js`).
- **State layout (`.ploinky/`)** keeps JSON registries (`agents`, `enabled_repos.json`), cloned repos, secrets, and runtime pid/port files; `agents.js` builds container configs that mount `/Agent` and agent code alongside project workspaces.
- **Docker integration** lives in `cli/services/docker/`, providing container name helpers, manifest port parsing, environment hashing, and lifecycle commands (`ensureAgentService`, `stopConfiguredAgents`, `destroyWorkspaceContainers`).
- **Routing stack (`cli/server/`)** exposes HTTP router (`RoutingServer.js`) that auth-protects dashboards/webtty/webchat/webmeet, proxies `/mcps/<agent>` requests (including MCP websockets), serves static assets, and logs to `logs/router.log` via `utils/logger.js`.
- **Shared agent runtime (`Agent/`)** supplies the default shell/supervisor scripts (`AgentServer.sh`, `AgentServer.mjs`) and MCP browser client mounted into each container; manifests default to these when no custom agent command is provided.
- **Front-end assets**: historical dashboard static files live both under `dashboard/` and `cli/server/dashboard/`; webchat/webtty/webmeet handlers pair with assets in their respective directories.
- **Testing harness** spans shell-based suites in `tests/cli/`, smoke sequences in `tests/smoke/`, fast/unit folders, and additional router checks; `bin/runPlonkyTests.sh` aggregates them when `npm test` runs.
- **Demo content** under `demo-repo/` includes sample manifests, scripts, and simulator used by docs/tutorial flows; `.ploinky/enabled_repos.json` enables `demo` by default.
