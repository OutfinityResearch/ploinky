// Helpers for surfacing actionable error messages when an MCP tool subprocess
// exits non-zero. Tools written against this codebase write a JSON envelope
// (e.g. `{"ok":false,"error":"...","message":"..."}`) to stdout even on
// failure, so falling back to "command exited with code N" hides the real
// reason. This helper prefers explicit failure-envelope JSON, then stderr,
// then the code.

const MAX_FAILURE_MESSAGE_LENGTH = 4096;

function truncateMessage(message) {
    const text = String(message || '');
    if (text.length <= MAX_FAILURE_MESSAGE_LENGTH) return text;
    return `${text.slice(0, MAX_FAILURE_MESSAGE_LENGTH)}...`;
}

function parseJsonErrorMessage(stdout) {
    const trimmed = String(stdout || '').trim();
    if (!trimmed) return '';
    try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== 'object') return '';
        const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
        const errorField = typeof parsed.error === 'string' ? parsed.error.trim() : '';
        if (parsed.ok !== false && !errorField) return '';
        if (message && errorField && message !== errorField) {
            return `${errorField}: ${message}`;
        }
        return message || errorField || '';
    } catch (_) {
        return '';
    }
}

export function describeShellFailure(result) {
    const code = result?.code;
    const fromStdout = parseJsonErrorMessage(result?.stdout);
    if (fromStdout) return truncateMessage(fromStdout);
    const stderr = String(result?.stderr || '').trim();
    if (stderr) return truncateMessage(stderr);
    return `command exited with code ${code}`;
}
