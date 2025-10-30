#!/bin/sh
set -eu

log_file="./test-sso-params.log"
: >"$log_file"

for arg in "$@"; do
  printf '%s\n' "$arg" >>"$log_file"
done
printf 'SSO_ARGS:%s\n' "$*"
