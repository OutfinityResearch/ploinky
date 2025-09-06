/**
 * Default configuration for Ploinky Cloud
 */
const defaultConfig = {
    settings: {
        serverName: 'Ploinky Cloud',
        logLevel: 'info',
        metricsRetention: 7,
        maxTaskTimeout: 300000,
        enableAuth: false  // Disabled per requirements
    },
    domains: [
        {
            name: 'localhost',
            enabled: true
        }
    ],
    repositories: [
        {
            name: 'PloinkyDemo',
            url: 'https://github.com/PloinkyRepos/PloinkyDemo.git',
            enabled: true,
            description: 'Default demo repository with example agents'
        }
    ],
    deployments: []
};

module.exports = { defaultConfig };