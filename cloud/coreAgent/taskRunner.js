#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

class TaskRunner {
    constructor() {
        this.taskId = process.argv[2];
        this.command = process.argv[3];
        this.params = process.argv.slice(4).map(p => {
            try {
                return JSON.parse(p);
            } catch {
                return p;
            }
        });
        
        this.taskDir = process.env.TASK_DIR || '/tasks';
        this.responseDir = process.env.RESPONSE_DIR || '/responses';
        this.agentDir = process.env.AGENT_DIR || '/code';
    }

    async run() {
        const startTime = Date.now();
        let response = {
            taskId: this.taskId,
            command: this.command,
            params: this.params,
            startTime: new Date(startTime).toISOString()
        };

        try {
            // Change to agent directory
            process.chdir(this.agentDir);
            
            // Try to load agent module
            const agent = await this.loadAgent();
            
            if (agent && typeof agent[this.command] === 'function') {
                // Execute the command
                const result = await agent[this.command](...this.params);
                
                response.success = true;
                response.result = result;
            } else {
                // Fallback to generic execution
                const result = await this.executeGeneric();
                
                response.success = true;
                response.result = result;
            }
            
        } catch (error) {
            response.success = false;
            response.error = {
                message: error.message,
                stack: error.stack,
                code: error.code || 'EXECUTION_ERROR'
            };
        }
        
        response.endTime = new Date().toISOString();
        response.duration = Date.now() - startTime;
        
        // Write response
        await this.writeResponse(response);
        
        // Exit with appropriate code
        process.exit(response.success ? 0 : 1);
    }

    async loadAgent() {
        const possiblePaths = [
            path.join(this.agentDir, 'index.js'),
            path.join(this.agentDir, 'agent.js'),
            path.join(this.agentDir, 'main.js'),
            path.join(this.agentDir, 'src', 'index.js')
        ];
        
        for (const agentPath of possiblePaths) {
            if (fs.existsSync(agentPath)) {
                try {
                    return require(agentPath);
                } catch (err) {
                    console.error(`Failed to load agent from ${agentPath}:`, err.message);
                }
            }
        }
        
        // Check for package.json main entry
        const packagePath = path.join(this.agentDir, 'package.json');
        if (fs.existsSync(packagePath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
                if (pkg.main) {
                    const mainPath = path.join(this.agentDir, pkg.main);
                    if (fs.existsSync(mainPath)) {
                        return require(mainPath);
                    }
                }
            } catch {}
        }
        
        return null;
    }

    async executeGeneric() {
        // Generic execution for simple scripts
        const { spawn } = require('child_process');
        
        return new Promise((resolve, reject) => {
            const scriptPath = path.join(this.agentDir, this.command);
            
            if (!fs.existsSync(scriptPath)) {
                reject(new Error(`Command ${this.command} not found`));
                return;
            }
            
            const proc = spawn(scriptPath, this.params, {
                cwd: this.agentDir,
                env: { ...process.env }
            });
            
            let output = '';
            let error = '';
            
            proc.stdout.on('data', data => output += data);
            proc.stderr.on('data', data => error += data);
            
            proc.on('close', code => {
                if (code === 0) {
                    resolve({ output, code });
                } else {
                    reject(new Error(error || output));
                }
            });
        });
    }

    async writeResponse(response) {
        const responseFile = path.join(this.responseDir, `${this.taskId}.json`);
        
        try {
            fs.mkdirSync(this.responseDir, { recursive: true });
            fs.writeFileSync(responseFile, JSON.stringify(response, null, 2));
        } catch (err) {
            console.error('Failed to write response:', err);
            // Try to output to stdout as fallback
            console.log(JSON.stringify(response));
        }
    }
}

// Run if executed directly
if (require.main === module) {
    const runner = new TaskRunner();
    runner.run().catch(err => {
        console.error('Task runner failed:', err);
        process.exit(1);
    });
}

module.exports = TaskRunner;