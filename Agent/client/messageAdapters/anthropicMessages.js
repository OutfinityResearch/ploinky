const { toOpenAIChatMessages } = require('./openAIChat');

function toAnthropicMessages(chatContext = []) {
    return toOpenAIChatMessages(chatContext);
}

module.exports = {
    toAnthropicMessages,
};
