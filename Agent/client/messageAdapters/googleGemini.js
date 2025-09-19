function toGeminiPayload(chatContext = []) {
    const contents = [];
    const systemInstruction = { parts: [] };

    for (const reply of chatContext) {
        if (reply.role === 'system') {
            systemInstruction.parts.push({ text: reply.message });
            continue;
        }

        const message = {
            parts: [{ text: reply.message }],
        };

        if (reply.role === 'human') {
            message.role = 'user';
        } else if (reply.role === 'ai') {
            message.role = 'model';
        }

        contents.push(message);
    }

    return { contents, systemInstruction };
}

module.exports = {
    toGeminiPayload,
};
