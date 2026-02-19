#!/bin/bash

# Resolve the nearest .env by walking up from the project test directory.
_resolve_llm_env() {
  local dir="$TESTS_DIR"
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/.env" ]]; then
      echo "$dir/.env"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  return 1
}

# Source the .env so API keys are exported into the current shell
# and inherited by ploinky subprocesses via process.env.
_load_llm_keys() {
  local env_file
  if env_file=$(_resolve_llm_env); then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
    return 0
  fi
  echo "No .env with LLM API keys found (searched upwards from $TESTS_DIR)." >&2
  return 1
}

# Ensure CLI can forward system commands and surface LLM fallback suggestions.
test_llm_cli_suggestions() {
  load_state

  local output

  if ! output=$(ploinky ls -a 2>&1); then
    echo "'ploinky ls -a' failed." >&2
    return 1
  fi

  if ! grep -q ".ploinky" <<<"$output"; then
    echo "Expected '.ploinky' in 'ploinky ls -a' output." >&2
    printf '%s\n' "--- ploinky ls -a output ---" >&2
    printf '%s\n' "$output" >&2
    return 1
  fi

  if ! _load_llm_keys; then
    return 1
  fi

  if ! output=$(timeout 10s ploinky what is your purpose? 2>&1); then
    echo "'what is your purpose?' failed or timed out." >&2
    return 1
  fi

  if ! grep -q "LLM suggested:" <<<"$output"; then
    echo "Expected single-command prompt with 'LLM suggested:' marker." >&2
    printf '%s\n' "--- what is your purpose? output ---" >&2
    printf '%s\n' "$output" >&2
    return 1
  fi

  return 0
}

# Ensure Ploinky Shell (psh) returns an LLM suggestion for freeform input.
test_psh_llm_suggestions() {
  load_state

  if ! _load_llm_keys; then
    return 1
  fi

  local output

  if ! output=$(timeout -k 5s 15s psh "How are you?" 2>&1); then
    echo "'psh \"How are you?\"' failed or timed out." >&2
    return 1
  fi

  if ! grep -q "LLM suggested:" <<<"$output"; then
    echo "Expected 'LLM suggested:' marker from psh output." >&2
    printf '%s\n' "--- psh output ---" >&2
    printf '%s\n' "$output" >&2
    return 1
  fi

  return 0
}
