function convertContext(chatContext) {
    let convertedContext = [];
    for (let reply of chatContext) {
        let convertedReply = {
            content: reply.message
        }
        if(reply.role === "human") {
            convertedReply.role = "user";
        } else if(reply.role === "ai") {
            convertedReply.role = "assistant";
        } else if(reply.role === "system") {
            convertedReply.role = "developer";
        }
        convertedContext.push(convertedReply);
    }
    return convertedContext;
}
async function callLLM(chatContext, signal) {
    let convertedContext = convertContext(chatContext);
    const response = await fetch(process.env.LLM_BASE_URL, {
        method: "POST",
        headers: {
            "x-api-key": process.env.LLM_API_KEY,
            "anthropic-version" : "2023-06-01",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            "max_tokens": 1000,
            model: process.env.LLM_MODEL,
            messages: convertedContext,
        }),
        signal,
    });
    const data = await response.json();
    if(data.error){
        throw new Error(JSON.stringify(data.error));
    }
    return data.content[0].text;
}
module.exports = { callLLM };