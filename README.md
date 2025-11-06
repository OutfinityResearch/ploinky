# Ploinky

Ploinky is a lightweight runtime for AI agents. It is technology‑agnostic: an agent can be implemented in any language as long as it reads from stdin and writes to stdout (a simple console process). Ploinky exposes that process as a terminal (Console) and also as a chat interface — the chat mirrors the same TTY stream for a nicer UX.

Beyond a single agent, Ploinky supports a multi‑agent workspace. Each agent runs in its own container. A local web router serves a simple web app and proxies API calls to the containers, so you can build applications that orchestrate multiple agents. A companion cloud component (in progress) will host multiple such custom apps, each with its own agents and routes.

## Prerequisites
- Node.js 18+
- Docker or Podman
- Git

## Getting started

```bash
# Clone and setup
git clone https://github.com/PlonkyRepos/ploinky.git
cd ploinky
export PATH="$PATH:$(pwd)/bin"

# Start the CLI
p-cli

# Enable an agent and start the workspace
enable agent my-agent
start my-agent 8088

# Web console (TTY + Chat)
console my-agent myPassword
```

## Usage

You can use Ploinky in two ways:

1.  **From within the project directory:**
    As shown in the "Getting started" section, you can run `p-cli` from within the cloned project directory.

2.  **Globally from any directory:**
    To use `ploinky` from anywhere, you need to add its location to your shell's configuration file (e.g., `.bashrc`, `.zshrc`).

    Add the following line to your `~/.bashrc` or `~/.zshrc` file, replacing `~/path/to/ploinky` with the actual path to your ploinky directory:

    ```bash
    export PATH="$PATH:~/path/to/ploinky/bin"
    ```

    After adding the line, restart your shell or run `source ~/.bashrc` (or `source ~/.zshrc`). You can then use `p-cli` or `ploinky` from any directory. For example:

    ```bash
    ploinky list agents
    ```

## Core commands (in p-cli)

- `enable agent <name> [as <alias>]`: register an agent in `.ploinky/agents` (creates a minimal manifest if missing). Use `as <alias>` to spin up additional instances with unique container names.
- `start <staticAgent> <port>`: first run requires a static agent and port; subsequent runs can just use `start`.
  - Ensures all enabled agents are running and launches the Router on `<port>`.
  - Serves static files from the repository of `<staticAgent>`; non `/mcps/...` paths are static.
- `console <name> <password> [port]`: start the WebConsole (TTY + Chat) for an agent.
- `cli <name> [args...]`: run the agent’s CLI command interactively.
- `shell <name>`: open interactive `/bin/sh` in the agent container.
- `client task <agent> [--parameters <params>] [-key value...]`: send a task to an agent.
- `client methods <agent>`: list available methods for an agent.
- `client status <agent>`: check agent health status.
- `stop`: stop containers recorded in `.ploinky/agents` (do not remove).
- `shutdown`: stop and remove containers recorded in `.ploinky/agents`.

## Notes

- Containers run with the workspace directory mounted read‑write at the same path inside the container.
- Ploinky’s `Agent` tools directory is mounted read‑only at `/Agent` in every container, providing a supervisor script and helpers.
- If an agent manifest lacks an `agent` command, the container runs `/Agent/AgentServer.sh` which supervises the default AgentServer and restarts it if it exits.

## Cloud (preview)

The cloud component will allow hosting multiple custom apps built on Ploinky, each with its own agents and routes.

## License

MIT License - see [LICENSE](LICENSE).
