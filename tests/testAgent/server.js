const http = require('http');
const fs = require('fs');
const path = require('path');

const agentName = process.env.AGENT_NAME || 'unknown-agent';
const port = Number(process.env.PORT || 7000);
const workspacePath = process.env.WORKSPACE_PATH || process.cwd();
const logPath = path.join(workspacePath, 'fast-start.log');
const dataDir = path.join(workspacePath, 'data');
const dataFile = path.join(dataDir, 'fast-persist.txt');

try { fs.mkdirSync(dataDir, { recursive: true }); } catch (_) {}
try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] boot ${agentName}
`); } catch (_) {}
try { fs.writeFileSync(dataFile, `initialized:${agentName}`); } catch (_) {}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, agent: agentName }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('fast-suite');
});

server.listen(port, '0.0.0.0', () => {
  try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] listening:${port}
`); } catch (_) {}
});
