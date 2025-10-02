import { randomUUID } from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// AgentServer (MCP over HTTP): exposes tools/resources via Streamable HTTP transport on PORT (default 7000) at /mcp.

async function loadSdkDeps() {
  const mcp = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const streamHttp = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const types = await import('@modelcontextprotocol/sdk/types.js');
  return {
    McpServer: mcp.McpServer,
    ResourceTemplate: mcp.ResourceTemplate,
    StreamableHTTPServerTransport: streamHttp.StreamableHTTPServerTransport,
    isInitializeRequest: types.isInitializeRequest,
    McpError: mcp.McpError,
    ErrorCode: mcp.ErrorCode
  };
}

function resolveConfigPaths() {
  const explicit = [
    process.env.PLOINKY_AGENT_CONFIG,
    process.env.MCP_CONFIG_FILE,
    process.env.AGENT_CONFIG_FILE
  ].filter(Boolean);
  const defaults = [
    process.env.PLOINKY_MCP_CONFIG_PATH,
    '/tmp/ploinky/mcp-config.json',
    '/code/mcp-config.json',
    path.join(process.cwd(), 'mcp-config.json')
  ];
  return [...explicit, ...defaults];
}

function loadConfig() {
  const candidates = resolveConfigPaths();
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) continue;
      const raw = fs.readFileSync(candidate, 'utf8');
      const parsed = JSON.parse(raw);
      return { source: candidate, config: parsed };
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      if (err instanceof SyntaxError) {
        console.error(`[AgentServer/MCP] Failed to parse config '${candidate}': ${err.message}`);
      } else {
        console.error(`[AgentServer/MCP] Cannot read config '${candidate}': ${err.message}`);
      }
    }
  }
  return null;
}

function buildCommandSpec(entry, defaultCwd) {
  const command = entry?.command;
  if (!command || (typeof command !== 'string' && !Array.isArray(command))) return null;
  const cwd = entry?.cwd ? path.resolve(defaultCwd, entry.cwd) : defaultCwd;
  const env = entry?.env && typeof entry.env === 'object' ? entry.env : {};
  const timeoutMs = Number.isFinite(entry?.timeoutMs) ? entry.timeoutMs : undefined;
  return { command, cwd, env, timeoutMs };
}

function executeShell(spec, payload) {
  return new Promise((resolve, reject) => {
    const { command, cwd, env, timeoutMs } = spec;
    const cmd = Array.isArray(command) ? command[0] : command;
    const args = Array.isArray(command) ? command.slice(1) : ['-lc', command];
    const executable = Array.isArray(command) ? cmd : '/bin/sh';
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    });
    try {
      child.stdin.end(JSON.stringify(payload ?? {}) + '\n');
    } catch (_) {
      // ignore broken pipes
    }
  });
}

function extractTemplateParams(template) {
  const params = {};
  const regex = /\{([^}]+)\}/g;
  let match;
  while ((match = regex.exec(template)) !== null) {
    params[match[1]] = undefined;
  }
  return params;
}

async function registerFromConfig(server, config, helpers) {
  if (!config || typeof config !== 'object') return;
  const { ResourceTemplate, McpError, ErrorCode } = helpers;
  const defaultCwd = '/code';

  if (Array.isArray(config.tools)) {
    for (const tool of config.tools) {
      if (!tool || typeof tool !== 'object') continue;
      const name = typeof tool.name === 'string' ? tool.name : null;
      if (!name) continue;
      const commandSpec = buildCommandSpec(tool, defaultCwd);
      if (!commandSpec) {
        console.warn(`[AgentServer/MCP] Skipping tool '${name}' - missing command`);
        continue;
      }
      const definition = {
        title: tool.title,
        description: tool.description
      };

      server.registerTool(name, definition, async (args = {}, metadata = {}) => {
        const payload = { tool: name, input: args, metadata };
        const result = await executeShell(commandSpec, payload);
        if (result.code !== 0) {
          const message = result.stderr?.trim() || `command exited with code ${result.code}`;
          if (helpers && helpers.McpError && helpers.ErrorCode) {
            throw new helpers.McpError(helpers.ErrorCode.InternalError, message);
          }
          throw new Error(message);
        }
        const textOut = result.stdout?.length ? result.stdout : '(no output)';
        const content = [{ type: 'text', text: textOut }];
        if (result.stderr && result.stderr.trim()) {
          content.push({ type: 'text', text: `stderr:\n${result.stderr}` });
        }
        return { content };
      });
    }
  }

  if (Array.isArray(config.resources)) {
    for (const resource of config.resources) {
      if (!resource || typeof resource !== 'object') continue;
      const name = typeof resource.name === 'string' ? resource.name : null;
      if (!name) continue;
      const commandSpec = buildCommandSpec(resource, defaultCwd);
      if (!commandSpec) {
        console.warn(`[AgentServer/MCP] Skipping resource '${name}' - missing command`);
        continue;
      }
      const metadata = {
        title: resource.title || name,
        description: resource.description || '',
        mimeType: resource.mimeType || 'text/plain'
      };
      if (resource.template && typeof resource.template === 'string') {
        const template = new ResourceTemplate(resource.template, extractTemplateParams(resource.template));
        server.registerResource(name, template, metadata, async (uri, params = {}) => {
          const payload = { resource: name, uri: uri.href, params };
          const result = await executeShell(commandSpec, payload);
          if (result.code !== 0) {
            const message = result.stderr?.trim() || `command exited with code ${result.code}`;
            throw new McpError(ErrorCode.InternalError, message);
          }
          return {
            contents: [{ uri: uri.href, text: result.stdout, mimeType: metadata.mimeType }]
          };
        });
      } else if (resource.uri && typeof resource.uri === 'string') {
        server.registerResource(name, resource.uri, metadata, async (uri) => {
          const payload = { resource: name, uri: uri.href };
          const result = await executeShell(commandSpec, payload);
          if (result.code !== 0) {
            const message = result.stderr?.trim() || `command exited with code ${result.code}`;
            throw new McpError(ErrorCode.InternalError, message);
          }
          return {
            contents: [{ uri: uri.href, text: result.stdout, mimeType: metadata.mimeType }]
          };
        });
      } else {
        console.warn(`[AgentServer/MCP] Skipping resource '${name}' - missing uri/template definition`);
      }
    }
  }

  if (Array.isArray(config.prompts)) {
    for (const prompt of config.prompts) {
      if (!prompt || typeof prompt !== 'object') continue;
      const name = typeof prompt.name === 'string' ? prompt.name : null;
      if (!name) continue;
      if (!Array.isArray(prompt.messages) || !prompt.messages.length) {
        console.warn(`[AgentServer/MCP] Skipping prompt '${name}' - missing messages`);
        continue;
      }
      server.registerPrompt(name, {
        description: prompt.description,
        messages: prompt.messages
      });
    }
  }
}

async function createServerInstance() {
  const { McpServer, ResourceTemplate, McpError, ErrorCode } = await loadSdkDeps();
  const server = new McpServer({ name: 'ploinky-agent-mcp', version: '1.0.0' });

  const configResult = loadConfig();
  const config = configResult ? configResult.config : {};

  if (configResult) {
    console.log(`[AgentServer/MCP] Loaded config from ${configResult.source}`);
  } else {
    console.log('[AgentServer/MCP] No configuration file found; starting with an empty configuration.');
  }
  await registerFromConfig(server, config, { ResourceTemplate, McpError, ErrorCode });

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
