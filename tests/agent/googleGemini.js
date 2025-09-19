const { callLLM } = require('../../Agent/LLMClient.js');

const options = {
    model: 'gemini-2.5-flash',
    providerKey: 'google',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/models/',
    apiKey: process.env.GEMINI_API_KEY || 'set-your-gemini-key',
};

const context = [];

callLLM(context, 'hello', options)
    .then((aiResponse) => {
        console.log(aiResponse);
    })
    .catch((error) => {
        console.error('Google Gemini call failed:', error.message);
    });
