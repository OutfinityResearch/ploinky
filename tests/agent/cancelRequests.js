const { callLLMWithModel, cancelRequests } = require('../../Agent/LLMClient.js');

const options = {
    providerKey: 'openai',
    baseURL: 'https://api.openai.com/v1/chat/completions',
    apiKey: process.env.OPENAI_API_KEY || 'set-your-openai-key',
};

/**
 * This test demonstrates starting two LLM calls in parallel and then cancelling them.
 */
async function runParallelCancellationTest() {
    console.log('--- Starting Parallel Cancellation Test ---');

    const model1 = 'gpt-4o-mini';

    const historyArray = [];

    console.log(`Starting call to ${model1}...`);
    const promise1 = callLLMWithModel(model1, historyArray, 'hello', options);

    console.log(`Starting call to ${model1}...`);
    const promise2 = callLLMWithModel(model1, historyArray, 'hello', options);

    // After a short delay, cancel all in-flight requests.
    setTimeout(() => {
        console.log('\n>>> Requesting cancellation of all LLM calls...\n');
        cancelRequests();
    }, 200); // 200ms delay

    try {
        // We expect these promises to reject with an AbortError.
        await Promise.all([promise1, promise2]);
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('>>> Successfully caught AbortError as expected. Test PASSED.');
        } else {
            console.error('>>> Test FAILED. Caught an unexpected error:', error);
        }
    }
    console.log('--- Test Complete ---');
}

runParallelCancellationTest();
