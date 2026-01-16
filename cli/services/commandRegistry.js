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
    '/settings': [],
    settings: [],
    client: ['methods', 'status', 'list', 'task', 'task-status'],
    logs: ['tail', 'last'],
    expose: [],
    var: [],
    vars: [],
    echo: [],
    help: [],
    profile: ['list', 'validate', 'show']
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

function isKnownCommand(commandName) {
    if (!commandName) return false;
    return Object.prototype.hasOwnProperty.call(COMMANDS, commandName);
}

export {
    getCommandRegistry,
    isKnownCommand
};
