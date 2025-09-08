process.env.LLM_BASE_URL = "https://api.openai.com/v1/chat/completions";
process.env.LLM_API_KEY = "";
process.env.LLM_MODEL = "gpt-4o-mini";
process.env.LLM_TYPE = "openai";
const {
    startThinkingAnimation,
    stopThinkingAnimation,
    startReadFileAnimation,
    stopReadFileAnimation,
} = require('./AgentUtil.js');

function convertHistory(chatHistory) {
    // The conversion logic was identical for both branches, so it has been simplified.
    return chatHistory.map(reply => {
        const convertedReply = {
            content: reply.message,
        };
        switch (reply.role) {
            case "human":
                convertedReply.role = "user";
                break;
            case "ai":
                convertedReply.role = "assistant";
                break;
            case "system":
                // Note: 'developer' is not a standard OpenAI role. 'system' is more common.
                convertedReply.role = "developer";
                break;
            default:
                convertedReply.role = reply.role; // Pass through any other roles
        }
        return convertedReply;
    });
}

async function callLLM(history) {
    // Ensure history is an array, default to empty if not provided
    const chatHistory = history || [];
    let convertedHistory = convertHistory(chatHistory);

    const thinkingId = startThinkingAnimation("Thinking");
    // Example of how you could start multiple, concurrent animations.
    // In a real scenario, this would be driven by agent logic.
    const readFileId1 = startReadFileAnimation("TestFile.js");
    const readFileId2 = startReadFileAnimation("AnotherFile.ts");
    try {
        const response = await fetch(process.env.LLM_BASE_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.LLM_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: process.env.LLM_MODEL, // Fixed typo: processs.env -> process.env
                messages: convertedHistory,
            }),
        });

        const data = await response.json();

        // Stop animations and collect receipt messages
        // SIMULATE ONE SUCCESS AND ONE FAILURE FOR DEMONSTRATION
        const receipt1 = stopReadFileAnimation(readFileId1); // Success
        const receipt2 = stopReadFileAnimation(readFileId2, new Error("File not found")); // Failure
        stopThinkingAnimation(thinkingId); // Stop animation on successful response

        // Now that animations are stopped, print the receipts
        if (receipt1) console.log(receipt1);
        if (receipt2) console.log(receipt2);

        if(data.error){
            throw new Error(JSON.stringify(data.error));
        }
        return data.choices[0].message.content;
    } catch (error) {
        // Stop animations and collect receipts, even on failure
        const receipt1 = stopReadFileAnimation(readFileId1, error);
        const receipt2 = stopReadFileAnimation(readFileId2, error);
        stopThinkingAnimation(thinkingId);

        if (receipt1) console.log(receipt1);
        if (receipt2) console.log(receipt2);
        console.error("Error calling LLM:", error);
        throw error; // Re-throw the error to be caught by the outer .catch
    }
}

module.exports = { callLLM };
