# cli/server/utils/ttyFactories.js - TTY Factories

## Overview

Initializes and manages PTY (pseudo-terminal) factories for WebTTY and WebChat services. Provides lazy loading of node-pty, configurable factories with caching, and support for both local and Docker-based terminal sessions.

## Source File

`cli/server/utils/ttyFactories.js`

## Dependencies

```javascript
import { resolveVarValue } from '../../services/secretVars.js';
import { configCache } from '../utils/configCache.js';
import { logBootEvent } from '../utils/logger.js';
import { getAppName } from '../authHandlers.js';
import { resolveWebchatCommands, resolveWebchatCommandsForAgent } from '../webchat/commandResolver.js';
```

## Internal Functions

### loadPtyLibrary()

**Purpose**: Loads node-pty library (optional dependency)

**Returns**: (Promise<Object|null>) PTY module or null if unavailable

**Implementation**:
```javascript
async function loadPtyLibrary() {
    try {
        const ptyModule = await import('node-pty');
        return ptyModule.default || ptyModule;
    } catch (error) {
        const reason = error?.message || error;
        console.warn('node-pty not found, TTY features will be disabled.');
        if (reason) {
            console.warn(`node-pty load failure: ${reason}`);
        }
        logBootEvent('pty_unavailable', { reason: reason || 'unknown' });
        return null;
    }
}
```

### loadTTYModule(primaryRelative, legacyRelative)

**Purpose**: Loads TTY module with fallback support

**Parameters**:
- `primaryRelative` (string): Primary module path
- `legacyRelative` (string): Legacy fallback path

**Returns**: (Promise<Object>) Loaded module

**Implementation**:
```javascript
async function loadTTYModule(primaryRelative, legacyRelative) {
    const currentUrl = import.meta.url;
    try {
        const mod = await import(new URL(primaryRelative, currentUrl));
        return mod.default || mod;
    } catch (primaryError) {
        if (legacyRelative) {
            try {
                const legacy = await import(new URL(legacyRelative, currentUrl));
                return legacy.default || legacy;
            } catch (_) {}
        }
        throw primaryError;
    }
}
```

### loadTTYModules(pty)

**Purpose**: Loads all TTY modules for WebTTY and WebChat

**Parameters**:
- `pty` (Object): PTY library

**Returns**: (Promise<Object>) `{ webttyTTYModule, webchatTTYModule }`

**Implementation**:
```javascript
async function loadTTYModules(pty) {
    let webttyTTYModule = {};
    let webchatTTYModule = {};

    if (pty) {
        try {
            webttyTTYModule = await loadTTYModule('../webtty/tty.js', '../webtty/webtty-ttyFactory.js');
        } catch (_) {
            console.warn('WebTTY TTY factory unavailable.');
        }

        try {
            webchatTTYModule = await loadTTYModule('../webchat/tty.js', '../webchat/webchat-ttyFactory.js');
        } catch (_) {
            console.warn('WebChat TTY factory unavailable.');
        }
    }

    return { webttyTTYModule, webchatTTYModule };
}
```

### buildLocalFactory(createFactoryFn, pty, defaults)

**Purpose**: Builds a local TTY factory with defaults

**Parameters**:
- `createFactoryFn` (Function): Factory creation function
- `pty` (Object): PTY library
- `defaults` (Object): Default options

**Returns**: (Object|null) Factory or null

**Implementation**:
```javascript
function buildLocalFactory(createFactoryFn, pty, defaults = {}) {
    if (!pty || !createFactoryFn) return null;
    return createFactoryFn({ ptyLib: pty, workdir: process.cwd(), ...defaults });
}
```

### createWebttyFactoryConfig(pty, webttyTTYModule)

**Purpose**: Creates cached WebTTY factory configuration

**Parameters**:
- `pty` (Object): PTY library
- `webttyTTYModule` (Object): WebTTY TTY module

**Returns**: (Function) Factory getter function

**Configuration Sources**:
- `WEBTTY_SHELL` - Shell command
- `WEBTTY_COMMAND` - Custom command
- `WEBTTY_CONTAINER` - Container name

**Implementation**:
```javascript
function createWebttyFactoryConfig(pty, webttyTTYModule) {
    const { createTTYFactory, createLocalTTYFactory } = webttyTTYModule;

    return () => configCache.getOrCreate(
        'webtty',
        () => ({
            shell: resolveVarValue('WEBTTY_SHELL'),
            command: process.env.WEBTTY_COMMAND || '',
            container: process.env.WEBTTY_CONTAINER || 'ploinky_interactive'
        }),
        (config) => {
            if (!pty) {
                logBootEvent('webtty_factory_disabled', { reason: 'pty_unavailable' });
                return { factory: null, label: '-', runtime: 'disabled' };
            }

            // Try local factory first
            if (createLocalTTYFactory) {
                const command = config.shell || config.command;
                const factory = buildLocalFactory(createLocalTTYFactory, pty, { command });
                if (factory) {
                    logBootEvent('webtty_local_process_factory_ready', { command: command || null });
                }
                return {
                    factory,
                    label: command ? command : 'local shell',
                    runtime: 'local'
                };
            }

            // Fall back to container factory
            if (createTTYFactory) {
                const factory = createTTYFactory({
                    ptyLib: pty,
                    runtime: 'docker',
                    containerName: config.container
                });
                logBootEvent('webtty_container_factory_ready', { containerName: config.container });
                return {
                    factory,
                    label: config.container,
                    runtime: 'docker'
                };
            }

            logBootEvent('webtty_factory_disabled', { reason: 'no_factory_available' });
            return { factory: null, label: '-', runtime: 'disabled' };
        }
    );
}
```

### createWebchatFactoryConfig(pty, webchatTTYModule, resolvedWebchatCommands)

**Purpose**: Creates cached WebChat factory configuration

**Parameters**:
- `pty` (Object): PTY library
- `webchatTTYModule` (Object): WebChat TTY module
- `resolvedWebchatCommands` (Object): Resolved webchat commands

**Returns**: (Function) Factory getter function with optional commands override

**Implementation**:
```javascript
function createWebchatFactoryConfig(pty, webchatTTYModule, resolvedWebchatCommands) {
    const { createTTYFactory, createLocalTTYFactory } = webchatTTYModule;

    const buildCacheKey = (commands) =>
        commands?.cacheKey || (commands?.agentName ? `webchat:${commands.agentName}` : 'webchat');

    const buildConfig = (commands) => ({
        hostCommand: commands?.host || '',
        containerCommand: commands?.container || '',
        source: commands?.source || 'unset',
        agentName: commands?.agentName || ''
    });

    const buildFactoryResult = (config) => {
        if (!pty) {
            return { factory: null, label: '-', runtime: 'disabled', agentName: config.agentName || '' };
        }

        if (createLocalTTYFactory) {
            const command = config.hostCommand;
            const factory = buildLocalFactory(createLocalTTYFactory, pty, { command });
            return {
                factory,
                label: command ? command : 'local shell',
                runtime: 'local',
                agentName: config.agentName || ''
            };
        }

        if (createTTYFactory) {
            const containerLabel = config.agentName || 'webchat_agent';
            const factory = createTTYFactory({
                ptyLib: pty,
                runtime: 'docker',
                containerName: containerLabel,
                entry: config.containerCommand
            });
            return {
                factory,
                label: containerLabel,
                runtime: 'docker',
                agentName: config.agentName || ''
            };
        }

        return { factory: null, label: '-', runtime: 'disabled', agentName: config.agentName || '' };
    };

    return (commandsOverride = null) => {
        const commands = commandsOverride || resolvedWebchatCommands;
        if (!commands) {
            return { factory: null, label: '-', runtime: 'disabled', agentName: '' };
        }
        return configCache.getOrCreate(
            buildCacheKey(commands),
            () => buildConfig(commands),
            buildFactoryResult
        );
    };
}
```

## Public API

### initializeTTYFactories()

**Purpose**: Initializes TTY factories and returns configuration

**Returns**: (Promise<Object>) Factory configuration

**Return Structure**:
```javascript
{
    pty: Object|null,           // PTY library
    getWebttyFactory: Function, // WebTTY factory getter
    getWebchatFactory: Function // WebChat factory getter
}
```

**Implementation**:
```javascript
async function initializeTTYFactories() {
    // Load PTY library
    const pty = await loadPtyLibrary();

    // Load TTY modules
    const { webttyTTYModule, webchatTTYModule } = await loadTTYModules(pty);

    // Resolve webchat commands
    const resolvedWebchatCommands = resolveWebchatCommands();
    if (resolvedWebchatCommands.source === 'manifest' && resolvedWebchatCommands.agentName) {
        logBootEvent('webchat_manifest_cli_fallback', { agent: resolvedWebchatCommands.agentName });
    }

    // Create factory configurations
    const getWebttyFactory = createWebttyFactoryConfig(pty, webttyTTYModule);
    const getWebchatFactory = createWebchatFactoryConfig(pty, webchatTTYModule, resolvedWebchatCommands);

    return { pty, getWebttyFactory, getWebchatFactory };
}
```

### createServiceConfig(getWebttyFactory, getWebchatFactory)

**Purpose**: Creates service configuration object with lazy evaluation

**Parameters**:
- `getWebttyFactory` (Function): WebTTY factory getter
- `getWebchatFactory` (Function): WebChat factory getter

**Returns**: (Object) Service configuration

**Return Structure**:
```javascript
{
    webtty: {
        ttyFactory: Function|null,
        agentName: string,
        containerName: string,
        runtime: string
    },
    webchat: {
        ttyFactory: Function|null,
        agentName: string,
        containerName: string,
        runtime: string,
        getFactoryForCommands: Function
    },
    dashboard: { agentName: 'Dashboard', containerName: '-', runtime: 'local' },
    webmeet: { agentName: 'WebMeet', containerName: '-', runtime: 'local' },
    status: { agentName: 'Status', containerName: '-', runtime: 'local' }
}
```

**Implementation**:
```javascript
function createServiceConfig(getWebttyFactory, getWebchatFactory) {
    const appName = getAppName();

    const wrapWebchatFactory = (factoryResult) => {
        const base = {
            ttyFactory: factoryResult.factory,
            agentName: factoryResult.agentName || appName || 'ChatAgent',
            containerName: factoryResult.label,
            runtime: factoryResult.runtime
        };
        base.getFactoryForCommands = (commands) => {
            if (!commands) return null;
            const nextFactory = getWebchatFactory(commands);
            return wrapWebchatFactory(nextFactory);
        };
        return base;
    };

    return {
        get webtty() {
            const factory = getWebttyFactory();
            return {
                ttyFactory: factory.factory,
                agentName: 'Router',
                containerName: factory.label,
                runtime: factory.runtime
            };
        },
        get webchat() {
            return wrapWebchatFactory(getWebchatFactory());
        },
        dashboard: { agentName: 'Dashboard', containerName: '-', runtime: 'local' },
        webmeet: { agentName: 'WebMeet', containerName: '-', runtime: 'local' },
        status: { agentName: 'Status', containerName: '-', runtime: 'local' }
    };
}
```

## Exports

```javascript
export { initializeTTYFactories, createServiceConfig };
```

## Factory Result Structure

```javascript
{
    factory: Function|null, // TTY factory function
    label: string,          // Display label (command or container name)
    runtime: string,        // 'local', 'docker', or 'disabled'
    agentName?: string      // Agent name (webchat only)
}
```

## Runtime Types

| Runtime | Description |
|---------|-------------|
| `local` | Local process using node-pty |
| `docker` | Container-based terminal |
| `disabled` | PTY unavailable |

## Usage Example

```javascript
import { initializeTTYFactories, createServiceConfig } from './ttyFactories.js';

// Initialize factories
const { pty, getWebttyFactory, getWebchatFactory } = await initializeTTYFactories();

// Create service config
const services = createServiceConfig(getWebttyFactory, getWebchatFactory);

// Access WebTTY factory (lazy evaluation)
const webttyConfig = services.webtty;
if (webttyConfig.ttyFactory) {
    const tty = webttyConfig.ttyFactory();
    // Use TTY...
}

// Access WebChat factory with custom commands
const webchatConfig = services.webchat;
const customFactory = webchatConfig.getFactoryForCommands({
    host: '/custom/command',
    agentName: 'custom-agent'
});
```

## Related Modules

- [server-utils-config-cache.md](./server-utils-config-cache.md) - Caching utility
- [server-handlers-webtty.md](../handlers/server-handlers-webtty.md) - WebTTY handler
- [server-handlers-webchat.md](../handlers/server-handlers-webchat.md) - WebChat handler
