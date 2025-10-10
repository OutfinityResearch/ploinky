#!/bin/bash
# Shared helpers for smoke test suites.

if [[ -t 1 ]]; then
  SMOKE_COLOR_GREEN=$'\033[32m'
  SMOKE_COLOR_RED=$'\033[31m'
  SMOKE_COLOR_BLUE=$'\033[34m'
  SMOKE_COLOR_RESET=$'\033[0m'
else
  SMOKE_COLOR_GREEN=""
  SMOKE_COLOR_RED=""
  SMOKE_COLOR_BLUE=""
  SMOKE_COLOR_RESET=""
fi

smoke_init_suite() {
  SMOKE_SUITE_NAME="$1"
  SMOKE_TEST_COUNT=0
  SMOKE_TEST_PASS=0
  SMOKE_TEST_FAIL=0
  SMOKE_TEST_RESULTS=()
  SMOKE_CURRENT_ERROR=""
}

smoke_run_test() {
  local name="$1"
  local details="$2"
  local fn="$3"

  SMOKE_TEST_COUNT=$((SMOKE_TEST_COUNT + 1))
  local label
  printf -v label "%02d" "$SMOKE_TEST_COUNT"

  echo
  echo "${SMOKE_COLOR_BLUE}=== ${SMOKE_SUITE_NAME} :: Test ${label}: ${name} ===${SMOKE_COLOR_RESET}"
  if [[ -n "$details" ]]; then
    echo "$details"
  fi

  SMOKE_CURRENT_ERROR=""
  local start_ts end_ts duration
  start_ts=$(date +%s)
  "$fn"
  local status=$?
  end_ts=$(date +%s)
  duration=$(( end_ts - start_ts ))
  local error_msg="$SMOKE_CURRENT_ERROR"
  if (( status != 0 )) && [[ -z "$error_msg" ]]; then
    error_msg="Test returned non-zero status"
  fi
  local encoded_error="$error_msg"
  encoded_error=${encoded_error//|/%7C}
  encoded_error=${encoded_error//$'\n'/\\n}

  if (( status == 0 )); then
    SMOKE_TEST_PASS=$((SMOKE_TEST_PASS + 1))
    printf "${SMOKE_COLOR_GREEN}✔ [PASS]${SMOKE_COLOR_RESET} %s (duration: %ss)\n" "$name" "$duration"
  else
    SMOKE_TEST_FAIL=$((SMOKE_TEST_FAIL + 1))
    printf "${SMOKE_COLOR_RED}✘ [FAIL]${SMOKE_COLOR_RESET} %s (duration: %ss)\n" "$name" "$duration"
  fi

  SMOKE_TEST_RESULTS+=("${label}|${name}|${status}|${duration}|${encoded_error}")
  return $status
}

smoke_summary() {
  echo
  echo "${SMOKE_COLOR_BLUE}--- ${SMOKE_SUITE_NAME} Summary ---${SMOKE_COLOR_RESET}"
  for entry in "${SMOKE_TEST_RESULTS[@]}"; do
    IFS='|' read -r label name status duration err <<<"$entry"
    local icon
    if (( status == 0 )); then
      icon="${SMOKE_COLOR_GREEN}✔${SMOKE_COLOR_RESET}"
    else
      icon="${SMOKE_COLOR_RED}✘${SMOKE_COLOR_RESET}"
    fi
    printf "  %s Test %s: %s (duration: %ss)\n" "$icon" "$label" "$name" "$duration"
    if (( status != 0 )) && [[ -n "$err" ]] && [[ "$err" != "Test returned non-zero status" ]]; then
      local decoded=${err//%7C/|}
      decoded=${decoded//\\n/$'\n'}
      printf "    ↳ %s\n" "$decoded"
    fi
  done
  echo "${SMOKE_COLOR_BLUE}PASS=${SMOKE_TEST_PASS} FAIL=${SMOKE_TEST_FAIL} TOTAL=${SMOKE_TEST_COUNT}${SMOKE_COLOR_RESET}"
  if [[ -n "${SMOKE_SUMMARY_PATH:-}" ]]; then
    echo "${SMOKE_SUITE_NAME}:${SMOKE_TEST_PASS}:${SMOKE_TEST_FAIL}:${SMOKE_TEST_COUNT}" >>"$SMOKE_SUMMARY_PATH"
    for entry in "${SMOKE_TEST_RESULTS[@]}"; do
      echo "${SMOKE_SUITE_NAME}|$entry" >>"$SMOKE_SUMMARY_PATH"
    done
  fi
  if (( SMOKE_TEST_FAIL == 0 )); then
    return 0
  fi
  return 1
}

smoke_fail() {
  local message="$1"
  if [[ -n "${SMOKE_CURRENT_ERROR:-}" ]]; then
    SMOKE_CURRENT_ERROR+=$'\n'
  fi
  SMOKE_CURRENT_ERROR+="$message"
  echo "${SMOKE_COLOR_RED}    ↳ ${message}${SMOKE_COLOR_RESET}"
  return 1
}

smoke_expect_success() {
  local description="$1"
  shift
  "$@"
  local status=$?
  if (( status != 0 )); then
    smoke_fail "${description} (exit ${status})"
    return 1
  fi
  return 0
}

smoke_assert_dir_exists() {
  local dir="$1"
  local message="$2"
  if [[ ! -d "$dir" ]]; then
    smoke_fail "$message"
    return 1
  fi
  return 0
}

smoke_assert_file_exists() {
  local file="$1"
  local message="$2"
  if [[ ! -f "$file" ]]; then
    smoke_fail "$message"
    return 1
  fi
  return 0
}

smoke_assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  if ! grep -q "$needle" <<<"$haystack"; then
    smoke_fail "$message"
    return 1
  fi
  return 0
}
