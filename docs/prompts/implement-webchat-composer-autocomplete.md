# Implementation Prompt: WebChat Composer Autocomplete

You are working in `/Users/danielsava/work/file-parser`.

Primary goal: implement generic WebChat composer autocomplete for `@` tags and
workspace file/folder references while preserving the existing `/` slash
autocomplete behavior.

Use this plan as the source of truth:

`/Users/danielsava/work/file-parser/ploinky/docs/plans/webchat-composer-autocomplete-plan.md`

## Required Starting Context

Inspect status and diffs before editing:

```bash
cd /Users/danielsava/work/file-parser/ploinky && git status --short --branch && git diff
cd /Users/danielsava/work/file-parser/AssistOSExplorer && git status --short --branch && git diff
cd /Users/danielsava/work/file-parser/copilot-agents && git status --short --branch && git diff
```

There may be dirty changes from prior work. Do not revert unrelated changes.
Do not stage local sibling repos, `node_modules`, generated dependency trees, or
unrelated untracked files.

## Hard Invariants

- Ploinky framework code must not hardcode optional Ploinky agent ids, research
  backend tags, or agent-owned MCP tool names.
- Ploinky WebChat may implement generic autocomplete plumbing, generic launch
  config parsing, generic MCP catalog calls, generic workspace path suggestions,
  and generic envelope transport.
- Tag meaning belongs to the selected chat agent and the explicitly configured
  tag catalog provider.
- Unknown `@word` mentions must remain ordinary chat unless configured as known
  tags by the selected chat context.
- Workspace file/folder suggestions must be workspace-confined and must reject
  traversal, absolute caller paths, symlink escapes, NUL bytes, `.secrets`, and
  `*.secrets`.
- Do not expose provider credentials, invocation JWTs, browser authorization
  headers, or local auth passwords in logs or docs.
- Do not deploy to `skills.axiologic.dev`.

## Existing Behavior To Preserve

- `/` autocomplete currently lives in
  `ploinky/cli/server/webchat/slashAutocomplete.js`.
- It calls `/mcps/<selected-agent>/mcp`, lists tools, and prefers AchillesCLI's
  structured `list_achilles_cli_commands` catalog when present.
- WebChat sends messages through `network.postEnvelope`.
- `forward-envelope=1` makes Ploinky forward sanitized WebChat envelopes to the
  selected chat agent.
- AchillesCLI tag relay currently lives in
  `AssistOSExplorer/AchillesCLI/achilles-cli/src/lib/webchatTagRelay.mjs`.

## Implementation Tasks

1. Update Ploinky docs/specs first:
   - `ploinky/docs/webchat.html`
   - `ploinky/docs/specs/DS005-routing-and-web-surfaces.md`
   - `ploinky/docs/specs/DS011-security-model.md`
   - `ploinky/docs/specs/matrix.md` only if needed

2. Refactor slash autocomplete into a provider without changing slash behavior:
   - create a generic composer autocomplete controller;
   - keep command catalog loading compatible with the current implementation;
   - preserve keyboard and pointer behavior.

3. Add a generic `@` tag catalog provider:
   - read static tags from `tag-relay-tags` when present;
   - do not call MCP tools named by browser URL parameters;
   - leave dynamic backend discovery to the selected chat agent or relay during
     real delegated requests that carry invocation tokens;
   - never hardcode the catalog agent, tool, or tag names.

4. Add workspace file/folder suggestions:
   - add an authenticated WebChat suggestion endpoint under `/webchat`;
   - resolve the working directory from `workspace-dir`, `workspaceDir`, or
     compatible launch options;
   - return relative file/folder candidates only;
   - exclude unsafe and reserved paths;
   - cap results and sort folders before files.

5. Add structured WebChat references:
   - client envelope includes optional `references`;
   - server parsing and serialization sanitize references;
   - transcript capture stores references for user turns;
   - old agents that ignore references remain compatible.

6. Update AchillesCLI:
   - parse optional WebChat `references`;
   - materialize valid workspace-path references for tag relay;
   - forward materialized content/resources to `research_task_submit` through
     the existing generic tag-relay path;
   - return natural-language warnings for rejected references instead of
     tracebacks;
   - preserve unknown mention fallthrough.

7. Touch copilot-agents only if necessary:
   - keep research-relay launcher plugins supplying static `tag-relay-tags` for
     browser autocomplete;
   - update specs if behavior changes;
   - do not add Ploinky coupling.

8. Add tests:
   - Ploinky tests for trigger parsing, tag provider normalization, file
     suggestion confinement/rejection, slash compatibility, and envelope
     reference sanitization.
   - AchillesCLI tests for reference normalization, materialization,
     rejection/warning behavior, and tag-relay forwarding.
   - Existing research relay tests must keep passing if copilot-agents is
     touched.

9. Run verification:

   In Ploinky:

   ```bash
   node --check cli/server/webchat/index.js cli/server/webchat/network.js cli/server/handlers/webchat.js
   # include every new WebChat autocomplete/provider module in node --check
   node --test tests/unit/*.test.mjs
   git diff --check
   ```

   In AssistOSExplorer/AchillesCLI:

   ```bash
   node --check AchillesCLI/achilles-cli/src/index.mjs AchillesCLI/achilles-cli/src/lib/webchatTagRelay.mjs
   node --test AchillesCLI/tests/webchatTagRelay.test.mjs AchillesCLI/tests/webchatControl.test.mjs
   git diff --check
   ```

   In copilot-agents if touched:

   ```bash
   node --test tests/unit/*.test.mjs
   node scripts/validate-manifests.mjs
   git diff --check
   ```

10. Run a fresh-workspace browser E2E:
    - enable Explorer, AchillesCLI, and research-agents;
    - open WebChat with generic tag-relay parameters;
    - type `@`;
    - verify research tags and files/folders appear;
    - select a tag and a file;
    - verify the sent envelope includes sanitized references;
    - verify `@open-interpreter Give a one sentence configuration status.`
      still returns a natural-language status/configuration response.

11. Audit Ploinky for forbidden coupling:

    ```bash
    rg 'researchRelay|openInterpreterAgent|open-interpreter|research_task_submit' \
      /Users/danielsava/work/file-parser/ploinky/cli/server \
      /Users/danielsava/work/file-parser/ploinky/cli/server/webchat
    ```

    Ploinky core/WebChat should not contain those names except in generic tests
    that prove the strings are supplied as configuration and not hardcoded.

## Deliverable Summary Expected

When done, summarize:

- files changed by repo;
- autocomplete behavior implemented;
- how tag catalogs stay generic;
- how workspace file/folder references are confined;
- validation commands and results;
- any E2E artifacts or skipped checks.
