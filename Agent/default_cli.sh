#!/bin/sh
# Minimal default CLI that only shows the banner and accepts "exit".

set -u

printf 'Ploinky default CLI\n'

if [ "$#" -gt 0 ] && [ "$1" = "exit" ]; then
  exit 0
fi

print_prompt() {
  printf '> '
}

print_prompt

while true; do
  if ! IFS= read -r line; then
    break
  fi

  if [ "$line" = "exit" ]; then
    break
  fi

  print_prompt
done

exit 0
