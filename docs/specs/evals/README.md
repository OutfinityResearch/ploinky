# Ploinky Evaluation Scenarios

## Overview

This directory contains evaluation scenarios for testing and validating Ploinky functionality. Evaluations are organized by feature area and designed to verify both individual components and integrated workflows.

## Directory Structure

```
evals/
├── README.md                    # This file
├── agent-lifecycle/             # Agent start/stop/restart scenarios
├── cli-commands/                # CLI command evaluations
├── web-interfaces/              # WebTTY, WebChat, WebMeet, Dashboard
└── multi-agent/                 # Multi-agent orchestration scenarios
```

## Evaluation Categories

### Agent Lifecycle

Tests for agent container lifecycle management:
- Container creation and startup
- Graceful shutdown
- Restart behavior
- Health check validation
- Resource cleanup

See: [agent-lifecycle/README.md](./agent-lifecycle/README.md)

### CLI Commands

Tests for command-line interface operations:
- Command parsing and validation
- Argument handling
- Output formatting
- Error reporting
- Interactive prompts

See: [cli-commands/README.md](./cli-commands/README.md)

### Web Interfaces

Tests for browser-based interfaces:
- WebTTY terminal sessions
- WebChat messaging and voice
- WebMeet video conferencing
- Dashboard monitoring

See: [web-interfaces/README.md](./web-interfaces/README.md)

### Multi-Agent

Tests for multi-agent orchestration:
- Agent-to-agent communication
- Task delegation
- Resource sharing
- Conflict resolution

See: [multi-agent/README.md](./multi-agent/README.md)

## Evaluation Format

Each evaluation scenario should include:

1. **Scenario Name**: Descriptive identifier
2. **Description**: What is being tested
3. **Prerequisites**: Required setup
4. **Steps**: Detailed test procedure
5. **Expected Outcome**: Success criteria
6. **Cleanup**: Post-test cleanup

### Example Scenario

```markdown
## Scenario: agent-basic-start

### Description
Verify that a basic agent can be started and responds to health checks.

### Prerequisites
- Docker/Podman installed
- Ploinky workspace initialized

### Steps
1. Run `ploinky start test-agent`
2. Wait for container to be running
3. Execute `ploinky status test-agent`
4. Verify health check response

### Expected Outcome
- Container starts within 30 seconds
- Health check returns 200 OK
- Status shows "running"

### Cleanup
- Run `ploinky stop test-agent`
- Verify container removed
```

## Running Evaluations

### Manual Execution

Navigate to scenario directory and follow README instructions.

### Automated Execution

Use the test runner:

```bash
# Run all evaluations
./bin/runPlonkyTests.sh

# Run specific category
ploinky test agent-lifecycle
```

## Adding New Evaluations

1. Choose appropriate category directory
2. Create scenario markdown file
3. Follow standard format
4. Add to category README
5. Verify with manual execution

## Coverage Goals

| Category | Coverage Target |
|----------|-----------------|
| Agent Lifecycle | Core CRUD operations |
| CLI Commands | All documented commands |
| Web Interfaces | Critical user flows |
| Multi-Agent | Key orchestration patterns |

## Related Documentation

- [../tests/README.md](../tests/README.md) - Automated test specifications
- [../DS/DS02-architecture.md](../DS/DS02-architecture.md) - System architecture
- [../DS/DS03-agent-model.md](../DS/DS03-agent-model.md) - Agent model
