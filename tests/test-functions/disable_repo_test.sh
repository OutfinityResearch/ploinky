#!/bin/bash

# Validate that 'ploinky disable repo' removes the repository from the enabled list
# and that we can restore the original state afterwards.
test_disable_repo_demo_updates_enabled_list() {
  load_state
  require_var "TEST_RUN_DIR" || return 1

  local repo="demo"
  local enabled_file="$TEST_RUN_DIR/.ploinky/enabled_repos.json"

  if [[ ! -f "$enabled_file" ]]; then
    echo "Enabled repos file '${enabled_file}' missing." >&2
    return 1
  fi

  if ! grep -Fq "\"${repo}\"" "$enabled_file"; then
    echo "Repository '${repo}' is not marked as enabled before disable test." >&2
    return 1
  fi

  if ! ploinky disable repo "$repo" >/dev/null 2>&1; then
    echo "'ploinky disable repo ${repo}' command failed." >&2
    return 1
  fi

  if grep -Fq "\"${repo}\"" "$enabled_file"; then
    ploinky enable repo "$repo" >/dev/null 2>&1 || true
    echo "Repository '${repo}' still present in enabled list after disable." >&2
    return 1
  fi

  if ! ploinky enable repo "$repo" >/dev/null 2>&1; then
    echo "Failed to restore repository '${repo}' after disable." >&2
    return 1
  fi

  if ! grep -Fq "\"${repo}\"" "$enabled_file"; then
    echo "Repository '${repo}' missing from enabled list after restore." >&2
    return 1
  fi

  return 0
}
