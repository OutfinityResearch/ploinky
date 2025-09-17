# Ploinky: Vision and User Guide

## 1. Vision

Ploinky is a lightweight, developer-centric runtime for AI agents and other command-line processes. Its core philosophy is to provide a secure and isolated environment for running any application that communicates over standard input/output, and to seamlessly expose it to users and other applications through modern web interfaces.

The key principles of Ploinky are:

*   **Isolation by Default:** Every agent runs in its own container (Docker or Podman), ensuring that it cannot interfere with the host system or other agents beyond its intended scope. This is crucial for running untrusted or experimental code, a common scenario in AI development.
*   **Developer Experience:** Ploinky is designed to be intuitive for developers. It uses a simple manifest file (`manifest.json`) to define an agent, and a powerful command-line interface (`p-cli`) to manage the entire lifecycle of agents and workspaces.
*   **Technology Agnostic:** An agent can be written in any language (Python, Node.js, Go, Bash, etc.) as long as it can run as a command-line process. Ploinky handles the rest.
*   **Self-Contained Workspaces:** All Ploinky configuration, logs, and running state are stored in a `.ploinky` directory within your project. This means no global dependencies or configurations, and you can easily version control your agent setup or share it with others.
*   **Seamless Web Integration:** Ploinky automatically provides web-based interfaces for your agents, including a terminal (WebTTY), a chat-like interface (WebChat), and a management dashboard, turning any CLI tool into a web service without any code changes.
*   **Microservice Orchestration:** Ploinky includes a routing server that can proxy API requests to different agents, allowing you to build complex applications by orchestrating multiple, single-purpose agents.

In essence, Ploinky aims to be the "glue" that connects command-line tools and AI agents to the web, providing a secure, scalable, and easy-to-use platform for development, testing, and deployment.

## 2. User Stories and Workflows

Here are the primary user stories for Ploinky, with a step-by-step guide on how to accomplish them.

---

### User Story 1: As a developer, I want to run an existing command-line tool as a persistent, web-accessible agent.

Let's say you have a simple Python script `bot.py` that you want to run as an agent.

**Workflow:**

1.  **Initialize Ploinky:**
    Open a terminal in your project directory and run the interactive CLI.

    ```bash
    p-cli
    ```
    This creates the `.ploinky` workspace directory.

2.  **Create an Agent Manifest:**
    Ploinky uses a `manifest.json` file to understand how to run your agent. You can create one manually or use the `enable agent` command to have Ploinky create a default one for you. Let's assume your `bot.py` is in a directory called `my-agent`.

    ```bash
    # Inside p-cli
    enable agent my-agent
    ```
    This command will register the agent and, if it doesn't exist, create a `my-agent/manifest.json` file. You would then edit this file to specify how to run your bot.

    **`my-agent/manifest.json`:**
    ```json
    {
      "agent": "python bot.py",
      "cli": "python",
      "container": {
        "image": "python:3.9-slim"
      }
    }
    ```

3.  **Start the Agent:**
    The `start` command launches the agent's container and the routing server. The first time you run `start`, you need to specify a "static" agent, which is used to serve the main web interface.

    ```bash
    # Inside p-cli
    start my-agent 8088
    ```
    This command tells Ploinky to:
    *   Start the `my-agent` container.
    *   Start the `RoutingServer` on port `8088`.
    *   Use `my-agent` to serve any static files (like a web UI if you had one).

4.  **Interact with the Agent via Web Console:**
    Now that your agent is running, you can access it through a web terminal.

    ```bash
    # Inside p-cli
    console my-agent myPassword
    ```
    This command will output a URL. Open it in your browser, and you'll have a full terminal session inside your agent's container.

---

### User Story 2: As a developer, I want to manage multiple agents within a single project.

Imagine you have two agents: a `database-agent` and a `reporting-agent` that queries the database.

**Workflow:**

1.  **Enable Both Agents:**
    First, make sure both agents have their `manifest.json` files and are enabled in Ploinky.

    ```bash
    # Inside p-cli
    enable agent database-agent
    enable agent reporting-agent
    ```

2.  **Start the Workspace:**
    When you run `start`, Ploinky automatically starts all enabled agents.

    ```bash
    # Inside p-cli
    start database-agent 8088
    ```
    Even though you only specified `database-agent` (as the static agent), Ploinky will find and start `reporting-agent` as well.

3.  **Check the Status:**
    You can see all running agents with the `status` command.

    ```bash
    # Inside p-cli
    status
    ```
    The output will show you the container ID, port mappings, and status for both `database-agent` and `reporting-agent`.

4.  **Interact with Each Agent:**
    You can open separate web consoles or shell sessions for each agent.

    ```bash
    # Inside p-cli
    console database-agent dbPass
    console reporting-agent reportPass
    ```

---

### User Story 3: As an administrator, I want a dashboard to monitor the status of all running agents and services.

**Workflow:**

1.  **Start Admin Mode:**
    The `admin-mode` command launches the Ploinky dashboard, along with other web services.

    ```bash
    # Inside p-cli
    admin-mode
    ```

2.  **Access the Dashboard:**
    Ploinky will output a URL for the dashboard (usually on port 9000). Open this URL in your browser.

3.  **Monitor Your Workspace:**
    The dashboard provides a high-level overview of your Ploinky workspace, including:
    *   A list of all running agents and their status.
    *   Statistics on requests, errors, and uptime.
    *   Links to manage repositories, configurations, and virtual hosts.

---

### User Story 4: As a developer, I want to build a web application that makes API calls to different agents.

Let's say your `database-agent` exposes an API, and you want to call it from a frontend application served by a `frontend-agent`.

**Workflow:**

1.  **Define Your Agents:**
    *   **`database-agent/manifest.json`**:
        ```json
        {
          "agent": "node api-server.js",
          "container": { "image": "node:18" }
        }
        ```
    *   **`frontend-agent/manifest.json`**:
        ```json
        {
          "agent": "node static-server.js",
          "container": { "image": "node:18" }
        }
        ```
        The `frontend-agent` would serve your HTML, CSS, and JavaScript files.

2.  **Start the Workspace with the Frontend Agent as Static:**
    This tells Ploinky to serve the web app from `frontend-agent`.

    ```bash
    # Inside p-cli
    start frontend-agent 8080
    ```
    Ploinky will also start the `database-agent`.

3.  **Make API Calls from the Frontend:**
    The `RoutingServer` (running on port 8080) creates a unified API gateway. In your frontend JavaScript, you can make calls to the database agent like this:

    ```javascript
    // In your frontend code (e.g., app.js)
    fetch('/apis/database-agent/users')
      .then(response => response.json())
      .then(data => console.log(data));
    ```
    Ploinky's `RoutingServer` automatically knows that requests to `/apis/database-agent/...` should be forwarded to the `database-agent` container. This allows you to build a complete application by composing independent agents.

---

### User Story 5: As a developer, I want to interact with my agent through a chat-like interface.

If you have a conversational AI or a tool that works well with a question-and-answer format, you can use WebChat.

**Workflow:**

1.  **Start the WebChat Service:**
    The `webchat` command starts a web server that wraps your agent's process in a chat UI.

    ```bash
    # Inside p-cli
    webchat my-agent myPassword
    ```

2.  **Open the Chat Interface:**
    Open the URL provided by the command. You will see a chat window.

3.  **Interact with Your Agent:**
    *   When you type a message and hit send, the text is sent to your agent's standard input.
    *   Anything your agent prints to standard output will appear as a message from the bot in the chat window.

This provides a much more user-friendly experience for conversational agents than a raw terminal.
