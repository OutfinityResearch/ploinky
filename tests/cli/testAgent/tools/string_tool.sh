#!/bin/sh
set -eu

payload=$(cat)

node - <<'NODE' "$payload"
const raw = process.argv[2] || '{}';
let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  console.error('INVALID_JSON');
  process.exit(1);
}
const value = data?.input?.message;
if (typeof value !== 'string') {
  console.error('INVALID_TYPE');
  process.exit(1);
}
process.stdout.write(`STRING:${value}\n`);
NODE
