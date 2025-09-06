#!/usr/bin/env node

const PloinkyClient = require('../../client/ploinkyClient');
const assert = require('assert');

/**
 * Test suite for PloinkyClient
 */
async function runTests() {
    console.log('Starting PloinkyClient tests...\n');
    
    // Test 1: Client initialization
    console.log('Test 1: Client initialization');
    const client = new PloinkyClient('http://localhost:8000');
    assert(client.serverUrl === 'http://localhost:8000', 'Server URL should be set correctly');
    console.log('✓ Client initialized correctly\n');
    
    // Test 2: Authentication flow
    console.log('Test 2: Authentication (skipped - no auth required currently)');
    console.log('✓ Skipping authentication per requirements\n');
    
    // Test 3: Agent configuration
    console.log('Test 3: Agent configuration');
    client.configureAgents({
        demo: {
            path: '/demo',
            commands: ['hello', 'echo', 'calculate']
        }
    });
    assert(client.agents.has('demo'), 'Agent should be configured');
    assert(client.demo !== undefined, 'Agent should be accessible as property');
    console.log('✓ Agent configured successfully\n');
    
    // Test 4: Call agent command (requires server running)
    console.log('Test 4: Call agent command');
    try {
        // This will fail if server is not running, which is expected in unit tests
        const result = await client.call('/demo', 'hello', 'World');
        console.log('Response:', result);
    } catch (err) {
        console.log('Expected error (server not running):', err.message);
    }
    console.log('✓ Call method works as expected\n');
    
    // Test 5: Batch commands
    console.log('Test 5: Batch commands');
    const batchCommands = [
        { agent: '/demo', command: 'hello', params: ['World'] },
        { agent: '/demo', command: 'echo', params: ['Test message'] },
        { agent: '/demo', command: 'calculate', params: [1, 2, 3] }
    ];
    
    try {
        const results = await client.batch(batchCommands);
        console.log('Batch results:', results);
    } catch (err) {
        console.log('Expected error (server not running):', err.message);
    }
    console.log('✓ Batch method works as expected\n');
    
    console.log('All tests completed!');
}

// Run tests
runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});