# CLI Command Evaluations

## Overview

Evaluation scenarios for Ploinky command-line interface operations. Tests cover command parsing, argument handling, output formatting, and error reporting.

## Scenarios

### Core Commands

#### cli-init-workspace
Verify workspace initialization.

**Steps**:
1. Run `ploinky init` in empty directory
2. Verify .ploinky directory created
3. Check default configuration files
4. Verify workspace structure

**Expected**: Complete workspace with all required directories

---

#### cli-list-agents
Verify agent listing output.

**Steps**:
1. Create multiple agents
2. Run `ploinky list`
3. Verify output format
4. Check status accuracy

**Expected**: All agents listed with correct status

---

#### cli-start-agent
Verify agent start command.

**Steps**:
1. Run `ploinky start agent-name`
2. Verify container created
3. Check routing registered
4. Confirm health check passes

**Expected**: Agent running and accessible

---

#### cli-stop-agent
Verify agent stop command.

**Steps**:
1. Start an agent
2. Run `ploinky stop agent-name`
3. Verify container stopped
4. Check routing removed

**Expected**: Clean shutdown, resources freed

---

#### cli-connect-agent
Verify agent connection.

**Steps**:
1. Start an agent
2. Run `ploinky connect agent-name`
3. Verify terminal session
4. Test input/output

**Expected**: Interactive session established

### Configuration Commands

#### cli-config-get
Verify configuration retrieval.

**Steps**:
1. Set configuration values
2. Run `ploinky config get key`
3. Verify correct value returned

**Expected**: Accurate configuration values

---

#### cli-config-set
Verify configuration modification.

**Steps**:
1. Run `ploinky config set key value`
2. Verify value persisted
3. Check file updated

**Expected**: Configuration saved correctly

### Profile Commands

#### cli-profile-list
Verify profile listing.

**Steps**:
1. Create multiple profiles
2. Run `ploinky profile list`
3. Verify all profiles shown

**Expected**: Complete profile list

---

#### cli-profile-activate
Verify profile activation.

**Steps**:
1. Create profile with specific settings
2. Run `ploinky profile activate name`
3. Verify settings applied

**Expected**: Profile settings active

### Error Handling

#### cli-invalid-command
Verify unknown command handling.

**Steps**:
1. Run `ploinky unknown-command`
2. Verify error message
3. Check exit code

**Expected**: Clear error message, non-zero exit

---

#### cli-missing-argument
Verify missing argument handling.

**Steps**:
1. Run command without required argument
2. Verify error message
3. Check usage hint provided

**Expected**: Helpful error with usage

---

#### cli-invalid-agent
Verify invalid agent name handling.

**Steps**:
1. Run `ploinky start nonexistent`
2. Verify error message
3. Check suggestions provided

**Expected**: Clear error, possible corrections

### Output Formats

#### cli-json-output
Verify JSON output mode.

**Steps**:
1. Run `ploinky list --json`
2. Parse output as JSON
3. Verify structure

**Expected**: Valid, parseable JSON

---

#### cli-quiet-mode
Verify quiet output mode.

**Steps**:
1. Run `ploinky start --quiet`
2. Verify minimal output
3. Check exit code correct

**Expected**: Only essential output

## Test Matrix

| Scenario | Priority | Automation |
|----------|----------|------------|
| cli-init-workspace | P0 | Automated |
| cli-list-agents | P0 | Automated |
| cli-start-agent | P0 | Automated |
| cli-stop-agent | P0 | Automated |
| cli-connect-agent | P1 | Manual |
| cli-config-get | P1 | Automated |
| cli-config-set | P1 | Automated |
| cli-profile-list | P2 | Automated |
| cli-profile-activate | P2 | Automated |
| cli-invalid-command | P1 | Automated |
| cli-missing-argument | P1 | Automated |
| cli-invalid-agent | P1 | Automated |
| cli-json-output | P1 | Automated |
| cli-quiet-mode | P2 | Automated |

## Command Reference

| Command | Category | Description |
|---------|----------|-------------|
| `init` | Core | Initialize workspace |
| `list` | Core | List agents |
| `start` | Core | Start agent |
| `stop` | Core | Stop agent |
| `restart` | Core | Restart agent |
| `connect` | Core | Connect to agent |
| `status` | Core | Show status |
| `config` | Config | Manage configuration |
| `profile` | Config | Manage profiles |
| `repo` | Management | Manage repositories |
| `test` | Testing | Run tests |

## Related Specifications

- [../../DS/DS05-cli-commands.md](../../DS/DS05-cli-commands.md) - CLI Command Reference
- [../../src/cli/commands/](../../src/cli/commands/) - Command implementation docs
