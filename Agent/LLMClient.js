const google = require('./providers/google.js');
const openai = require('./providers/openai.js');
const anthropic = require('./providers/anthropic.js');
const huggingFace = require('./providers/huggingFace.js');
let providers = {
    openai,
    google,
    anthropic,
    huggingFace
}
async function callLLM(chatContext, signal) {
    try {
        let openAIFormatProviders = ["openai", "openrouter", "custom"]
        let textResult;
        if(openAIFormatProviders.includes(process.env.LLM_PROVIDER)){
            textResult = await openai.callLLM(chatContext, signal);
        } else {
            let provider = providers[process.env.LLM_PROVIDER];
            if(!provider){
                throw new Error(`Unknown provider: ${process.env.LLM_PROVIDER}`);
            }
            textResult = await provider.callLLM(chatContext, signal);
        }
        return textResult;
    } catch (error) {
        // Gracefully handle user cancellation
        if (error.name === 'AbortError') {
            return; // Return undefined, which the caller should handle
        }
        // The error will be logged to the reblessed chatLog by the caller
        throw error; // Re-throw the error to be caught by the outer .catch
    }
}

module.exports = { callLLM };
