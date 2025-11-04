#!/bin/bash

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
    printf '--- ploinky ls -a output ---%s\n' "" >&2
    printf '%s\n' "$output" >&2
    return 1
  fi

  if ! output=$(ploinky how do i start an agent 2>&1); then
    echo "'ploinky how do i start an agent' failed." >&2
    return 1
  fi

  local suggestion
  suggestion=$(printf '%s\n' "$output" | awk '/\[LLM\] Suggested next steps:/{flag=1;next} flag {print}')
  suggestion=$(printf '%s' "$suggestion" | sed '/^[[:space:]]*$/d')

  if [[ -z "$suggestion" ]]; then
    echo "LLM suggestion output is empty." >&2
    printf '--- ploinky how do i start an agent output ---%s\n' "" >&2
    printf '%s\n' "$output" >&2
    return 1
  fi

  return 0
}
