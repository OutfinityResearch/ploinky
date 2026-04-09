# Remove syncCoreDependencies — Always Run npm install

## Problem

Agents receive a stale copy of achillesAgentLib because of three compounding caching layers:

1. **`syncCoreDependencies`** runs on the host before the container starts. It copies achillesAgentLib from ploinky's own `node_modules/` (a git clone that's never updated) into the agent workspace's `node_modules/`.

2. **`buildEntrypointInstallScript`** runs `npm install` inside the container, but guards it with `if [ -d "$WORKSPACE_PATH/node_modules/mcp-sdk" ]`. Since step 1 already copied `mcp-sdk`, the guard always passes and npm install never executes.

3. **Package stamp** (commit `0f84402`, Mar 30) adds another layer: `needsHostInstall()` skips install if `package.json` hasn't changed since the last stamp, even if the upstream GitHub repo has new commits.

Net effect: once ploinky is installed, agents are locked to the achillesAgentLib version from that moment. Changes pushed to GitHub are never picked up.

## Solution

Remove `syncCoreDependencies` from the agent start flow and let `npm install` run inside every container on every start. Delete `achillesAgentLib` from `node_modules` before `npm install` to force npm to re-fetch from GitHub HEAD.

## Changes

### 1. Remove `syncCoreDependencies` calls from agent restart

**File:** `ploinky/cli/commands/cli.js`

Remove the `syncCoreDependencies` call in two restart paths:
- Line ~450-459: bwrap agent restart path
- Line ~529-538: container (stop/start) restart path

Both follow the same pattern — import `syncCoreDependencies`, call it with `{ force: true }`, log the result. Remove the entire try/catch block in each. The function definition stays in `dependencyInstaller.js` (no dead code cleanup needed now).

### 2. Update `buildEntrypointInstallScript` — remove cache guard, force fresh achillesAgentLib

**File:** `ploinky/cli/services/dependencyInstaller.js`

Replace the mcp-sdk cache check:

```bash
if [ -d "$WORKSPACE_PATH/node_modules/mcp-sdk" ]; then
    echo "[deps] <agent>: Using cached node_modules";
else
    echo "[deps] <agent>: Installing dependencies...";
    # install git + build tools ...
    npm install --prefix "$WORKSPACE_PATH";
fi
```

With:

```bash
echo "[deps] <agent>: Installing dependencies...";
# install git + build tools (only if missing)
( command -v git >/dev/null 2>&1 || ... ) 2>/dev/null;
# Force fresh achillesAgentLib — delete before npm install
rm -rf "$WORKSPACE_PATH/node_modules/achillesAgentLib";
npm install --prefix "$WORKSPACE_PATH";
```

Other deps (pg, mcp-sdk) remain cached in node_modules and npm resolves them instantly. Only achillesAgentLib is re-fetched from GitHub (~3-5s).

### 3. Revert `git pull` bandaid in `syncCoreDepsFromPath`

**File:** `ploinky/cli/services/dependencyInstaller.js`

Remove the `git pull --ff-only` loop added in commit `3a37ab0`. It's no longer needed since `syncCoreDependencies` won't be called.

### 4. Revert deploy workflow ploinky pull

**File:** `proxies/.github/workflows/deploy-soul-gateway.yml`

Remove the "Pull latest ploinky" step that was added to propagate the `git pull` fix. No longer needed.

## What stays unchanged

- Build tool installation (git, python3, make, g++) in entrypoint
- LLMConfig.json copy step
- Package stamp logic (`0f84402`) — becomes inert since npm always runs, no need to remove
- soul-gateway's `startup.sh` — its own npm install guard at line 21 becomes a secondary fallback
- `CORE_DEPENDENCIES` list — stays for reference, just not used in the start path

## Impact

- Container restarts ~3-5s slower (npm re-fetches achillesAgentLib)
- achillesAgentLib always matches GitHub HEAD on every start
- No stale dependency issues on any server or local workspace
- Deploy workflow simplified (no ploinky pull step needed)
- `syncCoreDependencies` function remains available if needed in future, just not called

## Files Modified

- `ploinky/cli/commands/cli.js` — remove two syncCoreDependencies calls in restart paths
- `ploinky/cli/services/dependencyInstaller.js` — update buildEntrypointInstallScript, revert git pull
- `proxies/.github/workflows/deploy-soul-gateway.yml` — remove ploinky pull step
