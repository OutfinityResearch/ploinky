#!/bin/bash
# This script is the orchestrator for the E2E test suite.
# It runs through stages of preparing, starting, stopping, and destroying
# a test environment, verifying the system's state at each step.
# It is designed to run all verification steps and provide a final summary,
# even if some individual checks fail.

# Exit immediately if a command exits with a non-zero status.
# We will disable this for sections where we want to continue on error.
set -euo pipefail

FAST_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

# State file for sharing variables between scripts
FAST_STATE_FILE=$(mktemp "${TMPDIR:-/tmp}/fast-suite-state-XXXXXX.env")
export FAST_STATE_FILE

# Results file for the final summary
FAST_RESULTS_FILE="$FAST_DIR/lastRun.results"
export FAST_RESULTS_FILE

# Global error counter
TOTAL_ERRORS=0

# Cleanup trap to remove the temporary state file on exit
cleanup() {
  # The state file is temporary and should be removed.
  rm -f "$FAST_STATE_FILE"
  # The results file is an intended artifact and is not removed.
}
trap cleanup EXIT

# Source the library of helper functions
source "$FAST_DIR/lib.sh"

# Initialize/clear the results file at the start of the run
fast_init_results

# Function to run a single stage of the test suite.
# A stage consists of an "action" (do*) and a "verification" (tests*).
run_stage() {
  local label="$1"
  local action="$2"
  local verify="$3"

  fast_stage_header "$label"

  if [[ -n "$action" ]]; then
    if ! fast_run_with_timeout 60 "Executing action script: ${action}" bash "$FAST_DIR/$action"; then
      return 1
    fi
  fi

  if [[ -n "$verify" ]]; then
    set +e
    
    FAST_CHECK_ERRORS=0
    fast_run_with_timeout 60 "Running verification script: ${verify}" bash "$FAST_DIR/$verify"
    local exit_code=$?

    if [[ $exit_code -eq 124 ]]; then
        fast_log_result "[FAIL] ${verify} timed out after 60 seconds."
        TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
    elif [[ $exit_code -ne 0 ]]; then
        fast_log_result "[FAIL] ${verify} reported ${exit_code} failure(s)."
        TOTAL_ERRORS=$((TOTAL_ERRORS + exit_code))
    fi

    set -e
  fi

  return 0
}

# --- Main Test Execution Flow ---

# The 'destroy' action is handled in a final, separate block
# to ensure cleanup is attempted even if a stage fails.
# The 'set -e' at the top level will cause the script to exit if any 'do*' script fails.
# We wrap the main stages in a subshell with its own error handling
# to make sure the final summary and cleanup runs.
if ! run_stage "PREPARE STAGE" "doPrepare.sh" "testsAfterPrepare.sh"; then
  fast_fail_message "PREPARE STAGE aborted. Proceeding to cleanup."
  fast_log_result "[FATAL] PREPARE STAGE aborted."
  TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
fi

if ! run_stage "START STAGE" "doStart.sh" "testsAfterStart.sh"; then
  fast_fail_message "START STAGE aborted. Proceeding to cleanup."
  fast_log_result "[FATAL] START STAGE aborted."
  TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
fi

if ! run_stage "STOP STAGE" "doStop.sh" "testsAfterStop.sh"; then
  fast_fail_message "STOP STAGE aborted. Proceeding to cleanup."
  fast_log_result "[FATAL] STOP STAGE aborted."
  TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
fi

if ! run_stage "START AGAIN STAGE" "doStart.sh" "testsAfterStartAgain.sh"; then
  fast_fail_message "START AGAIN STAGE aborted. Proceeding to cleanup."
  fast_log_result "[FATAL] START AGAIN STAGE aborted."
  TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
fi

if ! run_stage "RESTART STAGE" "doRestart.sh" "testsAfterRestart.sh"; then
  fast_fail_message "RESTART STAGE aborted. Proceeding to cleanup."
  fast_log_result "[FATAL] RESTART STAGE aborted."
  TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
fi

# --- Cleanup Stage ---
# This stage runs regardless of the success of previous stages.
set +e # Allow cleanup to run fully
run_stage "DESTROY STAGE"      "doDestroy.sh"         "testsAfterDestroy.sh"
set -e # Re-enable for final summary logic

# --- Final Summary ---
fast_stage_header "TEST SUMMARY"

if (( TOTAL_ERRORS == 0 )); then
  fast_pass_message "All tests passed!"
  fast_log_result "[PASS] All tests passed!"
  echo "Full report available in: $FAST_RESULTS_FILE"
  exit 0
else
  fast_fail_message "Suite finished with ${TOTAL_ERRORS} failure(s)."
  fast_log_result "[FAIL] Suite finished with ${TOTAL_ERRORS} failure(s)."
  echo "Full report available in: $FAST_RESULTS_FILE"
  # On failure, print a condensed view of just the failures.
  grep -i "\[FAIL\]\|\[FATAL\]" "$FAST_RESULTS_FILE"
  exit 1
fi
