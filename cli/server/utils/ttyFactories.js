import { resolveVarValue } from '../../services/secretVars.js';
import { configCache } from '../utils/configCache.js';
import { logBootEvent } from '../utils/logger.js';
import { getAppName } from '../authHandlers.js';
import { resolveWebchatCommands } from '../webchat/commandResolver.js';

/**
 * Load PTY library (optional dependency)
 */
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

/**
 * Load TTY module with fallback support
 */
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
            } catch (_) { }
        }
        throw primaryError;
    }
}

/**
 * Load all TTY modules
 */
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

/**
 * Build a local TTY factory with defaults
 */
function buildLocalFactory(createFactoryFn, pty, defaults = {}) {
    if (!pty || !createFactoryFn) return null;
    return createFactoryFn({ ptyLib: pty, workdir: process.cwd(), ...defaults });
}

/**
 * Create WebTTY factory configuration
 */
function createWebttyFactoryConfig(pty, webttyTTYModule) {
    const {
        createTTYFactory: createWebTTYTTYFactory,
        createLocalTTYFactory: createWebTTYLocalFactory
    } = webttyTTYModule;

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
            if (createWebTTYLocalFactory) {
                const command = config.shell || config.command;
                const factory = buildLocalFactory(createWebTTYLocalFactory, pty, { command });
                if (factory) {
                    logBootEvent('webtty_local_process_factory_ready', { command: command || null });
                }
                return {
                    factory,
                    label: command ? command : 'local shell',
                    runtime: 'local'
                };
            }
            if (createWebTTYTTYFactory) {
                const factory = createWebTTYTTYFactory({ ptyLib: pty, runtime: 'docker', containerName: config.container });
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

/**
 * Create WebChat factory configuration
 */
function createWebchatFactoryConfig(pty, webchatTTYModule, resolvedWebchatCommands) {
    const {
        createTTYFactory: createWebChatTTYFactory,
        createLocalTTYFactory: createWebChatLocalFactory
    } = webchatTTYModule;

    return () => configCache.getOrCreate(
        'webchat',
        () => ({
            container: process.env.WEBCHAT_CONTAINER || 'ploinky_chat',
            hostCommand: resolvedWebchatCommands.host,
            containerCommand: resolvedWebchatCommands.container,
            source: resolvedWebchatCommands.source,
            agentName: resolvedWebchatCommands.agentName || ''
        }),
        (config) => {
            if (!pty) {
                logBootEvent('webchat_factory_disabled', { reason: 'pty_unavailable' });
                return { factory: null, label: '-', runtime: 'disabled', agentName: config.agentName || '' };
            }
            if (createWebChatLocalFactory) {
                const command = config.hostCommand;
                const factory = buildLocalFactory(createWebChatLocalFactory, pty, { command });
                if (factory) {
                    logBootEvent('webchat_local_process_factory_ready', {
                        command: command || null,
                        source: config.source
                    });
                }
                return {
                    factory,
                    label: command ? command : 'local shell',
                    runtime: 'local',
                    agentName: config.agentName || ''
                };
            }
            if (createWebChatTTYFactory) {
                const entry = config.containerCommand;
                const factory = createWebChatTTYFactory({ ptyLib: pty, runtime: 'docker', containerName: config.container, entry });
                logBootEvent('webchat_container_factory_ready', {
                    containerName: config.container,
                    command: entry || null,
                    source: config.source
                });
                return {
                    factory,
                    label: config.container,
                    runtime: 'docker',
                    agentName: config.agentName || ''
                };
            }
            logBootEvent('webchat_factory_disabled', { reason: 'no_factory_available' });
            return { factory: null, label: '-', runtime: 'disabled', agentName: config.agentName || '' };
        }
    );
}

/**
 * Initialize TTY factories and return configuration
 */
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

    return {
        pty,
        getWebttyFactory,
        getWebchatFactory
    };
}

/**
 * Create service configuration object
 */
function createServiceConfig(getWebttyFactory, getWebchatFactory) {
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
            const factory = getWebchatFactory();
            const appName = getAppName(); // Always get fresh APP_NAME
            const resolvedAgentName = factory?.agentName;
            return {
                ttyFactory: factory.factory,
                agentName: resolvedAgentName || appName || 'ChatAgent',
                containerName: factory.label,
                runtime: factory.runtime
            };
        },
        dashboard: {
            agentName: 'Dashboard',
            containerName: '-',
            runtime: 'local'
        },
        webmeet: {
            agentName: 'WebMeet',
            containerName: '-',
            runtime: 'local'
        },
        status: {
            agentName: 'Status',
            containerName: '-',
            runtime: 'local'
        }
    };
}

export {
    initializeTTYFactories,
    createServiceConfig
};
