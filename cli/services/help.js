function showHelp(args = []) {
    // Parse help arguments
    const topic = args[0];
    const subtopic = args[1];
    const subsubtopic = args[2];
    
    // Detailed help for specific commands
    if (topic) {
        if (topic === 'cloud') { console.log('Cloud commands are not available in this build.'); return; }
        return showDetailedHelp(topic, subtopic, subsubtopic);
    }
    
    // Main help overview
    console.log(`
╔═══ PLOINKY ═══╗ Container Development & Cloud Platform

▶ LOCAL DEVELOPMENT
  add repo <name> [url]          Add repository (basic/cloud/vibe/security/extra/demo)
  start [staticAgent] [port]     Start agents from .ploinky/agents and launch Router
  shell <agentName>              Open interactive sh in container (attached TTY)
  cli <agentName> [args...]      Run manifest "cli" command (attached TTY)
  webconsole                         Regenerate WebTTY token (alias of webtty)
  webtty                             Regenerate WebTTY token and print access URL
  webchat                            Regenerate WebChat token and print access URL
  webmeet [moderatorAgent]           Regenerate WebMeet token (stores optional moderator)
  dashboard                          Regenerate Dashboard token and print access URL
  set <VAR> <$VAR|value>         Set a variable value or alias another variable
  set                            List all variable names (no values)
  echo <VAR|$VAR>                Print the resolved value of a variable
  expose <ENV_NAME> <$VAR|value> [agent]  Expose to agent environment
  list agents | repos            List agents (manifests) or predefined repos


▶ CLIENT OPERATIONS
  client task <agent>            Interactive: type command, then params; sends via RoutingServer
  client methods <agent>         List methods (if supported)
  client status <agent>          One-line status (HTTP code, parsed)

  status | restart               Show state | restart enabled agents + Router
  stop | shutdown | clean        Stop containers | remove containers
  logs tail <router|webtty>      Follow server logs (router or webtty)
  logs last <N> [router|webtty]  Show last N log lines (default router+webtty)

▶ FOR DETAILED HELP
  help <command>                 Show detailed help for a command
  Examples: help add | help cli

Config stored in .ploinky/ • Type 'help' for commands
╚═══════════════════════════════════════════════════════╝
`);
}

function showDetailedHelp(topic, subtopic, subsubtopic) {
    const helpContent = {
        // Local development commands
        'add': {
            description: 'Add repositories or environment variables',
            subcommands: {
                'repo': {
                    syntax: 'add repo <name> [url]',
                    description: 'Add an agent repository to your local environment',
                    params: {
                        '<name>': 'Repository name (cloud/vibe/security/extra for predefined, or custom name)',
                        '[url]': 'Git URL for custom repositories (optional for predefined repos)'
                    },
                    examples: [
                        'add repo cloud           # Add predefined cloud repository',
                        'add repo myrepo https://github.com/user/repo.git  # Add custom repo'
                    ],
                    notes: 'Predefined repos: cloud (AWS/Azure/GCP), vibe (social), security (auth/crypto), extra (utilities)'
                },
                
            }
        },
        'set': {
            description: 'Manage workspace variables (stored in .ploinky/.secrets)',
            syntax: 'set <VAR> <$OTHER|value>',
            examples: [
                'set WEBTTY_TOKEN deadbeef  # Override token manually (prefer using webtty command)',
                'set WEBCHAT_TOKEN cafebabe # Rotate chat token manually',
                'set API_KEY sk-123456',
                'set PROD_KEY $API_KEY',
                'set'
            ],
            notes: 'Running set with no args lists variables. Tokens usually managed via webtty/webchat/webmeet/dashboard commands.'
        },
        
        'new': {
            description: 'Create new agents',
            subcommands: {
                'agent': {
                    syntax: 'new agent <repo> <name> [image]',
                    description: 'Create a new agent in a repository',
                    params: {
                        '<repo>': 'Repository name where agent will be created',
                        '<name>': 'Agent name (must be unique)',
                        '[image]': 'Container image (default: node:18-alpine)'
                    },
                    examples: [
                        'new agent cloud MyAPI             # Node.js agent',
                        'new agent cloud PyBot python:3.11 # Python agent',
                        'new agent vibe WebApp nginx:alpine # Nginx agent'
                    ],
                    notes: 'Creates manifest.json and basic structure in .ploinky/repos/<repo>/<name>/'
                }
            }
        },
        
        'update': {
            description: 'Update agent manifest fields interactively',
            subcommands: {
                'agent': {
                    syntax: 'update agent <name>',
                    description: 'Modify container, install, update, cli, agent, about',
                    examples: [ 'update agent MyAPI' ]
                }
            }
        },
        
        
        'shell': {
            description: 'Interactive shell session',
            subcommands: {
                'default': {
                    syntax: 'shell <agentName>',
                    description: 'Open interactive POSIX sh (attached TTY) in the agent container',
                    params: { '<agentName>': 'Agent name' },
                    examples: [ 'shell MyAPI' ],
                    notes: 'Attaches to a persistent container; exit shell to return.'
                }
            }
        },
        'cli': {
            description: 'Run the agent CLI command interactively',
            subcommands: {
                'default': {
                    syntax: 'cli <agentName> [args...]',
                    description: 'Run manifest "cli" command interactively (attached TTY).',
                    params: { '<agentName>': 'Agent name', '[args...]': 'Arguments appended to the cli command' },
                    examples: [ 'cli MyAPI --help' ],
                    notes: 'Attaches to a persistent container. REPLs stay attached until exit.'
                }
            }
        },
        'webconsole': {
            description: 'Alias of webtty. Refreshes the WebTTY access token.',
            syntax: 'webconsole',
            examples: [ 'webconsole' ],
            notes: 'Outputs the new URL backed by the RoutingServer at /webtty.'
        },
        'webtty': {
            description: 'Refresh the WebTTY token used by /webtty.',
            syntax: 'webtty',
            examples: [ 'webtty' ],
            notes: 'Writes the token to .ploinky/.secrets and prints a one-time URL with the token parameter.'
        },
        'webchat': {
            description: 'Refresh the WebChat token used by /webchat.',
            syntax: 'webchat',
            examples: [ 'webchat' ],
            notes: 'Tokens are stored in .ploinky/.secrets (WEBCHAT_TOKEN).'
        },
        'webmeet': {
            description: 'Refresh the WebMeet token served at /webmeet.',
            syntax: 'webmeet [moderatorAgent]',
            examples: [ 'webmeet', 'webmeet ModeratorAgent' ],
            notes: 'Stores optional moderator agent in WEBMEET_AGENT and prints the invite URL with the new token.'
        },
        'dashboard': {
            description: 'Refresh the Dashboard token used by /dashboard.',
            syntax: 'dashboard',
            examples: [ 'dashboard' ],
            notes: 'Token stored as WEBDASHBOARD_TOKEN; no separate server is launched.'
        },
        'admin-mode': {
            description: 'Dashboard/Admin tools now live behind the router.',
            syntax: 'admin-mode',
            examples: [ 'admin-mode' ],
            notes: 'Use the /dashboard endpoint after running `dashboard` to refresh the token.'
        },
        
        
        'shutdown': {
            description: 'Stop and remove containers recorded in .ploinky/agents',
            syntax: 'shutdown',
            examples: ['shutdown'],
            notes: 'Removes containers for all enabled agents in this workspace.'
        },
        'destroy': {
            description: 'Stop and remove all Ploinky containers created in this workspace',
            syntax: 'destroy',
            examples: ['destroy'],
            notes: 'Irreversible for running containers; use with care.'
        },
        
        'enable': {
            description: 'Enable features for agents and repos',
            subcommands: {
                'repo': {
                    syntax: 'enable repo <name>',
                    description: 'Enable a repository for agent listings (see list repos)',
                    examples: [ 'enable repo cloud', 'enable repo basic' ]
                },
                'agent': {
                    syntax: 'enable agent <name>',
                    description: 'Register agent in .ploinky/agents (for start/stop/shutdown)',
                    examples: [ 'enable agent MyAPI', 'enable agent MyWorker' ]
                }
            }
        },
        'expose': {
            description: 'Expose variables to an agent as environment variables',
            syntax: 'expose <ENV_NAME> <$VAR|value> [agentName] ',
            examples: [ 'expose API_KEY $MY_API_KEY MyAPI', 'expose MODE prod MyAPI', 'expose API_KEY $MY_API_KEY' ],
            notes: 'First arg is the environment variable name inside the container. If agentName omitted, uses static agent configured via start.'
        },
        'echo': {
            description: 'Print the resolved value of a variable',
            syntax: 'echo <VAR|$VAR> ',
            examples: [ 'echo API_KEY', 'echo $PROD_KEY' ],
            notes: 'Resolves chained aliases like VAR=$OTHER.'
        },
        'start': {
            description: 'Start enabled agents and the local Router',
            syntax: 'start [staticAgent] [port] ',
            examples: [ 'start MyStaticAgent 8080', 'start' ],
            notes: 'Reads manifest of static agent: applies repos{} (clone+enable) and enable[] (enable agents). First run needs agent and port.'
        },
        'status': {
            description: 'Show enabled agents and router configuration',
            syntax: 'status',
            examples: [ 'status' ],
            notes: 'Reads .ploinky/agents and prints container, binds, ports, and static config.'
        },
        'restart': {
            description: 'Stop and then start all enabled agents and Router',
            syntax: 'restart',
            examples: [ 'restart' ],
            notes: 'Fails if start was not configured yet (no staticAgent/port).'
        },
        'logs': {
            description: 'Inspect server logs (RoutingServer and WebTTY)',
            subcommands: {
                'tail': {
                    syntax: 'logs tail <router|webtty>',
                    description: 'Follow logs for router or webtty',
                    examples: [ 'logs tail router', 'logs tail webtty' ]
                },
                'last': {
                    syntax: 'logs last <N> [router|webtty]',
                    description: 'Show last N log lines. If no type, shows both router and webtty.',
                    examples: [ 'logs last 200', 'logs last 100 webtty' ]
                }
            }
        },
        'disable': {
            description: 'Disable features',
            subcommands: {
                'repo': {
                    syntax: 'disable repo <name>',
                    description: 'Disable a repository from agent listings',
                    examples: [ 'disable repo cloud' ]
                }
            }
        },
        
        'list': {
            description: 'List resources (agents, repos, current workspace containers, routes)',
            subcommands: {
                'agents': {
                    syntax: 'list agents',
                    description: 'List all available agents across all repositories',
                    examples: ['list agents']
                },
                'repos': {
                    syntax: 'list repos',
                    description: 'List available repositories with URLs; mark installed and enabled. Use enable repo <name> to include in listings.',
                    examples: ['list repos']
                },
                'routes': {
                    syntax: 'list routes',
                    description: 'List configured routes from .ploinky/routing.json',
                    examples: ['list routes']
                }
            }
        },
        'delete': {
            description: 'Delete things',
            subcommands: {
                'route': {
                    syntax: 'delete route <name>',
                    description: 'Delete a route for an agent from the RoutingServer configuration',
                    examples: ['delete route MyAPI']
                }
            }
        },
        
        // Cloud commands
        'cloud': {
            description: 'Cloud platform operations',
            subcommands: {
                'connect': {
                    syntax: 'cloud connect [url]',
                    description: 'Connect to a Ploinky Cloud server',
                    params: {
                        '[url]': 'Server URL (default: localhost:8000)'
                    },
                    examples: [
                        'cloud connect                    # Connect to localhost:8000',
                        'cloud connect api.example.com    # Connect to remote server',
                        'cloud connect 192.168.1.100:8080 # Connect with custom port'
                    ],
                    notes: 'Connection info saved in .ploinky/cloud.json'
                },
                
                'login': {
                    syntax: 'cloud login <API_KEY>',
                    description: 'Login to connected cloud server using API Key',
                    params: {
                        '<API_KEY>': 'Admin API Key (generated with cloud init)'
                    },
                    examples: [
                        'cloud login ABCDEF123456',
                        'cloud login 7b9d... (hex key)'
                    ],
                    notes: 'Use cloud init first to generate an API Key'
                },
                'init': {
                    syntax: 'cloud init',
                    description: 'Initialize server and generate Admin API Key',
                    examples: ['cloud init'],
                    notes: 'Stores URL and API Key in ~/.plionky/remotes.json'
                },
                'show': {
                    syntax: 'cloud show',
                    description: 'Show current cloud URL and API Key',
                    examples: ['cloud show']
                },
                
                'logout': {
                    syntax: 'cloud logout',
                    description: 'Logout from cloud server',
                    examples: ['cloud logout']
                },
                
                'status': {
                    syntax: 'cloud status',
                    description: 'Show connection and authentication status',
                    examples: ['cloud status'],
                    notes: 'Shows server URL, login status, and deployment info'
                },
                
                'host': {
                    syntax: 'cloud host <action>',
                    description: 'Manage hosts and domains',
                    subcommands: {
                        'add': {
                            syntax: 'cloud host add <hostname>',
                            description: 'Register a new host or domain',
                            examples: [
                                'cloud host add example.com',
                                'cloud host add api.myapp.io'
                            ]
                        },
                        'remove': {
                            syntax: 'cloud host remove <hostname>',
                            description: 'Remove a registered host',
                            examples: ['cloud host remove example.com']
                        },
                        'list': {
                            syntax: 'cloud host list',
                            description: 'List all registered hosts',
                            examples: ['cloud host list']
                        }
                    }
                },
                
                'repo': {
                    syntax: 'cloud repo <action>',
                    description: 'Manage cloud repositories',
                    subcommands: {
                        'add': {
                            syntax: 'cloud repo add <name> <url>',
                            description: 'Add repository to cloud',
                            examples: [
                                'cloud repo add MyAgents https://github.com/user/agents.git'
                            ]
                        },
                        'remove': {
                            syntax: 'cloud repo remove <name>',
                            description: 'Remove repository from cloud',
                            examples: ['cloud repo remove MyAgents']
                        },
                        'list': {
                            syntax: 'cloud repo list',
                            description: 'List cloud repositories',
                            examples: ['cloud repo list']
                        }
                    }
                },
                'destroy': {
                    syntax: 'cloud destroy <agents|server-agents>',
                    description: 'Stop and remove agent containers',
                    examples: [
                        'cloud destroy agents            # Local .ploinky/agents',
                        'cloud destroy server-agents     # On connected server'
                    ]
                },

                'logs': {
                    syntax: 'cloud logs [lines|list|download <date>]',
                    description: 'Inspect server logs',
                    examples: [
                        'cloud logs 200',
                        'cloud logs list',
                        'cloud logs download 2025-09-01'
                    ]
                },

                'settings': {
                    syntax: 'cloud settings <show|set>',
                    description: 'Show or update server settings',
                    examples: [
                        'cloud settings show',
                        'cloud settings set logLevel debug',
                        'cloud settings set metricsRetention 365'
                    ]
                },
                
                'agent': {
                    syntax: 'cloud agent <action>',
                    description: 'Manage deployed agents',
                    subcommands: {
                        'list': {
                            syntax: 'cloud agent list',
                            description: 'List available cloud agents',
                            examples: ['cloud agent list']
                        },
                        'info': {
                            syntax: 'cloud agent info <name>',
                            description: 'Show agent details',
                            examples: ['cloud agent info MyAPI']
                        },
                        'start': {
                            syntax: 'cloud agent start <name>',
                            description: 'Start a deployed agent',
                            examples: ['cloud agent start MyAPI']
                        },
                        'stop': {
                            syntax: 'cloud agent stop <name>',
                            description: 'Stop a running agent',
                            examples: ['cloud agent stop MyAPI']
                        },
                        'restart': {
                            syntax: 'cloud agent restart <name>',
                            description: 'Restart an agent',
                            examples: ['cloud agent restart MyAPI']
                        }
                    }
                },
                
                'deploy': {
                    syntax: 'cloud deploy <host> <path> <agent>',
                    description: 'Deploy agent to URL path',
                    params: {
                        '<host>': 'Target hostname',
                        '<path>': 'URL path (e.g., /api)',
                        '<agent>': 'Agent name to deploy'
                    },
                    examples: [
                        'cloud deploy example.com /api MyAPI',
                        'cloud deploy localhost /admin AdminPanel'
                    ],
                    notes: 'Agent will be accessible at http://host/path'
                },
                
                'undeploy': {
                    syntax: 'cloud undeploy <host> <path>',
                    description: 'Remove deployment',
                    params: {
                        '<host>': 'Hostname',
                        '<path>': 'URL path'
                    },
                    examples: ['cloud undeploy example.com /api']
                },
                
                'deployments': {
                    syntax: 'cloud deployments',
                    description: 'List all active deployments',
                    examples: ['cloud deployments']
                },
                
                'admin': {
                    syntax: 'cloud admin <action>',
                    description: 'Admin user management',
                    subcommands: {
                        'add': {
                            syntax: 'cloud admin add <username>',
                            description: 'Create new admin user',
                            examples: ['cloud admin add john']
                        },
                        'password': {
                            syntax: 'cloud admin password [username]',
                            description: 'Change admin password',
                            examples: [
                                'cloud admin password       # Change your password',
                                'cloud admin password john  # Change john\'s password'
                            ]
                        }
                    }
                }
            }
        },
        
        'client': {
            description: 'Client operations for interacting with deployed agents',
            subcommands: {
                // 'call' removed; prefer interacting via RoutingServer endpoints
                'call_removed': {
                    syntax: '(removed)',
                    description: 'Call a method on an agent with parameters',
                    params: {
                        '<agent>': 'Agent name',
                        '<method>': 'Method name to call',
                        '[params]': 'Optional parameters for the method'
                    },
                    examples: [
                        'client call MyAPI processData input.json output.json',
                        'client call DataProcessor analyze "SELECT * FROM users"'
                    ]
                },
                'methods': {
                    syntax: 'client methods <agent>',
                    description: 'List available methods for an agent (if implemented by agent)' ,
                    params: {
                        '<agent>': 'Agent name'
                    },
                    examples: [
                        'client methods MyAPI',
                        'client methods DataProcessor'
                    ]
                },
                'status': {
                    syntax: 'client status <agent>',
                    description: 'Get runtime status of an agent (if implemented by agent)' ,
                    params: {
                        '<agent>': 'Agent name'
                    },
                    examples: [
                        'client status MyAPI'
                    ],
                    notes: 'Shows state, uptime, resource usage, and recent activity'
                },
                'list': {
                    syntax: 'client list',
                    description: 'List all available agents',
                    examples: [
                        'client list'
                    ]
                },
                'task': {
                    syntax: 'client task <agent> <task-description>',
                    description: 'Interactive: asks for command type and parameters (multiline until "end"), then POSTs JSON to /apis/<agent> on RoutingServer' ,
                    params: {
                        '<agent>': 'Agent name'
                    },
                    examples: [
                        'client task MyAPI'
                    ]
                },
                'task-status': {
                    syntax: 'client task-status <agent> <task-id>',
                    description: 'Check the status of a submitted task',
                    params: {
                        '<agent>': 'Agent name',
                        '<task-id>': 'Task ID returned when task was submitted'
                    },
                    examples: [
                        'client task-status MyAPI task-123'
                    ]
                }
            }
        }
    };
    
    // Display help based on requested topic (removed - not needed since we're already inside showDetailedHelp)
    
    // Handle cloud subcommands specially
    if (topic === 'cloud' && subtopic) {
        const cloudCmd = helpContent.cloud.subcommands[subtopic];
        if (!cloudCmd) {
            console.log(`Unknown cloud command: ${subtopic}`);
            console.log('Available cloud commands: ' + Object.keys(helpContent.cloud.subcommands).join(', '));
            return;
        }
        
        // Check for sub-subcommands
        if (subsubtopic && cloudCmd.subcommands && cloudCmd.subcommands[subsubtopic]) {
            const subCmd = cloudCmd.subcommands[subsubtopic];
            console.log(`\n╔═══ HELP: cloud ${subtopic} ${subsubtopic} ═══╗\n`);
            console.log(`SYNTAX:  ${subCmd.syntax}`);
            console.log(`\nDESCRIPTION:\n  ${subCmd.description}`);
            if (subCmd.examples) {
                console.log(`\nEXAMPLES:`);
                subCmd.examples.forEach(ex => console.log(`  ${ex}`));
            }
            console.log();
            return;
        }
        
        // Show cloud subcommand help
        console.log(`\n╔═══ HELP: cloud ${subtopic} ═══╗\n`);
        console.log(`SYNTAX:  ${cloudCmd.syntax}`);
        console.log(`\nDESCRIPTION:\n  ${cloudCmd.description}`);
        
        if (cloudCmd.params) {
            console.log(`\nPARAMETERS:`);
            for (const [param, desc] of Object.entries(cloudCmd.params)) {
                console.log(`  ${param.padEnd(12)} ${desc}`);
            }
        }
        
        if (cloudCmd.subcommands) {
            console.log(`\nSUBCOMMANDS:`);
            for (const [sub, data] of Object.entries(cloudCmd.subcommands)) {
                console.log(`  ${sub.padEnd(10)} ${data.description}`);
            }
            console.log(`\nFor more help: help cloud ${subtopic} <subcommand>`);
        }
        
        if (cloudCmd.examples) {
            console.log(`\nEXAMPLES:`);
            cloudCmd.examples.forEach(ex => console.log(`  ${ex}`));
        }
        
        if (cloudCmd.notes) {
            console.log(`\nNOTES:\n  ${cloudCmd.notes}`);
        }
        console.log();
        return;
    }
    
    // Show cloud overview
    if (topic === 'cloud' && !subtopic) {
        console.log(`\n╔═══ HELP: cloud ═══╗\n`);
        console.log('Cloud platform operations for managing remote deployments\n');
        console.log('SUBCOMMANDS:');
        for (const [cmd, data] of Object.entries(helpContent.cloud.subcommands)) {
            console.log(`  ${cmd.padEnd(12)} ${data.description}`);
        }
        console.log('\nFor detailed help: help cloud <subcommand>');
        console.log('Example: help cloud deploy');
        console.log();
        return;
    }
    
    // Handle client subcommands specially
    if (topic === 'client' && subtopic) {
        const clientCmd = helpContent.client.subcommands[subtopic];
        if (!clientCmd) {
            console.log(`Unknown client command: ${subtopic}`);
            console.log('Available client commands: ' + Object.keys(helpContent.client.subcommands).join(', '));
            return;
        }
        
        console.log(`\n╔═══ HELP: client ${subtopic} ═══╗\n`);
        console.log(`SYNTAX:  ${clientCmd.syntax}`);
        console.log(`\nDESCRIPTION:\n  ${clientCmd.description}`);
        
        if (clientCmd.params) {
            console.log(`\nPARAMETERS:`);
            for (const [param, desc] of Object.entries(clientCmd.params)) {
                console.log(`  ${param.padEnd(20)} ${desc}`);
            }
        }
        
        if (clientCmd.examples) {
            console.log(`\nEXAMPLES:`);
            clientCmd.examples.forEach(ex => console.log(`  ${ex}`));
        }
        
        if (clientCmd.notes) {
            console.log(`\nNOTES:\n  ${clientCmd.notes}`);
        }
        console.log();
        return;
    }
    
    // Show client overview
    if (topic === 'client' && !subtopic) {
        console.log(`\n╔═══ HELP: client ═══╗\n`);
        console.log('Client operations for interacting with deployed agents\n');
        console.log('SUBCOMMANDS:');
        for (const [cmd, data] of Object.entries(helpContent.client.subcommands)) {
            console.log(`  ${cmd.padEnd(12)} ${data.description}`);
        }
        console.log('\nFor detailed help: help client <subcommand>');
        console.log('Example: help client call');
        console.log();
        return;
    }
    
    // Handle other top-level commands
    const cmd = helpContent[topic];
    if (!cmd) {
        console.log(`Unknown command: ${topic}`);
        console.log('Type "help" for available commands');
        return;
    }
    
    // Check for subcommands
    if (subtopic && cmd.subcommands && cmd.subcommands[subtopic]) {
        const subCmd = cmd.subcommands[subtopic];
        console.log(`\n╔═══ HELP: ${topic} ${subtopic} ═══╗\n`);
        console.log(`SYNTAX:  ${subCmd.syntax}`);
        console.log(`\nDESCRIPTION:\n  ${subCmd.description}`);
        
        if (subCmd.params) {
            console.log(`\nPARAMETERS:`);
            for (const [param, desc] of Object.entries(subCmd.params)) {
                console.log(`  ${param.padEnd(12)} ${desc}`);
            }
        }
        
        if (subCmd.examples) {
            console.log(`\nEXAMPLES:`);
            subCmd.examples.forEach(ex => console.log(`  ${ex}`));
        }
        
        if (subCmd.notes) {
            console.log(`\nNOTES:\n  ${subCmd.notes}`);
        }
        console.log();
        return;
    }
    
    // Show command help
    console.log(`\n╔═══ HELP: ${topic} ═══╗\n`);
    
    if (cmd.syntax) {
        console.log(`SYNTAX:  ${cmd.syntax}`);
    }
    
    console.log(`\nDESCRIPTION:\n  ${cmd.description}`);
    
    if (cmd.params) {
        console.log(`\nPARAMETERS:`);
        for (const [param, desc] of Object.entries(cmd.params)) {
            console.log(`  ${param.padEnd(20)} ${desc}`);
        }
    }
    
    if (cmd.subcommands) {
        console.log(`\nSUBCOMMANDS:`);
        for (const [sub, data] of Object.entries(cmd.subcommands)) {
            console.log(`  ${sub.padEnd(10)} ${data.description}`);
        }
        console.log(`\nFor more help: help ${topic} <subcommand>`);
    }
    
    if (cmd.examples) {
        console.log(`\nEXAMPLES:`);
        cmd.examples.forEach(ex => console.log(`  ${ex}`));
    }
    
    if (cmd.notes) {
        console.log(`\nNOTES:\n  ${cmd.notes}`);
    }
    
    console.log();
}

module.exports = {
    showHelp
};
