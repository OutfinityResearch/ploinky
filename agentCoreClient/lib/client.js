const http = require('http');

/**
 * Ploinky agentCoreClient (Producer via HTTP)
 * 
 * This class is responsible for sending tasks to a running agentCore server.
 */
class AgentCoreClient {
    /**
     * Executes a task by sending it to the agent's HTTP server.
     * @param {string} host The host of the agent server (e.g., 'localhost').
     * @param {number} port The port the agent server is listening on.
     * @param {string} command The command for the agent to execute.
     * @param {Array<string>} params An array of parameters for the command.
     * @returns {Promise<any>} The result from the agent.
     */
    runTask(host, port, command, params = []) {
        return new Promise((resolve, reject) => {
            const taskData = JSON.stringify({ command, params });

            const options = {
                hostname: host,
                port: port,
                path: '/task',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(taskData),
                },
            };

            const req = http.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode >= 400) {
                            reject(new Error(`HTTP Error ${res.statusCode}: ${body}`));
                        } else {
                            resolve(JSON.parse(body));
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            req.on('error', (e) => {
                reject(e);
            });

            req.write(taskData);
            req.end();
        });
    }
}

module.exports = AgentCoreClient;