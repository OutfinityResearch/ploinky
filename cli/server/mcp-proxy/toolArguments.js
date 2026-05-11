function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeValueForSchema(value, schema) {
    if (!isPlainObject(schema)) {
        return value;
    }

    const type = typeof schema.type === 'string' ? schema.type : '';
    const isObjectSchema = type === 'object' || isPlainObject(schema.properties);
    if (isObjectSchema && isPlainObject(value)) {
        const properties = isPlainObject(schema.properties) ? schema.properties : {};
        const shouldStripUnknown = schema.additionalProperties === false;
        const output = shouldStripUnknown ? {} : { ...value };
        for (const [key, propertySchema] of Object.entries(properties)) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) {
                continue;
            }
            output[key] = sanitizeValueForSchema(value[key], propertySchema);
        }
        return output;
    }

    if (type === 'array' && Array.isArray(value)) {
        return value.map((entry) => sanitizeValueForSchema(entry, schema.items));
    }

    return value;
}

export function sanitizeArgumentsForInputSchema(args, inputSchema) {
    const normalizedArgs = isPlainObject(args) ? args : {};
    if (!isPlainObject(inputSchema)) {
        return normalizedArgs;
    }
    return sanitizeValueForSchema(normalizedArgs, inputSchema);
}

export function sanitizeArgumentsForTool(args, tools, toolName) {
    if (!Array.isArray(tools) || !toolName) {
        return sanitizeArgumentsForInputSchema(args, null);
    }
    const tool = tools.find((entry) => entry && entry.name === toolName);
    return sanitizeArgumentsForInputSchema(args, tool?.inputSchema || null);
}

export default {
    sanitizeArgumentsForInputSchema,
    sanitizeArgumentsForTool
};
