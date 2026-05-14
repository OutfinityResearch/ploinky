# WebChat Composer Autocomplete Implementation Plan

## Goal

Implement a generic WebChat composer autocomplete system that makes browser chat
usable like a modern CLI chat surface:

- typing `/` keeps the existing slash-command suggestions;
- typing `@` shows taggable agents/backends supplied by the selected chat
  context;
- typing `@` also lets the user find workspace files and folders near the
  WebChat working directory;
- selected files/folders are carried as structured, workspace-confined
  references so downstream chat agents and research relays can identify the
  intended inputs without parsing raw prose.

This is a Ploinky WebChat feature plus narrowly scoped integration updates in
AchillesCLI and, where needed, the research-relay launcher plugins. Ploinky must
remain framework code. It must not hardcode `researchRelay`,
`openInterpreterAgent`, `@open-interpreter`, or any optional agent-owned tool
name.

## Current Behavior

1. `ploinky/cli/server/webchat/index.js` initializes `createSlashAutocomplete`
   and binds it to the composer input.
2. `ploinky/cli/server/webchat/slashAutocomplete.js` only watches `/`. It calls
   `/mcps/<selected-agent>/mcp`, lists MCP tools, and prefers the AchillesCLI
   structured catalog tool when present.
3. Ploinky WebChat uploads attachments through `/blobs`, stores shared uploads
   under `.ploinky/shared`, and sends sanitized attachment metadata in the
   WebChat envelope.
4. Explorer's file browser upload is separate. It uploads workspace files with
   `/upload?path=<workspace-path>`.
5. AchillesCLI can intercept tagged chat only after the user manually types a
   configured `@tag`. The launch URL must provide generic tag-relay parameters
   such as `forward-envelope=1`, `tag-relay-agent`, `tag-relay-submit-tool`,
   `tag-relay-list-tool`, and optionally `tag-relay-tags`.
6. The browser has no `@` suggestions and does not expose workspace path
   suggestions in the WebChat composer.

## Non-Negotiable Invariants

1. Ploinky must never hardcode optional Ploinky agent ids, backend tags, or
   agent-owned MCP tool names.
2. Agent/tag suggestions are data. They come from explicit WebChat launch
   configuration or a configured catalog call, not from framework conditionals.
3. File suggestions are hints, not authorization. Downstream agents must still
   validate paths and resource access before reading anything.
4. Workspace path handling must reject absolute caller input, traversal, NUL
   bytes, symlink escapes, and reserved secret files such as `.secrets` and
   `*.secrets`.
5. WebChat must not forward browser credentials, provider secrets, or internal
   auth headers to suggestion providers. Normal authenticated browser cookies
   are enough for first-party router requests.
6. Unknown `@word` mentions must remain ordinary chat text unless the selected
   chat agent has explicitly configured that tag.
7. Existing slash autocomplete behavior must continue to work.

## Architecture

### Client Modules

Replace the single-purpose slash autocomplete binding with a generic composer
autocomplete controller:

- `cli/server/webchat/composerAutocomplete.js`
  - Owns menu lifecycle, keyboard navigation, pointer selection, grouping,
    positioning, and insertion.
  - Delegates suggestion lookup to trigger providers.
  - Supports multiple providers for a single trigger.

- `cli/server/webchat/autocompleteProviders/slashCommands.js`
  - Moves the existing slash-command behavior out of `slashAutocomplete.js`.
  - Keeps the existing AchillesCLI structured catalog fallback behavior.

- `cli/server/webchat/autocompleteProviders/tagCatalog.js`
  - Reads generic tag-relay launch config from WebChat page data.
  - Uses `tag-relay-tags` as a static catalog when supplied.
  - Does not call MCP tools named by browser URL parameters; dynamic backend
    discovery belongs to the selected chat agent or relay during a real
    delegated request with an invocation token.
  - Does not know research-specific names.

- `cli/server/webchat/autocompleteProviders/workspacePaths.js`
  - Calls an authenticated Ploinky WebChat suggestion endpoint.
  - Returns file/folder candidates under the current WebChat working directory.
  - Marks folders distinctly and lets the user continue narrowing inside a
    selected folder.

- `cli/server/webchat/autocompleteState.js`
  - Tracks structured file/path references selected from suggestions.
  - Supports removing stale references when the matching token is deleted.
  - Exposes references to `network.postEnvelope`.

### Server Endpoints

Add WebChat-owned suggestion endpoints in `cli/server/handlers/webchat.js`:

- `GET /webchat/suggestions/files`
  - Inputs: `query`, optional `base`, optional `limit`.
  - Uses the effective WebChat launch options to resolve a safe working
    directory. Prefer `workspace-dir` / `workspaceDir`; support existing `dir`
    only when it resolves under the workspace root; otherwise fall back to the
    workspace root.
  - Returns JSON:

    ```json
    {
      "ok": true,
      "root": "relative/base",
      "items": [
        {
          "kind": "file",
          "label": "notes.md",
          "path": "notes.md",
          "relativePath": "notes.md",
          "size": 1234,
          "mtimeMs": 1770000000000
        }
      ]
    }
    ```

  - Does not expose host absolute paths in the response.
  - Applies result caps and ignores binary metadata beyond ordinary size/type.

Do not add a research-specific endpoint. Browser tag suggestions must come from
static launch data such as `tag-relay-tags`; WebChat must not call a
client-supplied MCP tool merely because a URL parameter names one.

### Envelope Contract

Extend the existing WebChat envelope with an optional `references` field while
preserving compatibility with existing `text` and `attachments`:

```json
{
  "__webchatMessage": 1,
  "version": 1,
  "text": "@open-interpreter summarize @file:notes.md",
  "attachments": [],
  "references": [
    {
      "kind": "workspace-path",
      "path": "notes.md",
      "type": "file",
      "label": "notes.md"
    }
  ]
}
```

Server-side envelope parsing and transcript capture should retain sanitized
references. Agents that do not understand references can ignore them.

### AchillesCLI Integration

Update `AssistOSExplorer/AchillesCLI/achilles-cli/src/lib/webchatTagRelay.mjs`:

- `normalizeWebchatMessage` should parse optional `references`.
- For ordinary non-tag prompts, references may be appended as readable context.
- For handled tag-relay prompts, references should be materialized into the
  same `resources`/`paths` submission shape used for attachments.
- Path materialization must resolve against the WebChat working directory or
  workspace root and enforce containment, symlink, secret-file, per-file, and
  total-size caps.

Update AchillesCLI tests to cover:

- references survive envelope normalization;
- valid text references materialize as resources;
- directories can be forwarded as paths or directory resource summaries;
- traversal, absolute paths, symlink escapes, missing files, secret files, and
  oversized files are rejected with natural-language warnings.

### Research Relay Launcher Integration

Research relay plugins should continue to launch AchillesCLI WebChat through
generic tag-relay query parameters. Provide static tags for browser suggestions:

- keep `tag-relay-agent=researchRelay`;
- keep `tag-relay-submit-tool=research_task_submit`;
- keep `tag-relay-list-tool=research_relay_list_backends`;
- keep `tag-relay-tags` populated for browser autocomplete.

No Ploinky core file may name the research relay or active research tags.

## Implementation Steps

1. Inspect current dirty state in:
   - `/Users/danielsava/work/file-parser/ploinky`
   - `/Users/danielsava/work/file-parser/AssistOSExplorer`
   - `/Users/danielsava/work/file-parser/copilot-agents`

2. Preserve unrelated dirty changes. In Ploinky, leave
   `node_modules/achillesAgentLib` unstaged and untouched.

3. Add or update Ploinky specs before code:
   - `docs/webchat.html`
   - `docs/specs/DS005-routing-and-web-surfaces.md`
   - `docs/specs/DS011-security-model.md`
   - `docs/specs/matrix.md` only if the spec index needs title/status updates.

4. Document the generic invariant explicitly:
   - Ploinky WebChat owns triggers, menus, envelope transport, and workspace
     path suggestion confinement.
   - Selected agents and agent-owned catalogs own tag semantics.
   - No optional agent ids, backend tags, or tool names in Ploinky core.

5. Extract slash autocomplete into provider shape without behavior changes.
   Keep existing tests passing before adding `@` behavior.

6. Add the generic composer autocomplete controller:
   - trigger detection for `/` and `@`;
   - token extraction based on cursor position, not only `lastIndexOf`;
   - grouped menu rendering;
   - Arrow Up/Down, Enter, Tab, Escape behavior;
   - pointer selection;
   - accessibility roles equivalent to the current slash menu.

7. Add tag catalog provider:
   - parse launch/query config from page data produced by
     `resolveWebchatLaunchOptions`;
   - support static `tag-relay-tags`;
   - do not perform browser-side MCP `tools/call` from `tag-relay-agent` or
     `tag-relay-list-tool`;
   - keep dynamic backend validation in the selected chat agent/relay path;
   - fail closed by hiding tag suggestions, not by breaking chat.

8. Add workspace path suggestion endpoint:
   - resolve working directory from query config using workspace-confined
     helpers;
   - list files/folders under the requested base;
   - filter by current token text;
   - sort directories before files, then by name;
   - cap results;
   - exclude reserved secret paths and hidden runtime internals that Explorer
     already hides from normal filesystem navigation when applicable.

9. Add workspace path provider:
   - query `/webchat/suggestions/files` while typing after `@`;
   - show file/folder candidates in a separate `Files` group;
   - insert a stable textual token such as `@file:<relative-path>`;
   - create a matching structured `workspace-path` reference in autocomplete
     state.

10. Extend WebChat envelope serialization:
    - client `network.js` includes `references`;
    - server `parseInputEnvelope` and `serializeWebchatEnvelopeForAgent`
      sanitize references;
    - transcript capture stores references on user messages;
    - unknown fields continue to be ignored.

11. Keep upload behavior intact:
    - WebChat attachment uploads through `/blobs` still work;
    - uploaded attachments can optionally appear as an `Uploads` suggestion
      group for the current tab;
    - Explorer workspace uploads through `/upload` remain separate.

12. Update AchillesCLI:
    - parse envelope references;
    - materialize workspace-path references for tag relay;
    - include warnings in the prompt when references cannot be forwarded;
    - keep unknown mention fallthrough behavior unchanged.

13. Update copilot-agents only where necessary:
    - docs/specs that describe WebChat research tag behavior;
    - research relay plugins if static browser tag parameters need adjustment;
    - no Ploinky coupling.

14. Add tests:
    - Ploinky unit tests for trigger parsing, slash compatibility, tag catalog
      normalization, workspace path endpoint validation, secret/path rejection,
      and envelope reference sanitization.
    - AchillesCLI unit tests for reference normalization/materialization and
      tag-relay forwarding.
    - Existing research relay tests should continue to pass.

15. Run syntax and unit checks:
    - in Ploinky:
      - `node --check cli/server/webchat/index.js cli/server/webchat/composerAutocomplete.js cli/server/webchat/network.js cli/server/handlers/webchat.js`
      - include each new provider module in `node --check`
      - `node --test tests/unit/*.test.mjs`
      - `git diff --check`
    - in AssistOSExplorer/AchillesCLI:
      - `node --check AchillesCLI/achilles-cli/src/index.mjs AchillesCLI/achilles-cli/src/lib/webchatTagRelay.mjs`
      - `node --test AchillesCLI/tests/webchatTagRelay.test.mjs AchillesCLI/tests/webchatControl.test.mjs`
      - `git diff --check`
    - in copilot-agents if touched:
      - `node --test tests/unit/*.test.mjs`
      - `node scripts/validate-manifests.mjs`
      - `git diff --check`

16. Run a browser E2E in a fresh workspace:
    - enable Explorer, AchillesCLI, and the research-agents bundle;
    - open:

      ```text
      /webchat?agent=achilles-cli&research-tags=1&forward-envelope=1&tag-relay-agent=researchRelay&tag-relay-submit-tool=research_task_submit&tag-relay-list-tool=research_relay_list_backends&tag-relay-tags=open-interpreter,oi&workspace-dir=<test-dir>
      ```

    - type `@` and verify:
      - active research tags appear;
      - files/folders in `<test-dir>` appear;
      - selecting a tag inserts `@tag `;
      - selecting a file inserts the file token and adds an envelope reference;
      - sending `@open-interpreter Give a one sentence configuration status.`
        still returns the natural-language runtime/model configuration result.

17. Before finishing, audit for forbidden coupling:

    ```bash
    rg 'researchRelay|openInterpreterAgent|open-interpreter|research_task_submit' \
      cli/server cli/server/webchat
    ```

    Matches in Ploinky WebChat/core should be absent except in tests that
    explicitly prove generic configuration is not hardcoded.

## Expected Result

WebChat becomes a generic, provider-driven composer surface. Research users can
discover `@` tags and nearby workspace files without memorizing names, while
Ploinky stays uncoupled from research agents and downstream providers keep
responsibility for actual task execution and resource authorization.
