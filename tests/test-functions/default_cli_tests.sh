#!/bin/bash

# Capture default CLI help output.
run_default_cli_help() {
  load_state
  require_var "TEST_AGENT_TO_DISABLE_NAME" || return 1

  local agent="$TEST_AGENT_TO_DISABLE_NAME"
  local output
  local cmd_str

  printf -v cmd_str '%q ' ploinky cli "$agent" help
  cmd_str=${cmd_str% }

  if ! output=$(script -qfc "$cmd_str" /dev/null 2>&1); then
    echo "Failed to execute 'ploinky cli ${agent} help'." >&2
    return 1
  fi

  DEFAULT_CLI_HELP_OUTPUT="$output"
  export DEFAULT_CLI_HELP_OUTPUT
  return 0
}

# Validate that captured help output contains the expected banner.
default_cli_help_has_banner() {
  if [ -z "${DEFAULT_CLI_HELP_OUTPUT:-}" ]; then
    echo "DEFAULT_CLI_HELP_OUTPUT is empty; run_default_cli_help must run first." >&2
    return 1
  fi

  if ! grep -q "Ploinky default CLI" <<<"$DEFAULT_CLI_HELP_OUTPUT"; then
    echo "Default CLI help output missing expected banner." >&2
    printf '%s\n' "$DEFAULT_CLI_HELP_OUTPUT" >&2
    return 1
  fi

  return 0
}
