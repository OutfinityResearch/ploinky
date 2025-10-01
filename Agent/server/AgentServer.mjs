import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { registerDemoCommands } from './commandsConfig.mjs';

// AgentServer (MCP over HTTP): exposes tools/resources via Streamable HTTP transport on PORT (default 7000) at /mcp.

async function loadSdkDeps() {
  const mcp = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const streamHttp = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const types = await import('@modelcontextprotocol/sdk/types.js');
  const zod = await import('zod');
  return {
    McpServer: mcp.McpServer,
    ResourceTemplate: mcp.ResourceTemplate,
    StreamableHTTPServerTransport: streamHttp.StreamableHTTPServerTransport,
    isInitializeRequest: types.isInitializeRequest,
    z: zod.z,
    McpError: mcp.McpError,
    ErrorCode: mcp.ErrorCode
  };
}

async function createServerInstance() {
  const { McpServer, ResourceTemplate, z, McpError, ErrorCode } = await loadSdkDeps();
  const server = new McpServer({ name: 'ploinky-agent-mcp', version: '1.0.0' });

  // Register demo tools/resources from separate config
  await registerDemoCommands(server, { z, ResourceTemplate, McpError, ErrorCode });

  // Basic health resource for quick checks via resource read
  server.registerResource(
    'health',
    'health://status',
    {
      title: 'Health Status',
      description: 'Simple health indicator resource',
      mimeType: 'application/json'
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify({ ok: true, server: 'ploinky-agent-mcp' }) }]
    })
  );

  return server;
}

async function main() {
  const { StreamableHTTPServerTransport, isInitializeRequest } = await loadSdkDeps();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 7000;
  const sessions = {};

  const serverHttp = http.createServer((req, res) => {
    const { method, url } = req;
    const sendJson = (code, obj, extraHeaders = {}) => {
      const data = Buffer.from(JSON.stringify(obj));
      res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': data.length, ...extraHeaders });
      res.end(data);
    };
    try {
      const u = new URL(url || '/', 'http://localhost');
      if (method === 'GET' && u.pathname === '/health') {
        return sendJson(200, { ok: true, server: 'ploinky-agent-mcp' });
      }
      if (method === 'POST' && u.pathname === '/mcp') {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', async () => {
          let body = {};
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) { body = {}; }
          const sessionId = req.headers['mcp-session-id'];
          let entry = sessionId && sessions[sessionId] ? sessions[sessionId] : null;
          try {
            if (!entry) {
              if (!isInitializeRequest(body)) {
                return sendJson(400, { jsonrpc: '2.0', error: { code: -32000, message: 'Missing session; send initialize first' }, id: null });
              }
              const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                enableJsonResponse: true,
                onsessioninitialized: (sid) => { sessions[sid] = { transport, server }; }
              });
              const server = await createServerInstance();
              await server.connect(transport);
              transport.onclose = () => {
                try { server.close(); } catch (_) {}
                const sid = transport.sessionId;
                if (sid && sessions[sid]) delete sessions[sid];
              };
              await transport.handleRequest(req, res, body);
              return; // handled
            }
            await entry.transport.handleRequest(req, res, body);
          } catch (err) {
            console.error('[AgentServer/MCP] error:', err);
            if (!res.headersSent) return sendJson(500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
          }
        });
        return;
      }
      // Not found
      res.statusCode = 404; res.end('Not Found');
    } catch (err) {
      console.error('[AgentServer/MCP] http error:', err);
      if (!res.headersSent) return sendJson(500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  });

  serverHttp.listen(PORT, () => {
    console.log(`[AgentServer/MCP] Streamable HTTP listening on ${PORT} (/mcp)`);
  });
}

main().catch(err => { console.error('[AgentServer/MCP] fatal error:', err); process.exit(1); });
