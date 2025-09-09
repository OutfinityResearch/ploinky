const theme = {
    reset: "\x1b[0m",
    secondary: "\x1b[90m", // gray
    text: "\x1b[37m",      // white
    primary: "\x1b[94m",   // light blue
    warning: "\x1b[33m",   // yellow
    success: "\x1b[32m",   // green
    error: "\x1b[31m",     // red
};
const COMMANDS = {
    HELP: 'help',
    CONFIGURE: 'configure',
};

// Constants for file reading animation
const BOX_CHARS = {
    TL: '╭', TR: '╮', BL: '╰', BR: '╯', H: '─', V: '│'
};
const SPINNER_FRAMES = ['|', '/', '-', '\\'];

const frames = [
    `${theme.text}.${theme.secondary}..`,
    `${theme.secondary}.${theme.text}.${theme.secondary}.`,
    `${theme.secondary}..${theme.text}.`
];
const HINT_MESSAGE = `${theme.warning}Press ESC to stop generation...${theme.reset}`; // The hint message

const animationManager = (() => {
    const activeAnimations = new Map();
    let nextId = 0;
    let intervalId = null;
    let totalLines = 0; // Single source of truth for block height

    // Internal function to draw all active animations from the current cursor position
    const _redrawInternal = () => {
        let linesDrawn = 0;
        activeAnimations.forEach(anim => {
            const lines = anim.render();
            lines.forEach(line => {
                process.stdout.write(`\x1b[2K\x1b[0G${line}\n`);
            });
            linesDrawn += anim.getLineCount();
        });
        return linesDrawn;
    };

    // The function called by setInterval to update the animations
    const redrawForInterval = () => {
        if (activeAnimations.size === 0) return;
        // Move cursor to the top of the block and redraw
        process.stdout.write(`\x1b[${totalLines}A`);
        totalLines = _redrawInternal();
    };

    // Utility to completely clear the current animation block
    const clearBlock = () => {
        if (totalLines === 0) return;
        process.stdout.write(`\x1b[${totalLines}A`);
        for (let i = 0; i < totalLines; i++) {
            process.stdout.write(`\x1b[2K\x1b[B`);
        }
        process.stdout.write(`\x1b[${totalLines}A`);
    };

    const start = (animation) => {
        const id = nextId++;
        animation.id = id;

        clearBlock();
        activeAnimations.set(id, animation);
        totalLines = _redrawInternal();

        if (!intervalId) {
            intervalId = setInterval(redrawForInterval, 150);
        }
        return id;
    };

    const stop = (id) => {
        const animation = activeAnimations.get(id);
        if (!animation) return null;
 
        const isLastAnimation = activeAnimations.size === 1;
 
        if (isLastAnimation) {
            // Stop the timer FIRST to prevent a race condition where a final
            // redraw happens during the cleanup process.
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
        }
 
        clearBlock(); // Clear the screen space used by the animations.
        activeAnimations.delete(id); // Remove the animation from the map.
 
        if (isLastAnimation) {
            totalLines = 0;
        } else {
            // If animations remain, redraw them immediately to update the view.
            totalLines = _redrawInternal();
        }
 
        return animation;
    };

    return { start, stop };
})();

/**
 * Starts the "thinking" console animation with a timer.
 * @param {string} [text="Thinking"] - The text to display before the animated dots.
 * @returns {number} The ID of the animation.
 */
const startThinkingAnimation = (text = "Thinking") => {
    let frameIndex = 0;
    const startTime = Date.now();

    const animation = {
        id: -1,
        startTime,
        getLineCount: () => 2,
        render: () => {
            frameIndex = (frameIndex + 1) % frames.length;
            const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
            const animLine = `${theme.secondary}${text} ${frames[frameIndex]} (${elapsedSeconds}s)${theme.reset}`;
            const hintLine = HINT_MESSAGE;
            return [animLine, hintLine];
        }
    };
    return animationManager.start(animation);
};

/**
 * Stops the "thinking" console animation, clearing it completely from the view.
 * @param {number} id The ID of the animation to stop.
 */
const stopThinkingAnimation = (id) => {
    // This function simply stops and clears the animation without leaving a completion message.
    animationManager.stop(id);
};

/**
 * Logs a message to the console without breaking the "thinking" animation.
 * It temporarily pauses the animation, prints the message, and then redraws the animation frame.
 * @param {...any} args - The arguments to pass to console.log.
 */
const logWithThinkingAnimation = (...args) => {
    // NOTE: Logging while animations are running is complex with the new manager.
    // This function will now simply log to the console, which may temporarily
    // disrupt the animation display. A more robust solution would integrate
    // with the animationManager to pause, log, and redraw.
    console.log(...args);
};

/**
 * Starts a "reading file" animation with a spinner in a rounded box.
 * @param {string} fileName The name of the file being read.
 * @returns {number} The ID of the animation.
 */
const startReadFileAnimation = (fileName) => {
    let frameIndex = 0;
    const animation = {
        id: -1,
        fileName,
        getLineCount: () => 3,
        render: () => {
            frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
            const spinner = SPINNER_FRAMES[frameIndex];
            const text = `Reading file: ${fileName}`;
            const padding = 2;
            const contentWidth = text.length + 2; // for spinner and space
            const boxWidth = contentWidth + padding * 2;

            const topBorder = `${theme.secondary}${BOX_CHARS.TL}${BOX_CHARS.H.repeat(boxWidth)}${BOX_CHARS.TR}${theme.reset}`;
            const contentLine = `${theme.secondary}${BOX_CHARS.V}${theme.reset}${' '.repeat(padding)}${theme.warning}${spinner}${theme.reset} ${theme.text}${text}${theme.reset}${' '.repeat(padding)}${theme.secondary}${BOX_CHARS.V}${theme.reset}`;
            const bottomBorder = `${theme.secondary}${BOX_CHARS.BL}${BOX_CHARS.H.repeat(boxWidth)}${BOX_CHARS.BR}${theme.reset}`;

            return [topBorder, contentLine, bottomBorder];
        }
    };
    return animationManager.start(animation);
};

// Helper to strip ANSI color codes to calculate visible string length
const stripAnsi = (str) => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

// Helper to create a static boxed message
function createBoxedMessage(content) {
    const padding = 2;
    const visibleContentLength = stripAnsi(content).length;
    const boxWidth = visibleContentLength + padding * 2;

    const topBorder = `${theme.secondary}${BOX_CHARS.TL}${BOX_CHARS.H.repeat(boxWidth)}${BOX_CHARS.TR}${theme.reset}`;
    const contentLine = `${theme.secondary}${BOX_CHARS.V}${theme.reset}${' '.repeat(padding)}${content}${' '.repeat(padding)}${theme.secondary}${BOX_CHARS.V}${theme.reset}`;
    const bottomBorder = `${theme.secondary}${BOX_CHARS.BL}${BOX_CHARS.H.repeat(boxWidth)}${BOX_CHARS.BR}${theme.reset}`;

    return `${topBorder}\n${contentLine}\n${bottomBorder}`;
}

/**
 * Stops the "reading file" animation and returns a completion message string for success or failure.
 * @param {number} id The ID of the animation to stop.
 * @param {Error|null} [error=null] - An optional error object. If provided, a failure message will be generated.
 * @returns {string|null} The completion message, or null if the animation was not found.
 */
const stopReadFileAnimation = (id, error = null) => {
    const stoppedAnim = animationManager.stop(id);
    if (stoppedAnim) {
        let content;
        if (error) {
            const reason = error.message || String(error);
            content = `${theme.error}❌${theme.reset} ${theme.secondary}Failed to read: ${theme.text}${stoppedAnim.fileName}${theme.reset} ${theme.secondary}(${reason})${theme.reset}`;
        } else {
            content = `${theme.success}✅${theme.reset} ${theme.secondary}Read: ${theme.text}${stoppedAnim.fileName}${theme.reset}`;
        }
        return createBoxedMessage(content);
    }
    return null;
};

/**
 * Displays the application intro screen in the console.
 */
const displayIntro = () => {
    const ploinkyArt = [
        ' ____  _      ____  ___  _   _  _  __ __   __',
        '|  _ \\| |    / __ \\|_ _|| \\ | || |/ / \\ \\ / /',
        '| |_) | |   | |  | || | |  \\| || \' /   \\ V /',
        '|  __/| |   | |  | || | | . ` ||  <     > <',
        '| |   | |___| |__| || | | |\\  || . \\   / . \\',
        '|_|   |______\\____/|___||_| \\_||_|\\_\\ /_/ \\_\\'
    ];

    console.log(theme.primary + ploinkyArt.join('\n') + theme.reset);
    console.log();
    console.log(`Welcome to Ploinky, your AI-powered command-line assistant.`);
    console.log();
    console.log(`  ${theme.secondary}•${theme.reset} Configure your LLM and provider using the ${theme.warning}/${COMMANDS.CONFIGURE}${theme.reset} command.`);
    console.log(`  ${theme.secondary}•${theme.reset} Type ${theme.warning}/${COMMANDS.HELP}${theme.reset} for a list of all available commands.`);
    console.log();
};

/**
 * Creates a keypress event handler.
 * This factory function allows the handler to be stateful, managing generation cancellation.
 * @param {object} chatState - A state object, expected to have `isGenerating` and `abortController` properties.
 * @returns {function(string, object): void} The event listener for keypress events.
 */
const createKeyPressHandler = (chatState) => (str, key) => {
    // Allow Ctrl+C to exit the application cleanly
    if (key.ctrl && key.name === 'c') {
        process.exit();
    }

    // Handle ESC for stopping generation
    if (chatState.isGenerating && key.name === 'escape') {
        if (chatState.abortController) {
            chatState.abortController.abort();
        }
    }
};

/**
 * Handles the 'close' event on the readline interface, ensuring a clean exit.
 */
const handleRlClose = () => {
    process.exit(0);
};

/**
 * Handles the 'exit' event on the process, ensuring raw mode is turned off.
 */
const handleProcessExit = () => {
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
    }
    console.log('\nExiting Ploinky. Goodbye!');
};

module.exports = {
    displayIntro,
    startThinkingAnimation,
    stopThinkingAnimation,
    logWithThinkingAnimation,
    startReadFileAnimation,
    stopReadFileAnimation,
    theme,
    BOX_CHARS,
    COMMANDS,
    createKeyPressHandler,
    handleRlClose,
    handleProcessExit,
    stripAnsi,
};