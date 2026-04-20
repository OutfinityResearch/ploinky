---
id: DS010
title: Testing and Verification
status: implemented
owner: ploinky-team
summary: Defines the active regression harness, unit-test layout, failing-fast replay flow, and required documentation verification steps.
---

# DS010 Testing and Verification

## Introduction

The repository’s test surface is stage-oriented and closely tied to the runtime model. This document defines the current harness layout and the verification requirements that accompany code and documentation changes.

## Core Content

The main end-to-end harness is `tests/test_all.sh`. It must orchestrate the prepare, start, stop, start-again, restart, destroy, and unit-test flow, while preserving the ability to summarize failures instead of aborting on the first non-fatal verification error. `tests/run-all.sh` is a dispatch wrapper around that main script.

Test stages are intentionally split. Action scripts such as `tests/doPrepare.sh`, `tests/doStart.sh`, and `tests/doRestart.sh` create the runtime state transitions. Verification scripts such as `tests/testsAfterStart.sh` inspect the resulting state. Shared shell assertions live in `tests/test-functions/`, and Node unit tests live in `tests/unit/` and are run through `node --test`.

`tests/runFailingFast.sh` must remain a targeted rerun path that creates one fresh workspace and replays only the checks that failed during the previous full suite. This script is part of the documented iteration workflow for runtime changes because the full suite is materially slower.

The harness may create a temporary git worktree for another branch when `PLOINKY_BRANCH` is set. This branch-testing behavior is part of the current implementation and must not be documented away as an incidental test detail.

Documentation changes require verification alongside code changes. After updating the DS set or HTML pages, the repository must:

- regenerate `docs/specs/matrix.md`;
- copy `docs/specsLoader.html` from the GAMP asset;
- verify HTML links and specs-loader references;
- run the static-site verifier against the generated `docs/` directory.

## Decisions & Questions

### Question #1: Why does the test harness keep separate action and verification scripts?

Response:
The runtime performs long-lived state transitions such as prepare, start, restart, and destroy. Splitting actions from validations keeps the orchestration readable, allows shared helpers to be reused across stages, and matches the current structure implemented in `tests/test_all.sh`.

### Question #2: Why is documentation verification part of the repository testing contract?

Response:
The repository explicitly treats HTML docs, DS specs, and `docs/ploinky-overview.md` as synchronized deliverables. If docs are normative inputs or operator-facing guidance, broken links or stale matrices are regressions in their own right and must be caught before the change is considered complete.

## Conclusion

The testing contract covers both runtime behavior and documentation integrity. Ploinky must preserve the stage-based harness, the failing-fast replay workflow, and the post-generation documentation verification steps as part of ordinary repository maintenance.
