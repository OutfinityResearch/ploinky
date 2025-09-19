const { callLLM, callLLMWithModel } = require('../../Agent/LLMClient.js');

const options = {
    model: 'gpt-4o-mini',
    providerKey: 'openai',
    baseURL: 'https://api.openai.com/v1/chat/completions',
    apiKey: process.env.OPENAI_API_KEY || 'set-your-openai-key',
};

const context = [];

callLLM(context, 'hello', options)
    .then((aiResponse) => {
        console.log(aiResponse);
    })
    .catch((error) => {
        console.error('callLLM failed:', error.message);
    });

callLLMWithModel(options.model, context, 'hello', options)
    .then((aiResponse) => {
        console.log(aiResponse);
    })
    .catch((error) => {
        console.error('callLLMWithModel failed:', error.message);
    });
