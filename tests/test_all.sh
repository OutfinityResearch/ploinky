#!/bin/bash
# This script is the orchestrator for the E2E test suite.
# It runs through stages of preparing, starting, stopping, and destroying
# a test environment, verifying the system's state at each step.
# It is designed to run all verification steps and provide a final summary,
# even if some individual checks fail.

# Exit immediately if a command exits with a non-zero status.
# We will disable this for sections where we want to continue on error.
set -euo pipefail

TESTS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

# State file for sharing variables between scripts
FAST_STATE_FILE=$(mktemp "${TMPDIR:-/tmp}/fast-suite-state-XXXXXX.env")
export FAST_STATE_FILE

# Results file for the final summary
FAST_RESULTS_FILE="$TESTS_DIR/lastRun.results"
export FAST_RESULTS_FILE

# Global error counter
TOTAL_ERRORS=0
ABORTED=0

# Cleanup trap to remove the temporary state file on exit
cleanup() {
  # The state file is temporary and should be removed.
  rm -f "$FAST_STATE_FILE"
  # The results file is an intended artifact and is not removed.
}
trap cleanup EXIT

abort_suite() {
  if [[ $ABORTED -eq 1 ]]; then
    exit 130
  fi
  ABORTED=1
  trap - INT TERM
  set +e
  echo "\n[INFO] Interrupt received. Cleaning up workspace..." >&2
  load_state 2>/dev/null || true
  if [[ -z "${TEST_RUN_DIR:-}" && -f "$FAST_STATE_FILE" ]]; then
    TEST_RUN_DIR=$(awk -F'=' '/^TEST_RUN_DIR=/{print substr($0, index($0,$2))}' "$FAST_STATE_FILE" | tail -n1 | xargs printf '%s')
  fi
  if command -v ploinky >/dev/null 2>&1; then
    ploinky destroy >/dev/null 2>&1
  fi
  if [[ -n "${TEST_RUN_DIR:-}" && -d "$TEST_RUN_DIR" ]]; then
    rm -rf "$TEST_RUN_DIR"
  fi
  cd "$TESTS_DIR"
  exit 130
}
trap abort_suite INT TERM

handle_interrupt_exit() {
  local code="$1"
  if [[ $code -eq 130 || $code -eq 143 ]]; then
    abort_suite
  fi
}

# Source the library of helper functions
source "$TESTS_DIR/lib.sh"

# Initialize/clear the results file at the start of the run
init_results

# Function to run a single stage of the test suite.
# A stage consists of an "action" (do*) and a "verification" (tests*).
run_stage() {
  local label="$1"
  local action="$2"
  local verify="$3"

  stage_header "$label"

  if [[ -n "$action" ]]; then
    run_with_timeout 60 "Executing action script: ${action}" bash "$TESTS_DIR/$action"
    local action_exit=$?
    handle_interrupt_exit "$action_exit"
    if [[ $action_exit -ne 0 ]]; then
      return 1
    fi
  fi

  if [[ -n "$verify" ]]; then
    set +e
    
    FAST_CHECK_ERRORS=0
    run_with_timeout 90 "Running verification script: ${verify}" bash "$TESTS_DIR/$verify"
    local exit_code=$?
    handle_interrupt_exit "$exit_code"

    if [[ $exit_code -eq 124 ]]; then
        log_result "[FAIL] ${verify} timed out after 90 seconds."
        TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
    elif [[ $exit_code -ne 0 ]]; then
        log_result "[FAIL] ${verify} reported ${exit_code} failure(s)."
        TOTAL_ERRORS=$((TOTAL_ERRORS + exit_code))
    fi

    set -e
  fi

  return 0
}

run_node_unit_tests() {
    local unit_dir="$TESTS_DIR/unit"
    if [[ ! -d "$unit_dir" ]]; then
      echo "Unit test directory '$unit_dir' not found." >&2
      return 1
    fi

    local test_files=()
    while IFS= read -r -d '' file; do
      test_files+=("$file")
    done < <(find "$unit_dir" -maxdepth 1 -type f \( -name '*.test.js' -o -name '*.test.mjs' -o -name '*.test.cjs' \) -print0)

    if (( ${#test_files[@]} == 0 )); then
      echo "No unit test files found in '$unit_dir'." >&2
      return 1
    fi

    node --test "${test_files[@]}"
}

# --- Main Test Execution Flow ---

# The 'destroy' action is handled in a final, separate block
# to ensure cleanup is attempted even if a stage fails.
# The 'set -e' at the top level will cause the script to exit if any 'do*' script fails.
# We wrap the main stages in a subshell with its own error handling
# to make sure the final summary and cleanup runs.
if ! run_stage "PREPARE STAGE" "doPrepare.sh" "testsAfterPrepare.sh"; then
  fail_message "PREPARE STAGE aborted. Proceeding to cleanup."
  log_result "[FATAL] PREPARE STAGE aborted."
  TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
fi

# Load state from prepare stage to get TEST_AGENT_NAME and TEST_ROUTER_PORT
load_state

stage_header "START STAGE"
run_with_timeout 60 "Executing action script: doStart.sh with args" bash "$TESTS_DIR/doStart.sh" "$TEST_AGENT_NAME" "$TEST_ROUTER_PORT"
start_action_exit=$?
handle_interrupt_exit "$start_action_exit"
if [[ $start_action_exit -ne 0 ]]; then
  fail_message "START STAGE aborted. Proceeding to cleanup."
  log_result "[FATAL] START STAGE aborted."
  TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
else
  set +e
  FAST_CHECK_ERRORS=0
  run_with_timeout 90 "Running verification script: testsAfterStart.sh" bash "$TESTS_DIR/testsAfterStart.sh"
  exit_code=$?
  handle_interrupt_exit "$exit_code"
  if [[ $exit_code -eq 124 ]]; then
      log_result "[FAIL] testsAfterStart.sh timed out after 90 seconds."
      TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
  elif [[ $exit_code -ne 0 ]]; then
      log_result "[FAIL] testsAfterStart.sh reported ${exit_code} failure(s)."
      TOTAL_ERRORS=$((TOTAL_ERRORS + exit_code))
  fi
  set -e
fi

if ! run_stage "STOP STAGE" "doStop.sh" "testsAfterStop.sh"; then
  fail_message "STOP STAGE aborted. Proceeding to cleanup."
  log_result "[FATAL] STOP STAGE aborted."
  TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
fi

if ! run_stage "START AGAIN STAGE" "doStart.sh" "testsAfterStartAgain.sh"; then
  fail_message "START AGAIN STAGE aborted. Proceeding to cleanup."
  log_result "[FATAL] START AGAIN STAGE aborted."
  TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
fi

if ! run_stage "RESTART STAGE" "doRestart.sh" "testsAfterRestart.sh"; then
  fail_message "RESTART STAGE aborted. Proceeding to cleanup."
  log_result "[FATAL] RESTART STAGE aborted."
  TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
fi

# --- Cleanup Stage ---
# This stage runs regardless of the success of previous stages.
set +e # Allow cleanup to run fully
run_stage "DESTROY STAGE"      "doDestroy.sh"         "testsAfterDestroy.sh"
set -e # Re-enable for final summary logic

# --- Post-destroy unit checks ---
stage_header "NODE UNIT STAGE"
set +e
FAST_CHECK_ERRORS=0
test_check "Node unit tests" run_node_unit_tests
finalize_checks
node_unit_failures=$?
if (( node_unit_failures > 0 )); then
  TOTAL_ERRORS=$((TOTAL_ERRORS + node_unit_failures))
fi
set -e

# --- Final Summary ---
stage_header "TEST SUMMARY"

if (( TOTAL_ERRORS == 0 )); then
  pass_message "All tests passed!"
  log_result "[PASS] All tests passed!"
  echo "Full report available in: $FAST_RESULTS_FILE"
  exit 0
else
  fail_message "Suite finished with ${TOTAL_ERRORS} failure(s)."
  log_result "[FAIL] Suite finished with ${TOTAL_ERRORS} failure(s)."
  echo "Full report available in: $FAST_RESULTS_FILE"
  # On failure, print a condensed view of just the failures.
  grep -i "\[FAIL\]\|\[FATAL\]" "$FAST_RESULTS_FILE"
  exit 1
fi
