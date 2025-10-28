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
const values = data?.input?.numbers;
if (!Array.isArray(values)) {
  console.error('INVALID_TYPE');
  process.exit(1);
}
if (!values.every(v => typeof v === 'number' && Number.isFinite(v))) {
  console.error('INVALID_ELEMENTS');
  process.exit(1);
}
process.stdout.write(`ARRAY:${values.join(',')}\n`);
NODE
