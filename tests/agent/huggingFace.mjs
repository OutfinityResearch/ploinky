import { callLLM } from '../../Agent/client/LLMClient.mjs';

const options = {
    model: 'mistralai/Mistral-7B-Instruct-v0.1',
    providerKey: 'huggingface',
    baseURL: 'https://api-inference.huggingface.co/models',
    apiKey: process.env.HUGGINGFACE_API_KEY || '',
};

const context = [];

callLLM(context, 'hello', options)
    .then((aiResponse) => {
        console.log(aiResponse);
    })
    .catch((error) => {
        console.error('Hugging Face call failed:', error.message);
    });
