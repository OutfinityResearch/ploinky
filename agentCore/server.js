const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

// Configurable runtime
const CODE_DIR = process.env.CODE_DIR || '/code';
const RUN_TASK = process.env.RUN_TASK || '';
const PORT = parseInt(process.env.PORT || '7070', 10);

// Legacy FS-queue paths (kept for backward compatibility)
const AGENT_DIR = process.env.AGENT_DIR || '/agent';
const TASK_DIR = path.join(AGENT_DIR, '.ploinky', 'queue');

// Ensure queue directories exist on startup
async function init() {
    try {
        await fs.mkdir(path.join(TASK_DIR, 'tasks'), { recursive: true });
        await fs.mkdir(path.join(TASK_DIR, 'results'), { recursive: true });
        await fs.mkdir(path.join(TASK_DIR, 'errors'), { recursive: true });
        console.log(`[agentCore] Queue directories ensured at ${TASK_DIR}`);
    } catch (e) {
        console.error('[agentCore] FATAL: Could not create queue directories.', e);
        process.exit(1);
    }
}

async function waitForResult(taskId, timeout = 30000) {
    const startTime = Date.now();
    const resultPath = path.join(TASK_DIR, 'results', taskId);
    const errorPath = path.join(TASK_DIR, 'errors', taskId);

    while (Date.now() - startTime < timeout) {
        try {
            const data = await fs.readFile(resultPath, 'utf-8');
            await fs.unlink(resultPath);
            return { success: true, data: JSON.parse(data) };
        } catch (err) {
            if (err.code !== 'ENOENT') console.error('[agentCore] Error reading result file:', err);
        }

        try {
            const error = await fs.readFile(errorPath, 'utf-8');
            await fs.unlink(errorPath);
            return { success: false, error: JSON.parse(error) };
        } catch (err) {
            if (err.code !== 'ENOENT') console.error('[agentCore] Error reading error file:', err);
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error(`Task ${taskId} timed out.`);
}

function processTask(taskId, taskData) {
    const handlerPath = path.join(AGENT_DIR, 'handlers', `${taskData.command}.sh`);
    const resultPath = path.join(TASK_DIR, 'results', `${taskId}.intermediate`);
    const errorPath = path.join(TASK_DIR, 'errors', `${taskId}.intermediate`);

    const handler = spawn('sh', [handlerPath, ...taskData.params]);
    let output = '';
    let errorOutput = '';

    handler.stdout.on('data', (data) => { output += data.toString(); });
    handler.stderr.on('data', (data) => { errorOutput += data.toString(); });

    handler.on('close', async (code) => {
        if (code === 0) {
            await fs.writeFile(resultPath, output);
            await fs.rename(resultPath, path.join(TASK_DIR, 'results', taskId));
        } else {
            const error = { code, stderr: errorOutput, stdout: output };
            await fs.writeFile(errorPath, JSON.stringify(error));
            await fs.rename(errorPath, path.join(TASK_DIR, 'errors', taskId));
        }
    });
}

const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/task')) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const taskData = JSON.parse(body);
                // If RUN_TASK is provided, execute it (for testing or simple agents)
                if (RUN_TASK) {
                    const { spawn } = require('child_process');
                    // Build command with parameters
                    const fullCommand = taskData.params && taskData.params.length > 0 
                        ? `${RUN_TASK} ${taskData.params.map(p => `'${p}'`).join(' ')}`
                        : RUN_TASK;
                    
                    const sh = spawn('sh', ['-c', fullCommand], { 
                        cwd: CODE_DIR,
                        env: { ...process.env, TASK_COMMAND: taskData.command }
                    });
                    let stdout = '';
                    let stderr = '';
                    sh.stdout.on('data', d => { stdout += d.toString(); });
                    sh.stderr.on('data', d => { stderr += d.toString(); });
                    sh.on('close', (code) => {
                        if (code === 0) {
                            // Try to parse as JSON, fallback to string
                            let result;
                            try {
                                result = JSON.parse(stdout.trim());
                            } catch {
                                result = stdout.trim();
                            }
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, data: result }));
                        } else {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: true, message: stderr || stdout }));
                        }
                    });
                    return;
                } else {
                    // Legacy FS-queue fallback
                    const taskId = crypto.randomBytes(16).toString('hex') + '_' + Date.now();
                    const taskFilePath = path.join(TASK_DIR, 'tasks', taskId);
                    await fs.writeFile(taskFilePath, JSON.stringify({ id: taskId, ...taskData }));
                    processTask(taskId, taskData);
                    const result = await waitForResult(taskId);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                }

            } catch (e) {
                console.error('[agentCore] Error processing request:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: true, message: e.message }));
            }
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

init().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`[agentCore] HTTP server listening on port ${PORT}`);
    });
});
