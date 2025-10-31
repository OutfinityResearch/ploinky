const rawCommands = {
    add: ['repo'],
    refresh: ['agent'],
    enable: ['repo', 'agent'],
    disable: ['repo', 'agent'],
    shell: [],
    cli: [],
    start: [],
    restart: [],
    clean: [],
    status: [],
    shutdown: [],
    stop: [],
    destroy: [],
    list: ['agents', 'repos', 'routes'],
    webconsole: [],
    webtty: [],
    webmeet: [],
    client: ['methods', 'status', 'list', 'task', 'task-status'],
    logs: ['tail', 'last'],
    expose: [],
    var: [],
    vars: [],
    echo: [],
    help: []
};

for (const key of Object.keys(rawCommands)) {
    const value = rawCommands[key];
    if (Array.isArray(value)) {
        rawCommands[key] = Object.freeze([...value]);
    }
}

const COMMANDS = Object.freeze({ ...rawCommands });

function getCommandRegistry() {
    return COMMANDS;
}

function getCommandNames() {
    return Object.keys(COMMANDS);
}

function isKnownCommand(commandName) {
    if (!commandName) return false;
    return Object.prototype.hasOwnProperty.call(COMMANDS, commandName);
}

function listCommandPhrases() {
    const phrases = [];
    for (const [command, subcommands] of Object.entries(COMMANDS)) {
        phrases.push(command);
        if (Array.isArray(subcommands) && subcommands.length) {
            for (const sub of subcommands) {
                phrases.push(`${command} ${sub}`);
            }
        }
    }
    return phrases;
}

export {
    getCommandRegistry,
    getCommandNames,
    isKnownCommand,
    listCommandPhrases
};
