function convertContext(chatContext) {
    let convertedContext = [];
    let systemInstruction = {parts:[]}
    for (let reply of chatContext) {
        let convertedReply = {
            parts: [{text: reply.message}]
        }
        if (reply.role === "human") {
            convertedReply.role = "user";
        } else if (reply.role === "ai") {
            convertedReply.role = "model";
        } else if (reply.role === "system") {
            systemInstruction.parts.push({text: reply.message});
            continue;
        }
        convertedContext.push(convertedReply);
    }
    return {contents: convertedContext, systemInstruction:systemInstruction};
}
async function callLLM(chatContext) {
    let convertedContext = convertContext(chatContext);
    let result;
    result = await fetch(process.env.LLM_BASE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(convertedContext)
    });
    let responseJSON = await result.json();
    if(responseJSON.error){
        throw new Error(JSON.stringify(responseJSON.error));
    }
    let textResponse = responseJSON.candidates[0].content.parts[0].text;
    return textResponse;
}
module.exports = { callLLM };