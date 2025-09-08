const readline = require('readline');
const { callLLM } = require('./LLMClient.js');
const { theme, BOX_CHARS } = require('./AgentUtil.js');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const chatHistory = [];

let terminalWidth = process.stdout.columns || 80;
process.stdout.on('resize', () => {
    terminalWidth = process.stdout.columns || 80;
});

async function startChat() {
    // Use a simple prompt. The box will be drawn *after* input is received for robustness.
    const prompt = '> ';

    rl.question(prompt, async (userInput) => {
        // After input, move cursor up, clear the line, and redraw the input inside a full box.
        process.stdout.write('\x1b[A'); // Move cursor up to the prompt line.
        process.stdout.write('\x1b[2K'); // Clear the entire line.

        const topBorder = `${theme.secondary}${BOX_CHARS.TL}${BOX_CHARS.H.repeat(terminalWidth - 2)}${BOX_CHARS.TR}${theme.reset}`;
        const bottomBorder = `${theme.secondary}${BOX_CHARS.BL}${BOX_CHARS.H.repeat(terminalWidth - 2)}${BOX_CHARS.BR}${theme.reset}`;
        
        const content = `> ${userInput}`;
        const paddingLength = Math.max(0, terminalWidth - content.length - 2); // -2 for the vertical bars
        const contentLine = `${theme.secondary}${BOX_CHARS.V}${theme.reset}${content}${' '.repeat(paddingLength)}${theme.secondary}${BOX_CHARS.V}${theme.reset}`;

        console.log(topBorder);
        console.log(contentLine);
        console.log(bottomBorder);

        if (userInput.toLowerCase() === 'exit') {
            console.log('Goodbye!');
            rl.close();
            return;
        }

        chatHistory.push({ role: 'human', message: userInput });

        try {
            const aiResponse = await callLLM(chatHistory);
            console.log(`${theme.primary}${aiResponse}${theme.reset}`);
            chatHistory.push({ role: 'ai', message: aiResponse });
        } catch (error) {
            // Error is already logged by callLLM, so we just remove the last user message from history
            chatHistory.pop();
        }

        startChat(); // Continue the conversation
    });
}

console.log("Starting chat session. Type 'exit' to end.");
startChat();