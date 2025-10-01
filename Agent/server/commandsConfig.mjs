import fs from 'node:fs/promises';
import path from 'node:path';

// Safe path resolution helper: ensures target stays inside root
function resolveUnderRoot(root, target) {
  const abs = path.resolve(root, target);
  const normRoot = path.resolve(root) + path.sep;
  // Validation is done by caller using provided McpError/ErrorCode
  return abs;
}

// deps must provide: { z, ResourceTemplate, McpError, ErrorCode }
export async function registerDemoCommands(server, deps) {
  const { z, ResourceTemplate, McpError, ErrorCode } = deps;
  // Demo data for list resource/tool
  const CATEGORIES = {
    fruits: ['apple', 'banana', 'orange', 'strawberry'],
    animals: ['cat', 'dog', 'elephant', 'giraffe'],
    colors: ['red', 'green', 'blue', 'yellow']
  };

  // Resource: demo list by category
  server.registerResource(
    'demo-list',
    new ResourceTemplate('demo-list://{category}', { list: undefined }),
    {
      title: 'Demo Lists',
      description: 'Lists of example items by category',
      mimeType: 'text/plain'
    },
    async (uri, { category }) => {
      const items = CATEGORIES[category] || [];
      const body = items.length ? items.join('\n') : `(no items for category: ${category})`;
      return { contents: [{ uri: uri.href, text: body }] };
    }
  );

  // Tool: list_things
  server.registerTool(
    'list_things',
    {
      title: 'List Things',
      description: 'List example items for a given category',
      inputSchema: { category: z.string().describe('One of: fruits, animals, colors') }
    },
    async ({ category }) => {
      const items = CATEGORIES[category] || [];
      const lines = [
        `Category: ${category}`,
        items.length ? `Items (${items.length}):` : 'No items found.',
        ...items.map((v, i) => `  ${i + 1}. ${v}`)
      ].join('\n');
      return {
        content: [
          { type: 'text', text: lines },
          {
            type: 'resource_link',
            uri: `demo-list://${category}`,
            name: `demo-list://${category}`,
            description: 'Linked demo list resource'
          }
        ]
      };
    }
  );

  // Tool: echo (simple demo)
  server.registerTool(
    'echo',
    {
      title: 'Echo',
      description: 'Echo back provided text',
      inputSchema: { text: z.string().describe('Text to echo') }
    },
    async ({ text }) => ({
      content: [{ type: 'text', text }]
    })
  );

  // Tool: create_directories
  server.registerTool(
    'create_directories',
    {
      title: 'Create Directories',
      description: 'Create a set of directories under a base path (relative to workspace root).',
      inputSchema: {
        basePath: z.string().default('./demo-out').describe('Base directory, relative to workspace root'),
        dirs: z.array(z.string()).nonempty().describe('Relative subdirectories to create')
      }
    },
    async ({ basePath = './demo-out', dirs }) => {
      const root = process.cwd();
      let baseAbs = resolveUnderRoot(root, basePath);
      if (!baseAbs.startsWith(path.resolve(root) + path.sep)) {
        throw new McpError(ErrorCode.InvalidParams, `Path escapes workspace root: ${basePath}`);
      }
      await fs.mkdir(baseAbs, { recursive: true });
      const created = [];
      for (const d of dirs) {
        const abs = resolveUnderRoot(baseAbs, d);
        if (!abs.startsWith(path.resolve(root) + path.sep)) {
          throw new McpError(ErrorCode.InvalidParams, `Path escapes workspace root: ${d}`);
        }
        await fs.mkdir(abs, { recursive: true });
        created.push(abs);
      }
      const rel = (p) => path.relative(root, p) || '.';
      return {
        content: [
          { type: 'text', text: `Created ${created.length} director${created.length === 1 ? 'y' : 'ies'} under ${rel(baseAbs)}:\n` + created.map(p => ` - ${rel(p)}`).join('\n') },
          ...created.map((p) => ({
            type: 'resource_link',
            uri: `file://${p}`,
            name: path.basename(p),
            description: 'Created directory'
          }))
        ]
      };
    }
  );
}
