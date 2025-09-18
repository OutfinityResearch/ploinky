
function convertContext(chatContext) {
    return chatContext.map(reply => {
        const role = reply.role === 'human' ? 'User' : 'Assistant';
        return `${role}: ${reply.message}`;
    }).join('\n') + '\nAssistant: '; // Prompt the model for the next turn
}
async function callLLM(chatContext, signal) {
    const apiToken = process.env.LLM_API_KEY;
    const apiUrl = `https://api-inference.huggingface.co/models/${process.env.LLM_MODEL}`;
    const headers = {
        "Content-Type": "application/json",
    };
    if (apiToken) {
        headers["Authorization"] = `Bearer ${apiToken}`;
    }
    const prompt = convertContext(chatContext);
    const payload = {
        inputs: prompt,
        parameters: {
            return_full_text: false, // Only return the generated part
            max_new_tokens: 500,
        }
    };
    const response = await fetch(apiUrl, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload),
        signal,
    });

    if (!response.ok) {
        const errorBody = await response.text();
        if (response.status === 503) {
            throw new Error("Hugging Face model is currently loading or unavailable (503 Service Unavailable). Please try again later.");
        }
        throw new Error(`Hugging Face API Error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();

    if (data.error) {
        throw new Error(`Hugging Face API Error: ${data.error}`);
    }
    return data[0]?.generated_text.trim();
}
module.exports = { callLLM };