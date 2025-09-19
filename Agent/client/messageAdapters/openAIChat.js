function toOpenAIChatMessages(chatContext = []) {
    const convertedContext = [];
    for (const reply of chatContext) {
        const normalized = {
            content: reply.message,
        };

        if (reply.role === 'human') {
            normalized.role = 'user';
        } else if (reply.role === 'ai') {
            normalized.role = 'assistant';
        } else if (reply.role === 'system') {
            normalized.role = 'developer';
        }

        convertedContext.push(normalized);
    }
    return convertedContext;
}

module.exports = {
    toOpenAIChatMessages,
};
