#!/bin/sh
# Default CLI entrypoint for agents without a custom `cli` manifest field.
# Supports a limited set of safe inspection commands.

set -u

# Ensure we have a readable tty for interactive mode (even when invoked non-interactively).
if [ ! -t 0 ] && [ -r /dev/tty ]; then
  exec < /dev/tty
fi

show_usage() {
  cat <<'HELP'
Ploinky default CLI

Usage: default_cli.sh <command> [args]

Available commands:
  whoami             Show current user.
  pwd                Print working directory.
  ls [path]          List directory contents (defaults to current directory).
  env                Dump environment variables.
  date               Print current date/time.
  uname [-a]         Show kernel information.
  exit               Exit the CLI helper.
  help               Display this message.
HELP
}

run_cli_command() {
  local subcmd="$1"
  shift || true

  case "$subcmd" in
    help|--help|-h)
      show_usage
      return 0
      ;;
    exit)
      return 100
      ;;
    whoami)
      whoami "$@"
      ;;
    pwd)
      pwd "$@"
      ;;
    ls)
      ls "$@"
      ;;
    env)
      env "$@"
      ;;
    date)
      date "$@"
      ;;
    uname)
      uname "$@"
      ;;
    *)
      echo "Unsupported command: $subcmd" >&2
      echo "Run 'default_cli.sh help' to see available commands." >&2
      return 0
      ;;
  esac

  return $?
}

if [ "$#" -gt 0 ]; then
  cmd="$1"
  shift || true
  run_cli_command "$cmd" "$@"
  status=$?
  if [ "$status" -eq 100 ]; then
    status=0
  fi
  exit "$status"
fi

printf 'Ploinky default CLI (type "help" for commands, "exit" to quit)\n'

while true; do
  printf 'default-cli> '
  if ! IFS= read -r line; then
    printf '\n'
    break
  fi

  if [ -z "$line" ]; then
    continue
  fi

  set -f
  # shellcheck disable=SC2086
  set -- $line
  set +f

  if [ "$#" -eq 0 ]; then
    continue
  fi

  cmd="$1"
  shift || true

  run_cli_command "$cmd" "$@"
  status=$?
  if [ "$status" -eq 100 ]; then
    break
  fi
done

exit 0
