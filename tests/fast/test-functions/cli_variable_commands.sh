FAST_VAR_TEST_NAME="test_var"
FAST_VAR_TEST_VALUE="fast_test_value"

fast_cli_set_var() {
  ploinky var "$FAST_VAR_TEST_NAME" "$FAST_VAR_TEST_VALUE" >/dev/null
  ploinky var "$FAST_VAR_TEST_NAME":"$FAST_VAR_TEST_VALUE" >/dev/null
  ploinky var "$FAST_VAR_TEST_NAME"="$FAST_VAR_TEST_VALUE" >/dev/null
}

fast_cli_vars_contains() {
  local output
  if ! output=$(ploinky vars); then
    echo "Failed to run 'ploinky vars'." >&2
    return 1
  fi
  if ! grep -Fq "${FAST_VAR_TEST_NAME}=${FAST_VAR_TEST_VALUE}" <<<"$output"; then
    echo "vars output missing ${FAST_VAR_TEST_NAME} entry." >&2
    echo "Output:" >&2
    echo "$output" >&2
    return 1
  fi
}

fast_cli_echo_var_matches() {
  local output
  if ! output=$(ploinky echo "$FAST_VAR_TEST_NAME"); then
    echo "Failed to run 'ploinky echo'." >&2
    return 1
  fi
  if [[ "$output" != "${FAST_VAR_TEST_NAME}=${FAST_VAR_TEST_VALUE}" ]]; then
    echo "echo output mismatch: expected '${FAST_VAR_TEST_NAME}=${FAST_VAR_TEST_VALUE}', got '${output}'." >&2
    return 1
  fi
}

fast_cli_expose_and_refresh() {
  fast_require_var "TEST_AGENT_NAME"
  fast_require_var "TEST_AGENT_CONT_NAME"
  fast_require_var "FAST_VAR_TEST_NAME"
  fast_require_var "FAST_VAR_TEST_VALUE"
  if ! ploinky expose VAR_SYNTAX_1="val1" "$TEST_AGENT_NAME" >/dev/null; then
    echo "Failed to expose VAR_SYNTAX_1 for agent ${TEST_AGENT_NAME}." >&2
    return 1
  fi

  if ! ploinky expose VAR_SYNTAX_2:"val2" "$TEST_AGENT_NAME" >/dev/null; then
    echo "Failed to expose VAR_SYNTAX_2 for agent ${TEST_AGENT_NAME}." >&2
    return 1
  fi

  if ! ploinky expose "$FAST_VAR_TEST_NAME" "$TEST_AGENT_NAME" >/dev/null; then
    echo "Failed to expose ${FAST_VAR_TEST_NAME} for agent ${TEST_AGENT_NAME}." >&2
    return 1
  fi

  if ! ploinky refresh agent "$TEST_AGENT_NAME" >/dev/null; then
    echo "Failed to refresh agent ${TEST_AGENT_NAME} after expose." >&2
    return 1
  fi

  fast_wait_for_container "$TEST_AGENT_CONT_NAME" || return 1
  return 0
}

fast_cli_verify_var_in_shell() {
  fast_require_var "TEST_AGENT_NAME"
  fast_require_var "FAST_VAR_TEST_NAME"
  fast_require_var "FAST_VAR_TEST_VALUE"
  local output
  if ! output=$( {
    echo "printenv ${FAST_VAR_TEST_NAME}"
    echo "printenv VAR_SYNTAX_1"
    echo "printenv VAR_SYNTAX_2"
    echo "exit"
  } | ploinky shell "$TEST_AGENT_NAME" ); then
    echo "Failed to execute ploinky shell for ${TEST_AGENT_NAME}." >&2
    return 1
  fi
  local cleaned
  cleaned=$(echo "$output" | tr -d '\r')
  if [[ "$cleaned" != *"${FAST_VAR_TEST_VALUE}"* ]]; then
    echo "Exposed variable ${FAST_VAR_TEST_NAME} missing in shell output." >&2
    echo "--- ploinky shell output ---" >&2
    echo "$cleaned" >&2
    echo "----------------------------" >&2
    return 1
  fi
  if [[ "$cleaned" != *"val1"* ]]; then
    echo "Exposed variable VAR_SYNTAX_1 missing in shell output." >&2
    echo "--- ploinky shell output ---" >&2
    echo "$cleaned" >&2
    echo "----------------------------" >&2
    return 1
  fi
  if [[ "$cleaned" != *"val2"* ]]; then
    echo "Exposed variable VAR_SYNTAX_2 missing in shell output." >&2
    echo "--- ploinky shell output ---" >&2
    echo "$cleaned" >&2
    echo "----------------------------" >&2
    return 1
  fi
}
