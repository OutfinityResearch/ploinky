import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { copySkill } from '../../cli/services/skills.js';

test('copySkill merges into destination without deleting untracked files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ploinky-skills-'));
    try {
        const src = path.join(root, 'src-skill');
        const dest = path.join(root, 'dest-skill');

        fs.mkdirSync(src, { recursive: true });
        fs.writeFileSync(path.join(src, 'SKILL.md'), '# Current skill\n');
        fs.writeFileSync(path.join(src, 'tool.js'), 'export default 1;\n');

        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, 'local-override.js'), 'local file\n');

        copySkill(src, dest);

        // Files from source are copied / overwritten
        assert.equal(fs.existsSync(path.join(dest, 'SKILL.md')), true);
        assert.equal(fs.existsSync(path.join(dest, 'tool.js')), true);
        // Files only in destination are preserved (merge, not replace)
        assert.equal(fs.existsSync(path.join(dest, 'local-override.js')), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
