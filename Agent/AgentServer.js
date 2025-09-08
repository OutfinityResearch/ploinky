const http = require('http');

// Simple AgentServer: listens on PORT 7000 by default and responds to JSON POSTs.
// If launched without a specific app, returns a generic "not implemented".

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 7000;

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (req.method === 'POST' && req.url === '/api') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'command not implemented', request: payload }));
    });
    return;
  }
  res.statusCode = 404;
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`[AgentServer] listening on port ${PORT}`);
});

