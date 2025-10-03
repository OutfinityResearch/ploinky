import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function findTestFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await findTestFiles(entryPath));
        } else if (entry.isFile() && entry.name.endsWith('.test.mjs') && entry.name !== 'runAll.test.mjs') {
            files.push(entryPath);
        }
    }

    return files;
}

function runTest(filePath, projectRoot) {
    const relativePath = path.relative(projectRoot, filePath);

    return new Promise(resolve => {
        console.log(`\nRunning ${relativePath}`);

        const child = spawn(process.execPath, [filePath], {
            cwd: projectRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
        });

        let stdout = '';
        let stderr = '';
        let closed = false;

        child.stdout.on('data', chunk => {
            stdout += chunk;
        });

        child.stderr.on('data', chunk => {
            stderr += chunk;
        });

        child.on('error', error => {
            if (closed) return;
            closed = true;
            console.error(`Failed to start ${relativePath}`);
            console.error(error);
            resolve({ filePath, relativePath, passed: false });
        });

        child.on('close', (code, signal) => {
            if (closed) return;
            closed = true;

            if (stdout) {
                process.stdout.write(stdout);
                if (!stdout.endsWith('\n')) {
                    process.stdout.write('\n');
                }
            }

            if (stderr) {
                process.stderr.write(stderr);
                if (!stderr.endsWith('\n')) {
                    process.stderr.write('\n');
                }
            }

            if (code === 0) {
                console.log(`PASS ${relativePath}`);
                resolve({ filePath, relativePath, passed: true });
            } else {
                const details = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
                console.error(`FAIL ${relativePath} (${details})`);
                resolve({ filePath, relativePath, passed: false });
            }
        });
    });
}

async function main() {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const testFiles = (await findTestFiles(__dirname)).sort((a, b) => a.localeCompare(b, 'en'));

    if (testFiles.length === 0) {
        console.log('No agent tests found.');
        return;
    }

    let passed = 0;
    let failed = 0;

    for (const filePath of testFiles) {
        const result = await runTest(filePath, projectRoot);
        if (result.passed) {
            passed += 1;
        } else {
            failed += 1;
        }
    }

    const total = testFiles.length;

    console.log('\nTest Report');
    console.log(`Total: ${total}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error('Unexpected error while running agent tests:');
    console.error(error);
    process.exitCode = 1;
});
