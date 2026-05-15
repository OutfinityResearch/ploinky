# Implementation Prompt: WebChat Session Upload Isolation

You are working in `/Users/danielsava/work/file-parser`.

Primary goal: implement WebChat session-scoped uploads in Ploinky. WebChat
uploads must write files and folders under:

```text
<cwd>/uploads/<sessionId>
```

`sessionId` is the current WebChat app session id from the `webchat_sid` cookie.
After implementation, WebChat `@` file/folder suggestions must search only
inside the current session upload directory.

Use this plan as the source of truth:

`/Users/danielsava/work/file-parser/ploinky/docs/plans/webchat-session-upload-plan.md`

## Required Starting Context

Read the workspace and subrepo instructions first:

```bash
cd /Users/danielsava/work/file-parser && sed -n '1,220p' CLAUDE.md
cd /Users/danielsava/work/file-parser/ploinky && sed -n '1,220p' CLAUDE.md
```

Inspect status and diffs before editing:

```bash
cd /Users/danielsava/work/file-parser/ploinky
git status --short --branch
git diff
```

There may be dirty changes from prior work. Do not revert unrelated changes.
Do not stage or modify `node_modules/achillesAgentLib` unless explicitly
required by the user.

## Hard Invariants

- Ploinky framework code must not hardcode optional agent ids, research backend
  tags, or agent-owned MCP tool names.
- WebChat upload paths and suggestion paths must remain confined to the
  resolved WebChat working directory.
- Reject absolute caller paths, traversal, NUL bytes, symlink escapes,
  `.secrets`, and `*.secrets`.
- Do not expose host absolute paths in upload or suggestion responses.
- Existing global `/blobs` behavior and tests must continue to work.
- Agents that ignore WebChat `attachments` or `references` must remain
  compatible.
- The session upload directory is a UX scope, not a hostile multi-tenant
  security boundary.

## Existing Code To Inspect

Start with these files:

- `ploinky/cli/server/handlers/webchat.js`
  - `ensureAppSession()`
  - `resolveWebchatWorkspaceBase()`
  - `handleSuggestionsFiles()`
  - `/input` envelope handling
- `ploinky/cli/server/webchat/network.js`
  - `uploadAttachment()`
  - `sendAttachments()`
- `ploinky/cli/server/webchat/upload.js`
  - file selection and preview handling
- `ploinky/cli/server/webchat/chat.html`
  - attachment menu and hidden file input
- `ploinky/cli/server/webchat/domSetup.js`
  - DOM element wiring
- `ploinky/cli/server/webchat/autocompleteProviders/workspacePaths.js`
  - `@file:` suggestion client
- `ploinky/cli/server/handlers/blobs.js`
  - existing global blob behavior to preserve
- `ploinky/cli/server/utils/workspacePaths.js`
  - workspace confinement helpers

## Implementation Tasks

1. Update docs/specs first:
   - `ploinky/docs/specs/DS005-routing-and-web-surfaces.md`
   - `ploinky/docs/specs/DS011-security-model.md`
   - `ploinky/docs/webchat.html`

2. Add WebChat upload path helpers:
   - resolve WebChat cwd from the same launch options used for suggestions;
   - resolve `sessionId` from `ensureAppSession()`;
   - build `<cwd>/uploads/<sessionId>`;
   - sanitize upload-relative paths;
   - reject unsafe or secret paths;
   - prevent symlink escapes.

3. Add WebChat-owned upload routes:
   - `POST /webchat/uploads`
   - `GET /webchat/uploads?path=<session-relative-path>`
   - `HEAD /webchat/uploads?path=<session-relative-path>`

4. Change browser file upload:
   - send files to `toEndpoint('uploads')`, not `/blobs`;
   - include credentials;
   - send `X-File-Name`, `X-Relative-Path`, and `X-Mime-Type`;
   - consume returned `localPath`, `workspacePath`, `downloadUrl`, `size`, and
     `mime`.

5. Add folder upload UI:
   - add an upload-folder menu item;
   - add a hidden `webkitdirectory multiple` input;
   - wire it through `domSetup.js` and `upload.js`;
   - preserve `file.webkitRelativePath` as each selection's relative path.

6. Scope `@` suggestions:
   - make `/webchat/suggestions/files` search only
     `<cwd>/uploads/<sessionId>`;
   - return clean display paths but cwd-relative inserted paths such as
     `uploads/<sessionId>/folder/file.txt`;
   - ensure sibling session upload folders never appear.

7. Adjust `workspacePaths.js` only if necessary:
   - keep inserted `@file:` tokens cwd-relative;
   - preserve structured `workspace-path` references;
   - keep folder drilling ergonomic.

8. Preserve compatibility:
   - do not remove `/blobs`;
   - keep existing attachment envelope fields usable;
   - keep transcript and `forward-envelope=1` behavior intact.

9. Add or update tests:
   - path sanitization;
   - upload root resolution;
   - folder relative-path handling;
   - session-scoped suggestions;
   - sibling-session exclusion;
   - symlink escape rejection;
   - existing WebChat reference/autocomplete behavior.

10. Run verification:

    ```bash
    cd /Users/danielsava/work/file-parser/ploinky

    node --check \
      cli/server/handlers/webchat.js \
      cli/server/handlers/blobs.js \
      cli/server/webchat/network.js \
      cli/server/webchat/upload.js \
      cli/server/webchat/domSetup.js \
      cli/server/webchat/autocompleteProviders/workspacePaths.js

    node --test \
      tests/unit/webchatSuggestionsFiles.test.mjs \
      tests/unit/webchatReferences.test.mjs \
      tests/unit/composerAutocomplete.test.mjs

    git diff --check
    ```

11. If feasible, run a browser/manual verification:
    - open authenticated WebChat;
    - upload one file;
    - upload one folder;
    - confirm files land under `<cwd>/uploads/<webchat_sid>`;
    - type `@` and confirm only current-session uploads appear;
    - send a selected `@file:` reference with `forward-envelope=1`.

## Deliverable Summary Expected

When done, summarize:

- files changed;
- how the WebChat `sessionId` is resolved;
- where uploads are written;
- how folder paths are preserved safely;
- how `@` suggestions are scoped;
- tests and checks run;
- any skipped browser verification and why.
