# Profile System Unit Tests

## Overview

Unit tests for the profile system and workspace utilities. Covers profile persistence, profile validation, secret parsing, and workspace symlink handling without invoking container runtimes.

## Source File

`tests/unit/profileSystem.test.mjs`

## Test Coverage

- Default profile falls back to `dev` when `.ploinky/profile` is missing.
- Invalid profiles are rejected with a clear error message.
- Valid profiles are persisted and read back correctly.
- Profile manifests expose the expected profile list and default profile.
- Profile validation surfaces missing secrets and succeeds when secrets/hooks are present.
- Default mount modes return `rw` for `dev`, `ro` for `qa`/`prod`.
- Profile environment variables include profile, agent, repo, and CWD metadata.
- Secrets parsing handles comments and quoted values.
- Environment variables take precedence over `.ploinky/.secrets` and `.env` entries.
- `.env` values are accepted for profile validation and secret lookup.
- Secret validation reports missing values and source details.
- Secret flags escape values with spaces.
- Missing-secret error guidance includes `.ploinky/.secrets` and `.env` paths.
- Workspace symlink creation/removal and work dir creation succeed for agents with or without skills.

## Fixtures and Setup

- Uses a temporary workspace directory to avoid touching real repos.
- Creates `.ploinky/repos/<repo>/<agent>/manifest.json` for profile lookups.
- Writes `.ploinky/.secrets` with sample keys for secret parsing tests.
- Creates `code/` and `.AchillesSkills/` folders to verify symlink targets.
