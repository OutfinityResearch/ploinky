function safeJsonParse(value) {
    if (typeof value !== 'string') {
        return value;
    }
    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
}

export {
    safeJsonParse,
};
