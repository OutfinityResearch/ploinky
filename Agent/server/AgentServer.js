const http = require('http');
const { spawn } = require('child_process');

// AgentServer: listens on PORT 7000 and, if CHILD_CMD is set, executes it per request
// with the JSON body encoded in base64 as a single argv parameter.

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 7000;
const CHILD_CMD = process.env.CHILD_CMD || '';

function runChildWithPayload(obj, cb) {
  if (!CHILD_CMD) return cb(null, null);
  try {
    const b64 = Buffer.from(JSON.stringify(obj || {}), 'utf8').toString('base64');
    // Safe to wrap in single quotes (base64 doesn't contain single quotes)
    const shCmd = `${CHILD_CMD} '${b64}'`;
    const child = spawn('/bin/sh', ['-lc', shCmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = Buffer.alloc(0), err = Buffer.alloc(0);
    child.stdout.on('data', d => { out = Buffer.concat([out, d]); });
    child.stderr.on('data', d => { err = Buffer.concat([err, d]); });
    child.on('close', code => cb(null, { code, stdout: out.toString('utf8'), stderr: err.toString('utf8') }));
  } catch (e) { cb(e); }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (req.url === '/api') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) {}
      if (!CHILD_CMD) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'command not implemented', request: payload }));
      }
      return runChildWithPayload(payload, (err, result) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
        const { code, stdout, stderr } = result || {};
        const ok = (typeof code === 'number') ? (code === 0) : true;
        res.writeHead(ok ? 200 : 500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok, code, stdout, stderr }));
      });
    });
    return;
  }
  res.statusCode = 404;
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`[AgentServer] listening on port ${PORT}]`);
  if (CHILD_CMD) console.log(`[AgentServer] child command: ${CHILD_CMD}`);
});
