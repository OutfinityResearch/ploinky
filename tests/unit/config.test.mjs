import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const configUrl = pathToFileURL(path.join(repoRoot, 'cli/services/config.js')).href;

test('config uses cwd as workspace root even when a parent has .ploinky', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-config-'));
    const child = path.join(root, 'child');

    try {
        fs.mkdirSync(path.join(root, '.ploinky'), { recursive: true });
        fs.mkdirSync(child, { recursive: true });

        const script = `
            import { WORKSPACE_ROOT, PLOINKY_DIR, initEnvironment } from ${JSON.stringify(configUrl)};
            initEnvironment();
            console.log(JSON.stringify({
                workspaceRoot: WORKSPACE_ROOT,
                ploinkyDir: PLOINKY_DIR,
                cwdPloinkyExists: (await import('node:fs')).existsSync('./.ploinky'),
            }));
        `;
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: child,
            encoding: 'utf8',
        });

        assert.equal(result.status, 0, result.stderr || result.stdout);

        const outputLine = result.stdout.trim().split('\n').at(-1);
        const output = JSON.parse(outputLine);
        const realChild = fs.realpathSync(child);

        assert.equal(output.workspaceRoot, realChild);
        assert.equal(output.ploinkyDir, path.join(realChild, '.ploinky'));
        assert.equal(output.cwdPloinkyExists, true);
        assert.equal(fs.existsSync(path.join(child, '.ploinky')), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
