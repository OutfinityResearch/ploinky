# WebChat Session Upload Isolation Plan

## Goal

Change Ploinky WebChat upload and `@file:` discovery behavior so each WebChat
session owns an upload directory under the chat working directory:

```text
<cwd>/uploads/<sessionId>
```

`sessionId` means the current WebChat browser session id, currently represented
by the `webchat_sid` cookie created by `ensureAppSession()` in
`cli/server/handlers/webchat.js`. It is not the browser tab id and not the
router authentication session JWT.

After this change:

- WebChat file uploads write into `<cwd>/uploads/<webchat_sid>/`.
- WebChat folder uploads preserve nested paths under that session directory.
- WebChat `@` file/folder suggestions search only inside
  `<cwd>/uploads/<webchat_sid>/`.
- Suggested and inserted `@file:` paths remain cwd-relative, for example
  `@file:uploads/<webchat_sid>/report.pdf`.
- Existing global `/blobs` behavior remains intact for non-WebChat callers and
  current blob regression tests.

## Current Behavior

1. WebChat file selection is implemented in `cli/server/webchat/upload.js`.
   The hidden file input in `cli/server/webchat/chat.html` supports multiple
   file selection but not folder selection.

2. WebChat sends selected files through `createNetwork().uploadAttachment()` in
   `cli/server/webchat/network.js`. The upload URL is currently the global
   `/blobs` endpoint.

3. The global `/blobs` handler in `cli/server/handlers/blobs.js` stores shared
   uploads under `.ploinky/shared` when called as `POST /blobs`, and stores
   agent-scoped uploads under an agent `blobs/` directory when called as
   `POST /blobs/<agent>`.

4. WebChat creates and stores an app session id through `ensureAppSession()` in
   `cli/server/handlers/webchat.js`. The cookie name is `webchat_sid`; the value
   is a random 32-character hex string.

5. WebChat file suggestions are served by
   `GET /webchat/suggestions/files` in `cli/server/handlers/webchat.js`.
   Today the endpoint resolves the WebChat working directory from
   `workspace-dir`, `workspaceDir`, or compatible `dir`, then lists files and
   folders from that working directory.

6. The client-side `@file:` provider in
   `cli/server/webchat/autocompleteProviders/workspacePaths.js` consumes the
   suggestion endpoint, inserts `@file:<relative-path>` tokens, and records
   structured `workspace-path` references for the outgoing WebChat envelope.

## Non-Negotiable Invariants

1. Ploinky WebChat must remain framework code. Do not hardcode optional agent
   ids, backend tags, or agent-owned MCP tool names.

2. Upload paths and suggestion paths must remain confined to the resolved
   WebChat working directory.

3. Upload and suggestion inputs must reject absolute caller paths, traversal
   segments, NUL bytes, symlink escapes, `.secrets`, and `*.secrets`.

4. Host absolute paths must not be returned to the browser in upload or
   suggestion responses.

5. Existing `/blobs` routes and tests must continue to work unless explicitly
   updated for a separate compatibility reason.

6. Existing `forward-envelope=1` behavior must remain compatible. Agents that
   ignore `attachments` or `references` should continue to ignore them safely.

7. Folder uploads must not allow a browser-provided nested path to escape the
   session upload root.

8. The session upload directory is a convenience boundary for WebChat UX, not a
   security boundary between hostile users or agents.

## Design

### Working Directory

Use the same WebChat working-directory resolution already used for file
suggestions:

- prefer `workspace-dir`;
- accept `workspaceDir`;
- support compatible `dir` only when it resolves under the Ploinky workspace
  root;
- fall back to the workspace root.

In code, this means reusing or extracting logic from
`resolveWebchatWorkspaceBase(parsedUrl)`.

### Session Id

Use the WebChat app session id returned by `ensureAppSession(req, res,
appState)`.

This is preferable to the browser-generated `TAB_ID` because the requirement is
for the current WebChat session, not one tab or one stream connection. Multiple
tabs within the same WebChat app session can share the same upload scope.

### Upload Root

For a request with working directory `<cwd>` and WebChat session id
`<sessionId>`, the upload root is:

```text
<cwd>/uploads/<sessionId>
```

The server should create the directory lazily on first upload and may create it
for suggestions so an empty session returns an empty result set.

### File Upload Endpoint

Add a WebChat-owned endpoint under the authenticated WebChat handler:

```text
POST /webchat/uploads
```

The request body is the file bytes. Required request metadata:

- `X-File-Name`: original display filename.
- `X-Relative-Path`: optional browser-provided relative path for folder upload
  entries. For plain file uploads this can be omitted or equal to the filename.
- `X-Mime-Type`: optional MIME type.

The response should be JSON:

```json
{
  "ok": true,
  "filename": "report.pdf",
  "relativePath": "report.pdf",
  "localPath": "uploads/<sessionId>/report.pdf",
  "workspacePath": "uploads/<sessionId>/report.pdf",
  "downloadUrl": "/webchat/uploads?path=report.pdf",
  "size": 1234,
  "mime": "application/pdf"
}
```

`relativePath` is relative to the session upload root. `localPath` and
`workspacePath` are relative to the WebChat working directory so existing
workspace-path materialization logic can read them from cwd.

### Download Endpoint

Add authenticated read support for uploaded files so image previews and
attachment links continue to work:

```text
GET  /webchat/uploads?path=<session-relative-path>
HEAD /webchat/uploads?path=<session-relative-path>
```

The `path` query parameter is relative to `<cwd>/uploads/<sessionId>`, not to
the whole workspace. It must use the same sanitization as upload paths. The
response should stream the file with `X-Content-Type-Options: nosniff`,
`Content-Type`, `Content-Length`, and range support if practical. Range support
can be reused from existing blob streaming code or added in a small helper.

### Collision Behavior

Avoid silent overwrites. Use one of these policies and test it:

- return HTTP 409 when the target file already exists; or
- generate a deterministic suffix such as `report (1).pdf`.

Prefer suffixing for browser UX unless the implementation becomes too large.
Either way, the response must report the actual stored path.

### Folder Upload

Add browser folder selection using a separate menu item and hidden input:

```html
<button id="uploadFolderBtn">Upload folder</button>
<input type="file" id="folderUploadInput" webkitdirectory multiple hidden>
```

When the browser supplies `file.webkitRelativePath`, preserve that path as the
upload `relativePath`. Sanitize it server-side before writing. Display nested
paths in the preview list so a user can see which folder entries were selected.

The existing normal file upload and camera-capture flows should still work.
Camera uploads should use their generated filename with no nested relative path.

### Suggestion Scope

Change `GET /webchat/suggestions/files` so it lists only the current session
upload root.

Internally:

1. Resolve WebChat cwd.
2. Get or create the WebChat app session id.
3. Resolve `<cwd>/uploads/<sessionId>` with realpath-aware containment checks.
4. Interpret incoming `query` and optional `base` relative to that upload root.
5. Return only candidates under that upload root.

The browser-facing suggestion item should keep display paths clean while
preserving cwd-relative reference paths:

```json
{
  "kind": "file",
  "label": "report.pdf",
  "displayPath": "report.pdf",
  "path": "uploads/<sessionId>/report.pdf",
  "relativePath": "report.pdf",
  "workspacePath": "uploads/<sessionId>/report.pdf",
  "size": 1234,
  "mtimeMs": 1770000000000
}
```

The client may keep using `item.path` as the inserted `@file:` token value if
`path` is cwd-relative. If a smaller client change is desired, add a separate
`queryPath` field for folder drilling while leaving `path` as cwd-relative.

### Client Upload Flow

Update `createNetwork().uploadAttachment()` in
`cli/server/webchat/network.js`:

- replace the global upload URL `/blobs` with `toEndpoint('uploads')`;
- include `credentials: 'include'`;
- send `X-Relative-Path` when selection metadata includes it;
- use the returned `downloadUrl`, `localPath`, `workspacePath`, `size`, and
  `mime` fields;
- keep the outgoing envelope attachment shape compatible.

### Client Selection Flow

Update `createUploader()` in `cli/server/webchat/upload.js`:

- track `relativePath` on each selection;
- use `webkitRelativePath` for folder entries;
- display nested relative paths in preview labels;
- return `relativePath` from `getSelectedFiles()`.

Update `initDom()` and `chat.html` to wire the folder button and folder input.

### Server Helper Extraction

Keep repeated path logic small and testable. Candidate helpers in
`cli/server/handlers/webchat.js` or a nearby WebChat upload module:

- `normalizeWebchatSessionId(sessionId)`
- `sanitizeUploadRelativePath(rawPath, fallbackName)`
- `resolveWebchatUploadContext(req, res, appState, parsedUrl)`
- `resolveWebchatUploadTarget(context, relativePath)`
- `buildStoredUploadResponse(context, storedRelativePath, meta)`

If these helpers grow too large for `webchat.js`, place them in a sibling file
such as `cli/server/webchat/uploadPaths.js` or
`cli/server/handlers/webchatUploads.js`.

## Implementation Steps

1. Inspect local status in `/Users/danielsava/work/file-parser/ploinky`.
   Preserve unrelated dirty changes. In particular, do not revert or stage
   `node_modules/achillesAgentLib`.

2. Update specs/docs first:
   - `docs/specs/DS005-routing-and-web-surfaces.md`
   - `docs/specs/DS011-security-model.md`
   - `docs/webchat.html`

3. Add WebChat upload path helpers and unit tests for:
   - valid session upload root resolution;
   - absolute path rejection;
   - traversal rejection;
   - NUL rejection;
   - `.secrets` and `*.secrets` rejection;
   - symlink escape rejection;
   - folder relative-path normalization.

4. Add `POST /webchat/uploads` and `GET`/`HEAD /webchat/uploads`.

5. Update the browser upload flow to call `/webchat/uploads` and carry
   relative paths.

6. Add folder upload UI and DOM wiring.

7. Change `/webchat/suggestions/files` to use the current session upload root
   as its search root and return cwd-relative `path` values.

8. Adjust `workspacePaths.js` only if the response shape needs a distinct
   value for folder drilling versus inserted reference path.

9. Keep `/blobs` behavior unchanged and verify existing blob tests still pass.

10. Run targeted checks and then broader tests.

## Tests To Add Or Update

Ploinky unit tests:

- `sanitizeUploadRelativePath` accepts `report.pdf` and `folder/report.pdf`.
- It rejects `/absolute`, `../escape`, `folder/../../escape`, `with\0nul`,
  `.secrets`, `folder/.secrets`, and `config.secrets`.
- WebChat upload context resolves to `<cwd>/uploads/<sessionId>`.
- Upload suggestions list only files under the current session id.
- Upload suggestions do not show sibling session directories.
- Upload suggestions reject symlink escapes from the session upload root.
- Folder upload paths preserve nested relative structure.
- Inserted `@file:` values are cwd-relative paths under
  `uploads/<sessionId>/`.

Regression tests:

- Existing `/blobs` shared and agent upload/download tests still pass.
- Existing WebChat reference sanitization tests still pass.
- Existing WebChat autocomplete tests still pass after suggestion root changes.

## Suggested Verification

Run in `ploinky`:

```bash
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

If a router smoke workspace is already running, manually verify:

1. Open WebChat for an authenticated agent.
2. Upload a single file.
3. Upload a folder with at least two nested files.
4. Confirm files exist under `<cwd>/uploads/<webchat_sid>/`.
5. Type `@` and verify only current-session uploads are suggested.
6. Select a suggested file and send a message with `forward-envelope=1`.
7. Confirm the envelope contains a sanitized `workspace-path` reference under
   `uploads/<webchat_sid>/`.

## Expected Deliverable Summary

When implementation is done, summarize:

- files changed;
- how `sessionId` is resolved;
- how files and folders are written under `cwd/uploads/sessionId`;
- how `@` suggestions are scoped to the same session upload root;
- which checks passed;
- any skipped browser or smoke verification and why.
