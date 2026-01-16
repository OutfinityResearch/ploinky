export function showHelp(args = []) {
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
  add repo <name> [url] [branch] Add repository (basic/cloud/vibe/security/extra/demo)
  update repo <name>             Pull latest changes from remote for a repository
  start [staticAgent] [port]     Start agents from .ploinky/agents and launch Router
  shell <agentName>              Open interactive sh in container (attached TTY)
  cli <agentName> [args...]      Run manifest "cli" command (attached TTY)
  webconsole [shell] [--rotate]  Prepare WebTTY (alias). Prints URL; --rotate mints new token.
  webtty [shell] [--rotate]      Prepare WebTTY and print access URL. Optional shell.
  webchat [--rotate]             Show or rotate WebChat token and print access URL
  webmeet [moderatorAgent] [--rotate]  Show WebMeet token; --rotate mints a new one
  dashboard [--rotate]           Show or rotate Dashboard token and print access URL
  sso enable|disable|status  Configure SSO (Keycloak) middleware and secrets
  vars                           List all variable names (no values)
  var <VAR> <value>              Set a variable value
  echo <VAR|$VAR>                Print the resolved value of a variable
  expose <ENV_NAME> [<$VAR|value>] [agent]  Expose to agent environment
  list agents | repos            List agents (manifests) or predefined repos


▶ CLIENT OPERATIONS
  client tool <name>             Invoke any MCP tool exposed by agents via RoutingServer
  client list tools              Aggregate tools exposed by all agents
  client list resources          Aggregate resources exposed by all agents
  client status <agent>          One-line status (HTTP code, parsed)

  status | restart               Show state | restart enabled agents + Router
  stop | shutdown | clean        Stop containers | remove containers
  logs tail [router]             Follow router logs
  logs last <N>                  Show last N router log lines

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
                    syntax: 'add repo <name> [url] [branch] | add repo <name> [url] --branch <branch>',
                    description: 'Add an agent repository to your local environment',
                    params: {
                        '<name>': 'Repository name (cloud/vibe/security/extra for predefined, or custom name)',
                        '[url]': 'Git URL for custom repositories (optional for predefined repos)',
                        '[branch]': 'Git branch to clone (optional, defaults to repository default branch)'
                    },
                    examples: [
                        'add repo cloud           # Add predefined cloud repository',
                        'add repo myrepo https://github.com/user/repo.git  # Add custom repo',
                        'add repo basic profile_implementation  # Add basic repo at specific branch',
                        'add repo myrepo https://github.com/user/repo.git --branch feature  # Add with branch flag'
                    ],
                    notes: 'Predefined repos: cloud (AWS/Azure/GCP), vibe (social), security (auth/crypto), extra (utilities). Branch can be specified as a positional argument or with --branch flag.'
                },

            }
        },
        'var': {
            description: 'Set a workspace variable (stored in .ploinky/.secrets)',
            syntax: 'var <VAR> <value>',
            examples: [
                'var WEBTTY_TOKEN deadbeef  # Override token manually (prefer using webtty command)',
                'var API_KEY sk-123456'
            ],
            notes: "Use 'vars' to list variables. Tokens are usually managed via webtty/webchat/webmeet/dashboard commands."
        },
        'vars': {
            description: 'List workspace variables (from .ploinky/.secrets)',
            syntax: 'vars',
            examples: [ 'vars' ]
        },
        
        'update': {
            description: 'Update repositories',
            subcommands: {
                'repo': {
                    syntax: 'update repo <name>',
                    description: 'Run git pull --rebase --autostash inside the repository to fetch latest changes',
                    examples: [ 'update repo basic' ],
                    notes: 'Autostash preserves local changes; resolve conflicts if git reports them.'
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
                    notes: 'Attaches to a persistent container. REPLs stay attached until exit. Requires the agent manifest to define a "cli" entry.'
                }
            }
        },
        'webconsole': {
            description: 'Alias of webtty. Optionally configure shell for console sessions; show or rotate token.',
            syntax: 'webconsole [shell] [--rotate]',
            examples: [ 'webconsole', 'webconsole zsh', 'webconsole --rotate' ],
            notes: 'Allowed shells: sh, zsh, dash, ksh, csh, tcsh, fish, or absolute path. If a shell is provided, the router restarts (if configured). Without --rotate, prints existing URL (creates token if missing); with --rotate, mints a new token. Token stored in .ploinky/.secrets.'
        },
        'webtty': {
            description: 'Prepare WebTTY. Optionally configure shell for console sessions; show or rotate token.',
            syntax: 'webtty [shell] [--rotate]',
            examples: [ 'webtty', 'webtty sh', 'webtty --rotate' ],
            notes: 'Allowed shells: sh, zsh, dash, ksh, csh, tcsh, fish, or absolute path. If a shell is provided, the router restarts (if configured). Without --rotate, prints existing URL (creates token if missing); with --rotate, mints a new token. Token stored in .ploinky/.secrets.'
        },
        'webchat': {
            description: 'Display or rotate the WebChat token served at /webchat.',
            syntax: 'webchat [--rotate]',
            examples: [
                'webchat',
                'webchat --rotate'
            ],
            notes: 'Arguments for configuring agents or scripts are no longer supported. This command only manages the access token stored in .ploinky/.secrets.'
        },
        'webmeet': {
            description: 'Display or rotate the WebMeet token served at /webmeet, optionally storing a moderator agent.',
            syntax: 'webmeet [moderatorAgent] [--rotate]',
            examples: [ 'webmeet', 'webmeet ModeratorAgent', 'webmeet --rotate' ],
            notes: 'Writes the token to .ploinky/.secrets and prints an access URL. `echo $WEBMEET_TOKEN` to print it.'
        },
        'dashboard': {
            description: 'Display or rotate the Dashboard token used by /dashboard.',
            syntax: 'dashboard [--rotate]',
            examples: [ 'dashboard', 'dashboard --rotate' ],
            notes: 'Writes the token to .ploinky/.secrets and prints an access URL. `echo $WEBDASHBOARD_TOKEN` to print it.'
        },
        'sso': {
            description: 'Manage SSO middleware (OIDC providers such as Keycloak).',
            subcommands: {
                'enable': {
                    syntax: 'sso enable',
                    description: 'Enable SSO using environment variables (for example KEYCLOAK_URL, KEYCLOAK_REALM). Set them ahead of time with `ploinky var <NAME> <value>`.',
                    examples: [
                        'sso enable'
                    ],
                    notes: 'Once enabled, restart the router for changes to take effect.'
                },
                'disable': {
                    syntax: 'sso disable',
                    description: 'Disable SSO middleware and revert the router to legacy token-based auth. Does not delete stored secrets.',
                    examples: [ 'sso disable' ]
                },
                'status': {
                    syntax: 'sso status',
                    description: 'Show current SSO configuration, stored secrets, and detected ports.',
                    examples: [ 'sso status' ]
                }
            }
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
                    syntax: 'enable repo <name> [branch] | enable repo <name> --branch <branch>',
                    description: 'Enable a repository for agent listings (see list repos). If not already installed, clones the repository.',
                    params: {
                        '<name>': 'Repository name (predefined or custom)',
                        '[branch]': 'Git branch to clone (optional, only used when cloning)'
                    },
                    examples: [
                        'enable repo cloud',
                        'enable repo basic',
                        'enable repo basic profile_implementation  # Enable and clone at specific branch',
                        'enable repo demo --branch feature  # Enable with branch flag'
                    ],
                    notes: 'Branch is only used when the repository needs to be cloned. If the repo is already installed, the branch argument is ignored.'
                },
                'agent': {
                    syntax: 'enable agent <name|repo/name> [global|devel [repoName]] [as <alias>]',
                    description: 'Register agent in .ploinky/agents (for start/stop/shutdown). Modes: isolated (omitted) creates a subfolder <agentName>; global uses current project; devel uses a repo under .ploinky/repos. Use "as <alias>" to create an additional instance with its own container name.',
                    examples: [
                        'enable agent demo',
                        'enable agent demo global',
                        'enable agent demo devel simulator',
                        'enable agent demo as demo2'
                    ],
                    notes: 'Note: enable agent is optional. You can `enable repo` then `start <agent>`; it will use isolated mode (creates <agentName> subfolder). Aliases must be unique; commands like refresh/disable should target the alias when multiple containers exist.'
                }
            }
        },
        'expose': {
            description: 'Expose variables to an agent as environment variables',
            syntax: 'expose <ENV_NAME> [<$VAR|value>] [agentName] ',
            examples: [
                'expose API_KEY $MY_API_KEY MyAPI',
                'expose MODE prod MyAPI',
                'expose API_KEY $MY_API_KEY',
                'expose TEST_TOKEN demo'
            ],
            notes: 'If the value argument is omitted, the command defaults to using $<ENV_NAME>. When agentName is omitted, the static agent configured via start is used.'
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
        'refresh': {
            description: 'Refresh an agent by re-creating its container.',
            subcommands: {
                'agent': {
                    syntax: 'refresh agent <name>',
                    description: 'Stops, removes, and re-creates the agent\'s container. This is a destructive operation that ensures the agent starts from a clean state. This command only has an effect if the agent\'s container is currently running.',
                    examples: [ 'refresh agent MyAPI' ],
                    notes: 'This is useful for applying configuration changes that require a new container.'
                }
            }
        },
        'restart': {
            description: 'Restarts services. If an agent name is provided, it performs a non-destructive stop and start of that agent\'s container. If no agent name is provided, it restarts all agents and the router.',
            syntax: 'restart [agentName]',
            examples: [ 'restart', 'restart MyAPI' ],
            notes: 'The command only affects running containers when an agent name is specified. The general restart fails if start was not configured yet.'
        },
        'logs': {
            description: 'Inspect router logs',
            subcommands: {
                'tail': {
                    syntax: 'logs tail [router]',
                    description: 'Follow router logs',
                    examples: [ 'logs tail', 'logs tail router' ]
                },
                'last': {
                    syntax: 'logs last <N>',
                    description: 'Show last N router log lines',
                    examples: [ 'logs last 200', 'logs last 50' ]
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
                },
                'agent': {
                    syntax: 'disable <agentName>',
                    description: 'Remove an enabled agent from .ploinky/agents (container must be destroyed first)',
                    examples: [ 'disable demo', 'disable agent repoName/demo' ]
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
                        '<path>': 'URL path (e.g., /mcp)',
                        '<agent>': 'Agent name to deploy'
                    },
                    examples: [
                        'cloud deploy example.com /mcp MyAPI',
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
                    examples: ['cloud undeploy example.com /mcp']
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
                'list': {
                    syntax: 'client list <tools|resources>',
                    description: 'Aggregate metadata across all MCP agents managed by the router.',
                    examples: [
                        'client list tools',
                        'client list resources'
                    ],
                    notes: 'Use subcommands for detailed help: help client list tools | help client list resources',
                    subcommands: {
                        'tools': {
                            syntax: 'client list tools',
                            description: 'List every MCP tool exposed by registered agents. Output is formatted as a readable bullet list grouped by agent.',
                            notes: 'Each line displays the agent, tool name, optional title, and description. Warnings are shown if any agent fails to respond.'
                        },
                        'resources': {
                            syntax: 'client list resources',
                            description: 'List every MCP resource exposed by registered agents. Useful for discovering resource URIs such as health endpoints or document catalogs.',
                            notes: 'Output mirrors the tool listing format, including warnings when agents fail to respond.'
                        }
                    }
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
                'tool': {
                    syntax: 'client tool <toolName> [--agent <agent>] [--parameters <params> | -p <params>] [-key value...]',
                    description: 'Invokes an MCP tool by name. RouterServer routes the call to the agent that exposes the tool.',
                    params: {
                        '<toolName>': 'Tool to invoke. Must be unique across all agents unless --agent is provided.',
                        '[--agent <agent>]': 'Optional agent name to disambiguate when multiple agents expose the same tool.',
                        '[--parameters | -p]': 'Comma-separated key/value list parsed into a JSON object.',
                        '[-key value]': 'Additional individual parameters appended to the payload.'
                    },
                    examples: [
                        'client tool echo -text "hello"',
                        "client tool plan --agent demo -p steps[]=research,build,ship",
                        "client tool process -a data-agent -p 'config.level=high' -batch 1"
                    ],
                    notes: 'Flag-style parameters (e.g., --dry-run) are sent as boolean true. Use --agent when the same tool name exists on multiple agents.'
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

        if (subsubtopic && clientCmd.subcommands && clientCmd.subcommands[subsubtopic]) {
            const deepCmd = clientCmd.subcommands[subsubtopic];
            console.log(`\n╔═══ HELP: client ${subtopic} ${subsubtopic} ═══╗\n`);
            console.log(`SYNTAX:  ${deepCmd.syntax}`);
            console.log(`\nDESCRIPTION:\n  ${deepCmd.description}`);

            if (deepCmd.params) {
                console.log(`\nPARAMETERS:`);
                for (const [param, desc] of Object.entries(deepCmd.params)) {
                    console.log(`  ${param.padEnd(20)} ${desc}`);
                }
            }

            if (deepCmd.examples) {
                console.log(`\nEXAMPLES:`);
                deepCmd.examples.forEach(ex => console.log(`  ${ex}`));
            }

            if (deepCmd.notes) {
                console.log(`\nNOTES:\n  ${deepCmd.notes}`);
            }
            console.log();
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

        if (clientCmd.subcommands) {
            console.log(`\nSUBCOMMANDS:`);
            for (const [sub, data] of Object.entries(clientCmd.subcommands)) {
                console.log(`  ${sub.padEnd(10)} ${data.description || ''}`);
            }
            console.log(`\nFor more help: help client ${subtopic} <subcommand>`);
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
        console.log('Example: help client tool');
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
