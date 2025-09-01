const { GLOBAL_CONFIG } = require('./config.js');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Simple fetch polyfill for Node.js with timeout
function nodeFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        const timeout = options.timeout || 30000; // 30 second default timeout
        const parsedUrl = new URL(url);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        
        const reqOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname + parsedUrl.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: timeout
        };
        
        const req = protocol.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    json: () => {
                        try {
                            return Promise.resolve(JSON.parse(data));
                        } catch (e) {
                            console.log('Failed to parse JSON:', data.substring(0, 200));
                            return Promise.reject(e);
                        }
                    },
                    text: () => Promise.resolve(data)
                });
            });
        });
        
        req.on('timeout', () => {
            req.abort();
            reject(new Error(`Request timeout after ${timeout}ms`));
        });
        
        req.on('error', reject);
        
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

// Use native fetch if available, otherwise use polyfill
const fetch = global.fetch || nodeFetch;


function getApiKey(provider) {
    const providerEnvVars = {
        mistral: ['MISTRAL_API_KEY'],
        gemini: ['GEMINI_API_KEY'],
        claude: ['CLAUDE_API_KEY', 'ANTHROPIC_API_KEY'],
        anthropic: ['CLAUDE_API_KEY', 'ANTHROPIC_API_KEY'],
        openai: ['OPENAI_API_KEY'],
        groq: ['GROQ_API_KEY']
    };

    if (providerEnvVars[provider]) {
        for (const key of providerEnvVars[provider]) {
            if (process.env[key]) {
                return process.env[key];
            }
        }
    }

    if (process.env.AI_API_KEY) {
        return process.env.AI_API_KEY;
    }

    if (GLOBAL_CONFIG.apiKeys && GLOBAL_CONFIG.apiKeys[provider]) {
        const configValue = GLOBAL_CONFIG.apiKeys[provider];
        if (configValue && !configValue.startsWith('<')) {
            return configValue;
        }
    }
    return null;
}

function getModel(provider) {
    const customModel = process.env.AI_MODEL;
    if (customModel) return customModel;

    if (GLOBAL_CONFIG.defaultModels && GLOBAL_CONFIG.defaultModels[provider]) {
        return GLOBAL_CONFIG.defaultModels[provider];
    }

    switch(provider) {
        case 'mistral':
            return 'mistral-large-latest';
        case 'gemini':
            return 'gemini-1.5-flash';
        case 'claude':
        case 'anthropic':
            return 'claude-3-haiku-20240307';
        case 'openai':
            return 'gpt-4o-mini';
        case 'ollama':
            return 'llama2';
        default:
            return 'gpt-4o-mini';
    }
}

class AIService {
    constructor() {
        // Prioritize based on AI_PROVIDER env var, then check in order
        const preferredProvider = process.env.AI_PROVIDER;
        if (preferredProvider && preferredProvider !== 'none') {
            this.providers = [preferredProvider, 'mistral', 'gemini', 'anthropic', 'openai', 'groq', 'ollama'];
        } else {
            this.providers = ['mistral', 'gemini', 'anthropic', 'openai', 'groq', 'ollama'];
        }
        this.activeProvider = null;
        this.apiKey = null;
    }

    async initialize() {
        // Remove duplicates from providers list
        this.providers = [...new Set(this.providers)];
        
        for (const provider of this.providers) {
            const apiKey = getApiKey(provider);
            // Check if API key is valid (not a placeholder starting with $)
            if (apiKey && !apiKey.startsWith('$') && (apiKey.length > 10 || provider === 'ollama')) {
                this.activeProvider = provider;
                this.apiKey = apiKey;
                const model = getModel(this.activeProvider);
                console.log(`AI: ${this.activeProvider} / ${model}`);
                if(this.apiKey){
                    console.log(`API Key: ${this.apiKey.substring(0, 10)}... (found)`);
                }
                return;
            }
        }
        console.error('ERROR: No AI provider API key found!');
        console.error('Please set one of: MISTRAL_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY');
        console.error('Or configure API keys in sources/global-config.json');
        process.exit(1);
    }

    async analyze(prompt, maxTokens = null) {
        if (!this.activeProvider) {
            console.log('      AI not available - skipping');
            return null;
        }

        if (!maxTokens) {
            maxTokens = GLOBAL_CONFIG.contentSettings?.maxTokensPerRequest || 800;
        }

        try {
            switch(this.activeProvider) {
                case 'ollama':
                    return await this.ollamaRequest(prompt, maxTokens);
                case 'openai':
                    return await this.openaiRequest(prompt, maxTokens, this.apiKey);
                case 'anthropic':
                case 'claude':
                    return await this.anthropicRequest(prompt, maxTokens, this.apiKey);
                case 'mistral':
                    return await this.mistralRequest(prompt, maxTokens, this.apiKey);
                case 'gemini':
                    return await this.geminiRequest(prompt, maxTokens, this.apiKey);
                default:
                    console.log(`Unknown provider ${this.activeProvider}`);
                    return null;
            }
        } catch (error) {
            console.log(`      Error with provider ${this.activeProvider}: ${error.message}`);
            return null;
        }
    }

    async ollamaRequest(prompt, maxTokens) {
        try {
            const model = getModel('ollama');
            const response = await fetch(`${GLOBAL_CONFIG.ollamaHost || 'http://localhost:11434'}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: model,
                    prompt: prompt,
                    stream: false,
                    options: { num_predict: maxTokens }
                })
            });
            const data = await response.json();
            return data.response || null;
        } catch (error) {
            console.log(`Ollama not available: ${error.message}`);
            return null;
        }
    }

    async openaiRequest(prompt, maxTokens, apiKey) {
        if (!apiKey) {
            console.log('No OpenAI API key found');
            return null;
        }
        try {
            const model = getModel('openai');
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: maxTokens
                })
            });
            const data = await response.json();
            if (data.error) {
                console.log(`OpenAI API error: ${data.error.message}`);
                return null;
            }
            return data.choices?.[0]?.message?.content || null;
        } catch (error) {
            console.log(`OpenAI error: ${error.message}`);
            return null;
        }
    }

    async anthropicRequest(prompt, maxTokens, apiKey) {
        if (!apiKey) {
            console.log('No Claude/Anthropic API key found');
            return null;
        }
        try {
            const model = getModel('anthropic');
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: maxTokens
                })
            });
            const data = await response.json();
            if (data.error) {
                console.log(`Claude API error: ${data.error.message}`);
                return null;
            }
            const content = data.content?.[0]?.text;
            return content || null;
        } catch (error) {
            console.log(`Claude error: ${error.message}`);
            return null;
        }
    }

    async mistralRequest(prompt, maxTokens, apiKey) {
        if (!apiKey) {
            console.log('No Mistral API key found');
            return null;
        }
        try {
            const model = getModel('mistral');
            const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: maxTokens,
                    temperature: 0.7
                })
            });
            const data = await response.json();
            if (data.error) {
                console.log(`Mistral API error: ${data.error?.message || JSON.stringify(data.error)}`);
                return null;
            }
            const content = data.choices?.[0]?.message?.content;
            if (!content) {
                console.log(`Mistral returned empty response. Data structure: ${JSON.stringify(data).substring(0, 200)}`);
                return null;
            }
            return content;
        } catch (error) {
            console.log(`Mistral error: ${error.message}`);
            return null;
        }
    }

    async geminiRequest(prompt, maxTokens, apiKey) {
        if (!apiKey) {
            console.log('No Gemini API key found');
            return null;
        }
        try {
            const model = getModel('gemini');
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }],
                    generationConfig: {
                        maxOutputTokens: maxTokens,
                        temperature: 0.7
                    }
                })
            });
            const data = await response.json();
            if (data.error) {
                console.log(`Gemini API error: ${data.error.message}`);
                return null;
            }
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
            return content || null;
        } catch (error) {
            console.log(`Gemini error: ${error.message}`);
            return null;
        }
    }
}

module.exports = { AIService };