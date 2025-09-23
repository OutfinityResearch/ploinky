import { callLLM } from '../../Agent/client/LLMClient.mjs';

const options = {
    model: 'claude-sonnet-4-20250514',
    providerKey: 'anthropic',
    baseURL: 'https://api.anthropic.com/v1/messages',
    apiKey: process.env.ANTHROPIC_API_KEY || 'set-your-anthropic-key',
};

const context = [];

callLLM(context, 'hello', options)
    .then((aiResponse) => {
        console.log(aiResponse);
    })
    .catch((error) => {
        console.error('Anthropic call failed:', error.message);
    });
