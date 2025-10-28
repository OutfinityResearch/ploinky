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
const profile = data?.input?.profile;
if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
  console.error('INVALID_TYPE');
  process.exit(1);
}
const summary = `${profile.name || ''}:${profile.age ?? ''}`;
process.stdout.write(`OBJECT:${summary}\n`);
NODE
