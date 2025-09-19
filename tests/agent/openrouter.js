const { callLLM } = require('../../Agent/LLMClient.js');

const options = {
    model: 'gpt-4o-mini',
    providerKey: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: process.env.OPENROUTER_API_KEY || 'set-your-openrouter-key',
};

const context = [];

callLLM(context, 'hello', options)
    .then((aiResponse) => {
        console.log(aiResponse);
    })
    .catch((error) => {
        console.error('OpenRouter call failed:', error.message);
    });
