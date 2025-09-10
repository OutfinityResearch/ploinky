const reblessed = require('reblessed');

// Reblessed-compatible theme colors
const theme = {
    secondary: 'grey',
    text: 'white',
    primary: 'bright-blue',
    warning: 'yellow',
    success: 'green',
    error: 'red',
};

const COMMANDS = {
    HELP: 'help',
    CONFIGURE: 'configure',
};

// Constants for file reading animation
const BOX_CHARS = {
    TL: '╭', TR: '╮', BL: '╰', BR: '╯', H: '─', V: '│'
};

let loadingWidget = null;
let loadingInterval = null;

/**
 * Displays an inline, animated loading indicator.
 * @param {reblessed.Screen} screen The main screen object.
 * @param {string} text The text to display.
 */
function showLoading(screen, text = 'Thinking...') {
    if (loadingWidget) {
        hideLoading(screen);
    }

    const frames = [' .  ', ' .. ', ' ...', '..  '];
    let frameIndex = 0;

    loadingWidget = reblessed.box({
        parent: screen,
        bottom: 4, // Positioned above the input box and status bar
        height: 1,
        width: 'shrink',
        left: 1,
        tags: true,
        style: {
            fg: theme.warning,
        }
    });

    // Start the animation interval
    loadingInterval = setInterval(() => {
        if (!loadingWidget) {
            clearInterval(loadingInterval);
            loadingInterval = null;
            return;
        }
        frameIndex = (frameIndex + 1) % frames.length;
        loadingWidget.setContent(`${text}${frames[frameIndex]}`);
        screen.render();
    }, 200);

    screen.render();
}

/**
 * Hides the inline loading indicator.
 * @param {reblessed.Screen} screen The main screen object.
 */
function hideLoading(screen) {
    if (loadingInterval) {
        clearInterval(loadingInterval);
        loadingInterval = null;
    }
    if (loadingWidget) {
        loadingWidget.destroy();
        loadingWidget = null;
        screen.render();
    }
}

// Helper to strip ANSI color codes to calculate visible string length
const stripAnsi = (str) => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

// Helper to create a static boxed message
function createBoxedMessage(content) {
    const padding = 2;
    const visibleContentLength = stripAnsi(content).length;
    const boxWidth = visibleContentLength + padding * 2;

    // Using reblessed tags for colors
    const topBorder = `{${theme.secondary}-fg}${BOX_CHARS.TL}${BOX_CHARS.H.repeat(boxWidth)}${BOX_CHARS.TR}{/}`;
    const contentLine = `{${theme.secondary}-fg}${BOX_CHARS.V}{/} ${' '.repeat(padding - 1)}${content}${' '.repeat(padding)} {${theme.secondary}-fg}${BOX_CHARS.V}{/}`;
    const bottomBorder = `{${theme.secondary}-fg}${BOX_CHARS.BL}${BOX_CHARS.H.repeat(boxWidth)}${BOX_CHARS.BR}{/}`;
    return `${topBorder}\n${contentLine}\n${bottomBorder}`;
}

/**
 * Stops the "reading file" animation and returns a completion message string for success or failure.
 * @param {number} id The ID of the animation to stop.
 * @param {Error|null} [error=null] - An optional error object. If provided, a failure message will be generated.
 * @returns {string|null} The completion message, or null if the animation was not found.
 */

/**
 * Displays the application intro screen in the log widget.
 * @param {reblessed.Log} log The log widget to print to.
 */
const displayIntro = (log) => {
    const ploinkyArt = [
        ' ____  _      ____  ___  _   _  _  __ __   __',
        '|  _ \\| |    / __ \\|_ _|| \\ | || |/ / \\ \\ / /',
        '| |_) | |   | |  | || | |  \\| || \' /   \\ V /',
        '|  __/| |   | |  | || | | . ` ||  <     > /',
        '| |   | |___| |__| || | | |\\  || . \\   / /',
        '|_|   |______\\____/|___||_| \\_||_|\\_\\ /_/'
    ];

    log.log(`{${theme.primary}-fg}${ploinkyArt.join('\n')}{/}`);
    log.log('');
    log.log(`Welcome to Ploinky, your AI-powered command-line assistant.`);
    log.log('');
    log.log(`  {${theme.secondary}-fg}•{/} Configure your LLM and provider using the {${theme.warning}-fg}/${COMMANDS.CONFIGURE}{/} command.`);
    log.log(`  {${theme.secondary}-fg}•{/} Type {${theme.warning}-fg}/${COMMANDS.HELP}{/} for a list of all available commands.`);
    log.log('');
};

/**
 * Updates the content of a reblessed status bar widget.
 * @param {reblessed.Box} statusBar The status bar widget.
 * @param {object} config The application configuration.
 */
const updateStatusBar = (statusBar, config) => {
    const provider = config?.provider || 'N/A';
    const model = config?.model || 'N/A';
    const CWD = process.cwd();
    const homeDir = require('os').homedir();
    let displayPath = CWD;
    if (displayPath.startsWith(homeDir)) {
        displayPath = '~' + displayPath.substring(homeDir.length);
    }

    const leftText = `{${theme.secondary}-fg}${displayPath}{/}`;
    const rightText = `{${theme.secondary}-fg}${provider} | ${model}{/}`;
    statusBar.setContent(`${leftText} ${rightText.padStart(statusBar.width - stripAnsi(leftText).length - 1)}`);
};

/**
 * Creates an interactive selection menu with arrow key navigation
 * @param {Object} options Configuration for the menu
 * @param {string} options.title The title to display above the menu
 * @param {string} options.instructions Instructions for using the menu
 * @param {Array} options.items Array of items to select from
 * @param {function} options.formatItem Function to format each item for display
 * @param {number} [options.initialIndex=0] Initial selected index
 * @param {reblessed.Screen} options.screen The main screen object.
 * @returns {Promise<Object|null>} The selected item or null if cancelled
 */
const createInteractiveMenu = (options) => {
    return new Promise((resolve) => {
        const {
            title,
            items,
            formatItem = (item) => item.toString(),
            screen,
        } = options;
        const formattedItems = items.map(item => stripAnsi(formatItem(item, false)));
        
        const list = reblessed.list({
            parent: screen,
            label: ` ${title} `,
            top: 'center',
            left: 'center',
            width: '80%',
            height: '70%',
            items: formattedItems,
            keys: true,
            vi: true,
            mouse: false,
            border: 'line',
            scrollable: true,
            interactive: true,
            style: {
                fg: theme.text,
                border: { fg: theme.primary },
                selected: { bg: theme.primary, fg: 'black' },
                item: { hover: { bg: theme.primary } },
                label: { fg: theme.text, bg: theme.primary }
            }
        });

        const cleanup = (result) => {
            list.removeAllListeners();
            list.destroy();
            screen.render();
            resolve(result);
        };

        // Keep the list event handlers as backup
        list.on('select', (item, index) => cleanup(items[index]));
        list.on('cancel', () => cleanup(null));

        screen.append(list);
        list.focus();
        screen.render();
    });
};

module.exports = {
    displayIntro,
    showLoading,
    hideLoading,
    theme,
    BOX_CHARS,
    COMMANDS,
    stripAnsi,
    updateStatusBar,
    createBoxedMessage,
    createInteractiveMenu,
};