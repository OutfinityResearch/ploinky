#!/bin/bash
set -uo pipefail

SMOKE_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_TESTS=0
OVERALL_STATUS=0
declare -a SUITE_SUMMARIES=()
declare -a SUITE_DETAILS=()

run_suite() {
  local script="$1"
  local summary_file
  local status
  summary_file=$(mktemp)

  echo "=== Running $(basename "$script") ==="
  if SMOKE_SUMMARY_PATH="$summary_file" bash "$SMOKE_DIR/$script"; then
    status=0
  else
    status=$?
  fi
  echo

  local suite_name="" pass_count=0 fail_count=0 total_count=0
  local detail_lines=()
  if [[ -s "$summary_file" ]]; then
    mapfile -t summary_lines <"$summary_file"
    for line in "${summary_lines[@]}"; do
      if [[ "$line" == *'|'* ]]; then
        detail_lines+=("$line")
      elif [[ -n "$line" ]]; then
        IFS=':' read -r suite_name pass_count fail_count total_count <<<"$line"
      fi
    done
  else
    suite_name=$(basename "$script")
    pass_count=0
    fail_count=$status
    total_count=$((pass_count + fail_count))
  fi
  rm -f "$summary_file"

  if [[ -z "$suite_name" ]]; then
    suite_name=$(basename "$script")
  fi

  TOTAL_PASS=$((TOTAL_PASS + pass_count))
  TOTAL_FAIL=$((TOTAL_FAIL + fail_count))
  TOTAL_TESTS=$((TOTAL_TESTS + total_count))

  SUITE_SUMMARIES+=("$suite_name:$pass_count:$fail_count:$total_count:$status")
  SUITE_DETAILS+=("${detail_lines[@]}")

  if (( status != 0 )); then
    OVERALL_STATUS=1
  fi
}

run_suite startRestart.sh
run_suite startStopStart.sh

echo "=== Smoke Suite Summary ==="
for entry in "${SUITE_SUMMARIES[@]}"; do
  IFS=':' read -r suite_name pass_count fail_count total_count status <<<"$entry"
  if (( fail_count == 0 && status == 0 )); then
    printf "  ✔ %-24s PASS=%d FAIL=%d TOTAL=%d\n" "$suite_name" "$pass_count" "$fail_count" "$total_count"
  else
    printf "  ✘ %-24s PASS=%d FAIL=%d TOTAL=%d\n" "$suite_name" "$pass_count" "$fail_count" "$total_count"
  fi
done
printf "  → %-24s PASS=%d FAIL=%d TOTAL=%d\n" "Overall" "$TOTAL_PASS" "$TOTAL_FAIL" "$TOTAL_TESTS"

if ((${#SUITE_DETAILS[@]} > 0)); then
  echo
  echo "=== Detailed Test Results ==="
  for entry in "${SUITE_DETAILS[@]}"; do
    [[ -z "$entry" ]] && continue
    IFS='|' read -r suite label name status duration err <<<"$entry"
    local icon
    if (( status == 0 )); then
      icon="✔"
    else
      icon="✘"
    fi
    printf "  %s %-24s Test %s: %s (duration: %ss)\n" "$icon" "$suite" "$label" "$name" "$duration"
    if (( status != 0 )); then
      local decoded=${err//%7C/|}
      decoded=${decoded//\\n/$'\n'}
      if [[ -n "$decoded" && "$decoded" != "Test returned non-zero status" ]]; then
        printf "      ↳ %s\n" "$decoded"
      fi
    fi
  done
fi

exit $OVERALL_STATUS
