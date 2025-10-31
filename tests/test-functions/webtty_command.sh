#!/bin/bash

configure_mock_webtty_shell() {
    require_var "TESTS_DIR" || return 1

    local mock_shell_path="$TESTS_DIR/testAgent/mock_shell.sh"

    if ! ploinky webtty "$mock_shell_path" >/dev/null 2>&1; then
        echo "Failed to configure WebTTY shell to '${mock_shell_path}'." >&2
        return 1
    fi

    if ! wait_for_router; then
        echo "Router did not come back up after configuring WebTTY shell." >&2
        return 1
    fi

    return 0
}

test_webtty_shell() {
    require_var "TESTS_DIR" || return 1

    local mock_shell_path="$TESTS_DIR/testAgent/mock_shell.sh"
    local secrets_file=".ploinky/.secrets"

    if [[ ! -f "$secrets_file" ]]; then
        echo "Secrets file '${secrets_file}' not found after configuring WebTTY shell." >&2
        return 1
    fi

    local configured_shell
    configured_shell=$(grep -m1 '^WEBTTY_SHELL=' "$secrets_file" | cut -d'=' -f2- | tr -d '\r' || true)
    if [[ "$configured_shell" != "$mock_shell_path" ]]; then
        echo "WEBTTY_SHELL does not match expected path." >&2
        echo "Expected: $mock_shell_path" >&2
        echo "Found:    ${configured_shell:-<unset>}" >&2
        return 1
    fi

    local expected_command="exec $mock_shell_path"
    local configured_command
    configured_command=$(grep -m1 '^WEBTTY_COMMAND=' "$secrets_file" | cut -d'=' -f2- | tr -d '\r' || true)
    if [[ "$configured_command" != "$expected_command" ]]; then
        echo "WEBTTY_COMMAND does not match expected value." >&2
        echo "Expected: $expected_command" >&2
        echo "Found:    ${configured_command:-<unset>}" >&2
        return 1
    fi

    return 0
}
