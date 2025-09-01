const fs = require('fs').promises;
const path = require('path');

let GLOBAL_CONFIG = {};
try {
    const globalConfigPath = path.join(__dirname, '..', 'sources', 'global-config.json');
    const configData = require('fs').readFileSync(globalConfigPath, 'utf8');
    GLOBAL_CONFIG = JSON.parse(configData);
} catch (error) {
    console.log('Warning: Could not load global-config.json, using environment variables');
    GLOBAL_CONFIG = {
        apiKeys: {},
        defaultProvider: 'openai',
        defaultModels: {},
        promotionalBanner: {
            enabled: false,
            defaultText: 'Powered by Axiologic.news',
            defaultUrl: 'https://axiologic.news'
        },
        contentSettings: {
            maxPostsPerFeed: 10,
            maxTokensPerRequest: 500,
            contentFetchTimeout: 10000,
            requestTimeout: 30000,
            historyDays: 5
        }
    };
}

async function loadEnhancedConfig(configPath) {
    const data = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(data);
    
    // Set defaults for new fields
    config.selectionPrompt = config.selectionPrompt || '';
    config.perspectivesPrompt = config.perspectivesPrompt || '';
    config.essencePrompt = config.essencePrompt || '';
    config.topPostsPerFeed = config.topPostsPerFeed || 5;
    config.historyDays = config.historyDays || 5;
    
    return config;
}

module.exports = {
    GLOBAL_CONFIG,
    loadEnhancedConfig
};