#!/bin/sh
set -eu

log_file="./test-sso-params.log"
: >"$log_file"

for arg in "$@"; do
  printf '%s\n' "$arg" >>"$log_file"
done

for var_name in SSO_USER SSO_USER_ID SSO_EMAIL SSO_ROLES; do
  eval "var_value=\${$var_name-}"
  if [ -n "$var_value" ]; then
    printf 'ENV_%s=%s\n' "$var_name" "$var_value" >>"$log_file"
  fi
done

printf 'SSO_ARGS:%s\n' "$*"
