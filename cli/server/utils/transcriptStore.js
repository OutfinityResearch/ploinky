import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { resolveVarValue, setEnvVar } from '../../services/secretVars.js';
import {
    createWrappedDek,
    decryptMessagePayload,
    deriveMasterKey,
    encryptMessagePayload,
    unwrapDek,
} from './transcriptCrypto.js';

const TRANSCRIPT_DIR = path.resolve('.ploinky/transcripts');
const MASTER_KEY_VAR = 'PLOINKY_TRANSCRIPTS_MASTER_KEY';
const RETENTION_DAYS_VAR = 'PLOINKY_TRANSCRIPT_RETENTION_DAYS';
const DEFAULT_RETENTION_DAYS = 30;

function ensureDir() {
    fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
}

function readConfigValue(name) {
    const secret = resolveVarValue(name);
    if (secret && String(secret).trim()) {
        return String(secret).trim();
    }
    const env = process.env[name];
    return env && String(env).trim() ? String(env).trim() : '';
}

function getRetentionDays() {
    const raw = readConfigValue(RETENTION_DAYS_VAR);
    const parsed = parseInt(raw || '', 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
        return parsed;
    }
    return DEFAULT_RETENTION_DAYS;
}

function ensureMasterKey() {
    let raw = readConfigValue(MASTER_KEY_VAR);
    if (!raw) {
        raw = crypto.randomBytes(32).toString('base64');
        setEnvVar(MASTER_KEY_VAR, raw);
    }
    return deriveMasterKey(raw);
}

function hashIdentity(value, masterKey) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    return crypto.createHmac('sha256', masterKey).update(raw, 'utf8').digest('hex');
}

function getFilePath(conversationId) {
    return path.join(TRANSCRIPT_DIR, `${conversationId}.json`);
}

function loadConversationFile(conversationId) {
    const filePath = getFilePath(conversationId);
    const raw = fs.readFileSync(filePath, 'utf8');
    return { filePath, record: JSON.parse(raw) };
}

function saveConversationFile(filePath, record) {
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
}

function purgeExpired() {
    ensureDir();
    const now = Date.now();
    for (const entry of fs.readdirSync(TRANSCRIPT_DIR, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const filePath = path.join(TRANSCRIPT_DIR, entry.name);
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            const record = JSON.parse(raw);
            if (record?.expiresAt && now > Date.parse(record.expiresAt)) {
                fs.unlinkSync(filePath);
            }
        } catch (_) {
            // Ignore malformed files.
        }
    }
}

function createConversation({
    agentName = '',
    runtime = '',
    authMode = '',
    sessionId = '',
    userId = '',
    tabId = ''
} = {}) {
    ensureDir();
    purgeExpired();
    const masterKey = ensureMasterKey();
    const { wrapped } = createWrappedDek(masterKey);
    const conversationId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const retentionDays = getRetentionDays();
    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const record = {
        version: 1,
        conversationId,
        createdAt: nowIso,
        updatedAt: nowIso,
        closedAt: null,
        expiresAt,
        agentName: String(agentName || '').trim(),
        runtime: String(runtime || '').trim(),
        authMode: String(authMode || '').trim(),
        sessionHash: hashIdentity(sessionId, masterKey),
        userHash: hashIdentity(userId, masterKey),
        tabHash: hashIdentity(tabId, masterKey),
        dek: wrapped,
        messages: []
    };
    const filePath = getFilePath(conversationId);
    saveConversationFile(filePath, record);
    return {
        conversationId,
        retentionDays
    };
}

function appendMessage(conversationId, {
    role,
    text = '',
    attachments = [],
    metadata = {}
} = {}) {
    ensureDir();
    purgeExpired();
    const masterKey = ensureMasterKey();
    const { filePath, record } = loadConversationFile(conversationId);
    const dek = unwrapDek(masterKey, record.dek);
    const messageId = crypto.randomUUID();
    const encrypted = encryptMessagePayload(dek, {
        text: typeof text === 'string' ? text : '',
        attachments: Array.isArray(attachments) ? attachments : [],
        metadata: metadata && typeof metadata === 'object' ? metadata : {}
    });
    const createdAt = new Date().toISOString();
    record.messages.push({
        messageId,
        role: role === 'user' ? 'user' : 'assistant',
        createdAt,
        rating: null,
        ...encrypted
    });
    record.updatedAt = createdAt;
    saveConversationFile(filePath, record);
    return {
        conversationId,
        messageId,
        createdAt
    };
}

function appendToMessage(conversationId, messageId, text) {
    const extraText = typeof text === 'string' ? text : '';
    if (!extraText.trim()) {
        return false;
    }
    const masterKey = ensureMasterKey();
    const { filePath, record } = loadConversationFile(conversationId);
    const dek = unwrapDek(masterKey, record.dek);
    const message = record.messages.find((item) => item.messageId === messageId);
    if (!message) {
        return false;
    }
    const payload = decryptMessagePayload(dek, message);
    payload.text = payload.text ? `${payload.text}\n${extraText}` : extraText;
    const encrypted = encryptMessagePayload(dek, payload);
    message.iv = encrypted.iv;
    message.ciphertext = encrypted.ciphertext;
    message.authTag = encrypted.authTag;
    record.updatedAt = new Date().toISOString();
    saveConversationFile(filePath, record);
    return true;
}

function setMessageRating(conversationId, messageId, rating) {
    const normalized = rating === 'up' || rating === 'down' ? rating : null;
    const { filePath, record } = loadConversationFile(conversationId);
    const message = record.messages.find((item) => item.messageId === messageId);
    if (!message) {
        return false;
    }
    message.rating = normalized;
    record.updatedAt = new Date().toISOString();
    saveConversationFile(filePath, record);
    return true;
}

function setTurnRating(conversationId, assistantMessageId, rating) {
    const normalized = rating === 'up' || rating === 'down' ? rating : null;
    const masterKey = ensureMasterKey();
    const { filePath, record } = loadConversationFile(conversationId);
    const dek = unwrapDek(masterKey, record.dek);
    const assistantMessage = record.messages.find((item) => item.messageId === assistantMessageId);
    if (!assistantMessage || assistantMessage.role !== 'assistant') {
        return false;
    }

    const assistantPayload = decryptMessagePayload(dek, assistantMessage);
    const assistantMetadata = assistantPayload?.metadata && typeof assistantPayload.metadata === 'object'
        ? assistantPayload.metadata
        : {};
    const promptMessageId = typeof assistantMetadata.promptMessageId === 'string'
        ? assistantMetadata.promptMessageId.trim()
        : '';
    const turnId = typeof assistantMetadata.turnId === 'string'
        ? assistantMetadata.turnId.trim()
        : '';

    assistantMessage.rating = normalized;
    assistantMetadata.pairRating = normalized;
    assistantPayload.metadata = assistantMetadata;
    {
        const encrypted = encryptMessagePayload(dek, assistantPayload);
        assistantMessage.iv = encrypted.iv;
        assistantMessage.ciphertext = encrypted.ciphertext;
        assistantMessage.authTag = encrypted.authTag;
    }

    if (promptMessageId) {
        const userMessage = record.messages.find((item) => item.messageId === promptMessageId && item.role === 'user');
        if (userMessage) {
            userMessage.rating = normalized;
            const userPayload = decryptMessagePayload(dek, userMessage);
            const userMetadata = userPayload?.metadata && typeof userPayload.metadata === 'object'
                ? userPayload.metadata
                : {};
            if (turnId && !userMetadata.turnId) {
                userMetadata.turnId = turnId;
            }
            userMetadata.replyMessageId = assistantMessageId;
            userMetadata.pairRating = normalized;
            userPayload.metadata = userMetadata;
            const encrypted = encryptMessagePayload(dek, userPayload);
            userMessage.iv = encrypted.iv;
            userMessage.ciphertext = encrypted.ciphertext;
            userMessage.authTag = encrypted.authTag;
        }
    }

    record.updatedAt = new Date().toISOString();
    saveConversationFile(filePath, record);
    return true;
}

function closeConversation(conversationId) {
    const { filePath, record } = loadConversationFile(conversationId);
    const nowIso = new Date().toISOString();
    record.closedAt = nowIso;
    record.updatedAt = nowIso;
    saveConversationFile(filePath, record);
}

function listConversations({ limit = 50 } = {}) {
    ensureDir();
    purgeExpired();
    const files = fs.readdirSync(TRANSCRIPT_DIR)
        .filter((name) => name.endsWith('.json'))
        .map((name) => path.join(TRANSCRIPT_DIR, name));
    const records = [];
    for (const filePath of files) {
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            const record = JSON.parse(raw);
            records.push({
                conversationId: record.conversationId,
                agentName: record.agentName || '',
                runtime: record.runtime || '',
                authMode: record.authMode || '',
                createdAt: record.createdAt,
                updatedAt: record.updatedAt,
                closedAt: record.closedAt || null,
                expiresAt: record.expiresAt || null,
                messageCount: Array.isArray(record.messages) ? record.messages.length : 0,
                userMessages: Array.isArray(record.messages) ? record.messages.filter((item) => item.role === 'user').length : 0,
                assistantMessages: Array.isArray(record.messages) ? record.messages.filter((item) => item.role === 'assistant').length : 0,
            });
        } catch (_) {
            // Ignore malformed files.
        }
    }
    records.sort((left, right) => Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0));
    return {
        retentionDays: getRetentionDays(),
        conversations: records.slice(0, Math.max(1, Number(limit) || 50))
    };
}

function getConversation(conversationId) {
    purgeExpired();
    const masterKey = ensureMasterKey();
    const { record } = loadConversationFile(conversationId);
    const dek = unwrapDek(masterKey, record.dek);
    return {
        conversationId: record.conversationId,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        closedAt: record.closedAt || null,
        expiresAt: record.expiresAt || null,
        agentName: record.agentName || '',
        runtime: record.runtime || '',
        authMode: record.authMode || '',
        retentionDays: getRetentionDays(),
        messages: (record.messages || []).map((message) => {
            const payload = decryptMessagePayload(dek, message);
            return {
                messageId: message.messageId,
                role: message.role,
                createdAt: message.createdAt,
                rating: message.rating || null,
                text: payload?.text || '',
                attachments: Array.isArray(payload?.attachments) ? payload.attachments : [],
                metadata: payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}
            };
        })
    };
}

export {
    appendMessage,
    appendToMessage,
    closeConversation,
    createConversation,
    getConversation,
    getRetentionDays,
    listConversations,
    setMessageRating,
    setTurnRating,
};
