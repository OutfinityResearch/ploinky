const fs = require('fs');
const path = require('path');
const google = require('./providers/google.js');
const openai = require('./providers/openai.js');
const anthropic = require('./providers/anthropic.js');
const huggingFace = require('./providers/huggingFace.js');

const modelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'models.json'), 'utf-8'));

const providers = {
    openai,
    google,
    anthropic,
    huggingface: huggingFace, // Match the key in models.json
    openrouter: openai, // OpenRouter uses the OpenAI format
    custom: openai,     // Custom providers can also use the OpenAI format
};
const llmCalls = []; // Array to store active AbortControllers
const DEFAULT_MODEL = "gpt-4o-mini"
function getModelMetadata(modelName) {
    const entry = modelConfig.models?.[modelName];
    if (!entry) {
        return null;
    }
    if (typeof entry === 'string') {
        return { provider: entry };
    }
    if (typeof entry === 'object' && entry !== null) {
        return { provider: entry.provider };
    }
    return null;
}

async function callLLM(historyArray, prompt) {
    try {
        let modelName = process.env.LLM_MODEL;
        if(!modelName){
            modelName = DEFAULT_MODEL;
        }
        const modelMeta = getModelMetadata(modelName);
        const providerName = modelMeta?.provider;

        if (!providerName) {
            throw new Error(`Model "${modelName}" not found in models.json`);
        }

        const providerConfig = modelConfig.providers[providerName];
        if (!providerConfig) {
            throw new Error(`Provider "${providerName}" for model "${modelName}" not found in models.json`);
        }

        const provider = providers[providerName];
        if (!provider) {
            throw new Error(`Provider implementation for "${providerName}" not found in LLMClient.js`);
        }
        // The callLLMWithModel function contains the core logic
        return await callLLMWithModel(modelName, historyArray, prompt);
    } catch (error) {
        throw error; // Re-throw the error to be caught by the outer .catch
    }
}

async function callLLMWithModel(modelName, historyArray, prompt){
    const controller = new AbortController();
    llmCalls.push(controller);
    if(prompt){
        historyArray.push({ role: 'human', message: prompt });
    }

    try {
        const modelMeta = getModelMetadata(modelName);
        const providerName = modelMeta?.provider;
        if (!providerName) {
            throw new Error(`Model "${modelName}" not found in models.json`);
        }

        const providerConfig = modelConfig.providers[providerName];
        if (!providerConfig) {
            throw new Error(`Provider "${providerName}" for model "${modelName}" not found in models.json`);
        }

        const provider = providers[providerName];
        if (!provider) {
            throw new Error(`Provider implementation for "${providerName}" not found in LLMClient.js`);
        }
        process.env.LLM_BASE_URL = providerConfig.baseURL;
        process.env.LLM_MODEL = modelName;
        process.env.LLM_PROVIDER = providerName;

        return await provider.callLLM(historyArray, controller.signal);
    } catch (error) {
        throw error; // Re-throw the error to be caught by the outer .catch
    } finally {
        // Remove the controller from the list when the call is finished
        const index = llmCalls.indexOf(controller);
        if (index > -1) {
            llmCalls.splice(index, 1);
        }
    }
}

async function cancelRequests(){
    llmCalls.forEach(controller => controller.abort());
    llmCalls.length = 0; // Clear the array
}

module.exports = { callLLM, callLLMWithModel, cancelRequests };
