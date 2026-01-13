# bin/achilles-cli - Achilles CLI Wrapper

## Overview

Wrapper script for the Achilles Agent Library CLI. Locates and executes the achilles-cli from node_modules with support for multiple installation paths.

## Source File

`bin/achilles-cli`

## Complete Implementation

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Support both legacy and scoped install paths.
ACHILLES_CLI=""
CANDIDATES=(
    "${REPO_ROOT}/node_modules/AchillesAgentLib/bin/achilles-cli"
    "${REPO_ROOT}/node_modules/achillesAgentLib/bin/achilles-cli"
    "${REPO_ROOT}/node_modules/AchillesAgentLib/bin/achiles-cli"
    "${REPO_ROOT}/node_modules/achillesAgentLib/bin/achiles-cli"
)

for candidate in "${CANDIDATES[@]}"; do
    if [[ -f "${candidate}" ]]; then
        ACHILLES_CLI="${candidate}"
        break
    fi
done

if [[ -z "${ACHILLES_CLI}" ]]; then
    echo "Unable to locate Achilles CLI under node_modules." >&2
    exit 1
fi

exec "${ACHILLES_CLI}" "$@"
```

## Behavior

### Path Resolution

Searches for the Achilles CLI in multiple locations to support:
- Different package name casings (`AchillesAgentLib`, `achillesAgentLib`)
- Typo variants (`achilles-cli`, `achiles-cli`)

### Execution

When found, executes the CLI with all passed arguments:

```bash
achilles-cli skill list
achilles-cli skill run my-skill
```

### Error Handling

Exits with error message if CLI cannot be located:

```
Unable to locate Achilles CLI under node_modules.
```

## Shell Options

- `set -e`: Exit on error
- `set -u`: Exit on undefined variable
- `set -o pipefail`: Propagate pipe errors

## Search Order

1. `node_modules/AchillesAgentLib/bin/achilles-cli`
2. `node_modules/achillesAgentLib/bin/achilles-cli`
3. `node_modules/AchillesAgentLib/bin/achiles-cli`
4. `node_modules/achillesAgentLib/bin/achiles-cli`

## Command Flow

```
┌─────────────────────────────────────────────────────────┐
│                   bin/achilles-cli                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  achilles-cli [args...]                                 │
│       │                                                 │
│       ▼                                                 │
│  Search CANDIDATES for existing file                    │
│       │                                                 │
│       ├── Found: exec "${ACHILLES_CLI}" "$@"            │
│       │                                                 │
│       └── Not found: echo error; exit 1                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Purpose

- Provides stable CLI access regardless of package name variations
- Handles npm package naming inconsistencies
- Allows Achilles skills management from project root

## Related Modules

- [../cli/services/service-agents.md](../cli/services/service-agents.md) - Agent management
