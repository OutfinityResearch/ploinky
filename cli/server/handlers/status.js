const fs = require('fs');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');

const staticSrv = require('../static');
const serverManager = require('../../services/serverManager');
const workspace = require('../../services/workspace');

const appName = 'status';
const fallbackAppPath = path.join(__dirname, '../', appName);

function renderTemplate(filenames, replacements) {
  const target = staticSrv.resolveFirstAvailable(appName, fallbackAppPath, filenames);
  if (!target) return null;
  let html = fs.readFileSync(target, 'utf8');
  for (const [key, value] of Object.entries(replacements || {})) {
    html = html.split(key).join(String(value ?? ''));
  }
  return html;
}

function runStatusCommand() {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (payload) => {
      if (resolved) return;
      resolved = true;
      resolve(payload);
    };
    try {
      const proc = spawn('ploinky', ['status'], { cwd: process.cwd() });
      let out = '';
      let err = '';
      proc.stdout.on('data', chunk => out += chunk.toString('utf8'));
      proc.stderr.on('data', chunk => err += chunk.toString('utf8'));
      proc.on('close', (code) => {
        finish({ code, stdout: out, stderr: err });
      });
      proc.on('error', (error) => {
        const message = error && error.message ? error.message : String(error || 'spawn error');
        finish({ code: -1, stdout: out, stderr: message });
      });
    } catch (e) {
      finish({ code: -1, stdout: '', stderr: e?.message || String(e) });
    }
  });
}

function collectServerStatuses() {
  try {
    return serverManager.getAllServerStatuses();
  } catch (_) {
    return {};
  }
}

function collectWorkspaceAgents() {
  try {
    const map = workspace.loadAgents() || {};
    return Object.entries(map)
      .filter(([key]) => key !== '_config')
      .map(([container, rec]) => ({
        container,
        agentName: rec?.agentName || container,
        repoName: rec?.repoName || '',
        image: rec?.containerImage || '',
      }));
  } catch (_) {
    return [];
  }
}

function collectStaticInfo() {
  try {
    const routing = JSON.parse(fs.readFileSync(path.resolve('.ploinky/routing.json'), 'utf8')) || {};
    let repo = null;
    if (routing?.static?.hostPath) {
      // Extract repo name from path like /path/to/.ploinky/repos/repoName/agentName
      const pathParts = routing.static.hostPath.split(path.sep);
      const reposIndex = pathParts.indexOf('repos');
      if (reposIndex !== -1 && reposIndex < pathParts.length - 1) {
        repo = pathParts[reposIndex + 1];
      } else {
        // Fallback: get parent directory name
        repo = path.basename(path.dirname(routing.static.hostPath));
      }
    }
    return {
      agent: routing?.static?.agent || null,
      hostPath: routing?.static?.hostPath || null,
      port: routing?.port || null,
      repo: repo
    };
  } catch (_) {
    return { agent: null, hostPath: null, port: null, repo: null };
  }
}

function handleStatus(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname.substring(`/${appName}`.length) || '/';

  if (pathname.startsWith('/assets/')) {
    const rel = pathname.substring('/assets/'.length);
    const assetPath = staticSrv.resolveAssetPath(appName, fallbackAppPath, rel);
    if (assetPath && staticSrv.sendFile(res, assetPath)) return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    const html = renderTemplate(['status.html', 'index.html'], {
      '__ASSET_BASE__': `/${appName}/assets`,
      '__AGENT_NAME__': 'Status',
      '__CONTAINER_NAME__': '-',
      '__RUNTIME__': 'local',
      '__REQUIRES_AUTH__': 'false',
      '__BASE_PATH__': `/${appName}`
    });
    if (html) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    }
  }

  if (pathname === '/data') {
    Promise.all([runStatusCommand()]).then(([result]) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        code: result.code,
        output: result.stdout || result.stderr || '',
        servers: collectServerStatuses(),
        static: collectStaticInfo(),
        agents: collectWorkspaceAgents()
      }));
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found in App');
}

module.exports = { handleStatus };
