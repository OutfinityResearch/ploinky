const fs = require('fs');
const path = require('path');
const url = require('url');
const http = require('http');

const { loadToken, parseCookies, buildCookie, readJsonBody } = require('./common');
const staticSrv = require('../static');
const secretVars = require('../../services/secretVars');

const appName = 'webmeet';
const fallbackAppPath = path.join(__dirname, '../', appName);
const ROUTING_FILE = path.resolve('.ploinky/routing.json');

function loadRoutes() {
    try {
        const raw = fs.readFileSync(ROUTING_FILE, 'utf8');
        const cfg = JSON.parse(raw || '{}');
        return cfg.routes || {};
    } catch (_) {
        return {};
    }
}

function getMeetingAgent() {
    try {
        const agent = secretVars.resolveVarValue('WEBMEET_AGENT');
        return agent && String(agent).trim() ? String(agent).trim() : null;
    } catch (_) {
        return null;
    }
}

function extractAgentMessage(payload) {
    if (typeof payload === 'string') return payload;
    if (!payload || typeof payload !== 'object') return '';
    if (typeof payload.message === 'string') return payload.message;
    if (typeof payload.output === 'string') return payload.output;
    if (typeof payload.stdout === 'string') return payload.stdout;
    if (Array.isArray(payload.messages)) return payload.messages.join('\n');
    return JSON.stringify(payload);
}

function callAgent(agentName, data) {
    return new Promise((resolve, reject) => {
        const routes = loadRoutes();
        const route = routes[agentName];
        if (!route || !route.hostPort) {
            return reject(new Error('agent-not-available'));
        }
        const body = Buffer.from(JSON.stringify({ source: 'webmeet', agent: agentName, ...data }), 'utf8');
        const req = http.request({
            hostname: '127.0.0.1',
            port: route.hostPort,
            path: '/api',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': body.length
            }
        }, resp => {
            const chunks = [];
            resp.on('data', chunk => chunks.push(chunk));
            resp.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let parsed = raw;
                try { parsed = JSON.parse(raw); } catch (_) {}
                resolve({ status: resp.statusCode || 200, raw, parsed });
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

const DEFAULT_DEMO_SCRIPT = [
    { who: 'Moderator', text: 'Welcome to WebMeet! Paste your invite token to join.' },
    { who: 'Agent', text: 'Hello everyone, feel free to request the floor if you want to demo something.' }
];

// --- Auth ---
function getSession(req, appState) {
    const cookies = parseCookies(req);
    const sid = cookies.get(`${appName}_sid`);
    return (sid && appState.sessions.has(sid)) ? sid : null;
}

function authorized(req, appState) {
    return !!getSession(req, appState);
}

async function handleAuth(req, res, appConfig, appState) {
    try {
        const token = loadToken(appName);
        const body = await readJsonBody(req);
        if (body && body.token && String(body.token).trim() === token) {
            const sid = require('crypto').randomBytes(16).toString('hex');
            appState.sessions.set(sid, { tabs: new Map(), createdAt: Date.now() });
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Set-Cookie': buildCookie(`${appName}_sid`, sid, req, `/${appName}`)
            });
            res.end(JSON.stringify({ ok: true }));
        } else {
            res.writeHead(403);
            res.end('Forbidden');
        }
    } catch (_) {
        res.writeHead(400);
        res.end('Bad Request');
    }
}

// --- WebMeet Logic ---

function sseWrite(res, event, dataObj) {
    try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(dataObj || {})}\n\n`);
    } catch (_) {}
}

function broadcast(appState, event, data, exceptTabId = null) {
    for (const session of appState.sessions.values()) {
        for (const [tabId, tab] of session.tabs.entries()) {
            if (exceptTabId && tabId === exceptTabId) continue;
            if (tab.sseRes) sseWrite(tab.sseRes, event, data);
        }
    }
}

function sendToTab(appState, tabId, event, data) {
    for (const session of appState.sessions.values()) {
        const tab = session.tabs.get(tabId);
        if (tab && tab.sseRes) sseWrite(tab.sseRes, event, data);
    }
}


function listParticipants(appState) {
    return Array.from(appState.participants.values()).map(u => ({ tabId: u.tabId, name: u.name, email: u.email }));
}

function addChatMessage({ appState, fromTabId, text, type = 'text', role = 'user' }) {
    const source = appState.participants.get(fromTabId) || { name: 'Unknown', email: '', tabId: fromTabId };
    const msg = {
        id: appState.nextMsgId++,
        ts: Date.now(),
        from: { name: source.name, email: source.email, tabId: source.tabId ?? fromTabId },
        type,
        text: String(text || ''),
        role
    };
    appState.chatHistory.push(msg);
    broadcast(appState, 'chat', msg);
    return msg;
}


// --- Main Handler ---

function handleWebMeet(req, res, appConfig, appState) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname.substring(`/${appName}`.length) || '/';

    // Auth & Login
    if (pathname === '/auth' && req.method === 'POST') return handleAuth(req, res, appConfig, appState);
    if (pathname === '/whoami') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        return res.end(JSON.stringify({ok: authorized(req, appState)}));
    }

    if (pathname.startsWith('/assets/')) {
        const rel = pathname.substring('/assets/'.length);
        const assetPath = staticSrv.resolveAssetPath(appName, fallbackAppPath, rel);
        if (assetPath && staticSrv.sendFile(res, assetPath)) return;
    }

    if (!authorized(req, appState)) {
        const loginHtml = (() => {
            const content = staticSrv.resolveFirstAvailable(appName, fallbackAppPath, ['login.html', 'index.html']);
            if (!content) return null;
            let html = fs.readFileSync(content, 'utf-8');
            html = html.replace(/__ASSET_BASE__/g, `/${appName}/assets`);
            html = html.replace(/__AGENT_NAME__/g, appConfig.agentName || 'WebMeet');
            html = html.replace(/__CONTAINER_NAME__/g, appConfig.containerName || '-');
            html = html.replace(/__RUNTIME__/g, appConfig.runtime || 'local');
            html = html.replace(/__REQUIRES_AUTH__/g, 'true');
            html = html.replace(/__BASE_PATH__/g, `/${appName}`);
            return html;
        })();
        if (loginHtml) {
            res.writeHead(200, {'Content-Type': 'text/html'});
            return res.end(loginHtml);
        }
        res.writeHead(403); return res.end('Forbidden');
    }

    // Static Files
    if (pathname === '/' || pathname === '/index.html') {
        const pagePath = staticSrv.resolveFirstAvailable(appName, fallbackAppPath, ['webmeet.html', 'index.html']);
        if (pagePath) {
            let html = fs.readFileSync(pagePath, 'utf-8');
            html = html.replace(/__ASSET_BASE__/g, `/${appName}/assets`);
            html = html.replace(/__AGENT_NAME__/g, appConfig.agentName || 'WebMeet');
            html = html.replace(/__CONTAINER_NAME__/g, appConfig.containerName || '-');
            html = html.replace(/__RUNTIME__/g, appConfig.runtime || 'local');
            html = html.replace(/__REQUIRES_AUTH__/g, 'true');
            html = html.replace(/__BASE_PATH__/g, `/${appName}`);
            res.writeHead(200, {'Content-Type': 'text/html'});
            return res.end(html);
        }
    }

    if (pathname === '/demo') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, script: DEFAULT_DEMO_SCRIPT }));
    }

    // SSE Events
    if (pathname === '/events') {
        const sid = getSession(req, appState);
        const session = appState.sessions.get(sid);
        const tabId = parsedUrl.query.tabId;
        if (!session || !tabId) { res.writeHead(400); return res.end(); }

        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'Cache-Control': 'no-cache' });
        res.write(': connected\n\n');

        let tab = session.tabs.get(tabId);
        if (!tab) {
            tab = { sseRes: res, lastAt: Date.now() };
            session.tabs.set(tabId, tab);
        } else {
            tab.sseRes = res;
        }
        
        sseWrite(res, 'init', { 
            participants: listParticipants(appState), 
            queue: appState.queue, 
            currentSpeaker: appState.currentSpeaker, 
            history: appState.chatHistory.slice(-100),
            privateHistory: appState.privateHistory.get(tabId) || []
        });

        req.on('close', () => { 
            tab.sseRes = null;
            if (appState.participants.has(tabId)) {
                appState.participants.delete(tabId);
                broadcast(appState, 'participant_leave', { tabId });
            }
        });
        return;
    }

    // Actions
    if (pathname === '/action' && req.method === 'POST') {
        const sid = getSession(req, appState);
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const payload = JSON.parse(body);
                const { type, tabId } = payload;

                if (!tabId) {
                    res.writeHead(400); return res.end(JSON.stringify({ok: false, error: 'missing-tabId'}));
                }
                
                const reply = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj||{ok:true})); };

                if (type === 'hello') {
                    const user = { 
                        tabId,
                        name: String(payload.name || 'Anon'), 
                        email: String(payload.email || ''),
                        joinedAt: Date.now(),
                        lastAt: Date.now()
                    };
                    appState.participants.set(tabId, user);
                    broadcast(appState, 'participant_join', { participant: { tabId, name: user.name, email: user.email } });
                    return reply({ ok: true });
                }

                if (type === 'chat') {
                    const text = String(payload.text || '');
                    addChatMessage({ appState, fromTabId: tabId, text });

                    const agentName = getMeetingAgent();
                    if (agentName) {
                        try {
                            const result = await callAgent(agentName, { text, tabId });
                            if (result && result.status >= 200 && result.status < 300) {
                                const message = extractAgentMessage(result.parsed);
                                if (message) {
                                    addChatMessage({ appState, fromTabId: `agent:${agentName}`, text: message, role: 'agent' });
                                }
                            } else {
                                const errMsg = result ? result.raw : 'unknown error';
                                addChatMessage({ appState, fromTabId: 'system', text: `Agent '${agentName}' error: ${errMsg}`, role: 'system' });
                            }
                        } catch (err) {
                            addChatMessage({ appState, fromTabId: 'system', text: `Agent '${agentName}' unavailable (${err.message || err})`, role: 'system' });
                        }
                    }
                    return reply({ ok: true });
                }
                
                if (type === 'signal') {
                    const target = String(payload.target||"").trim();
                    const signalPayload = payload.payload || {};
                    sendToTab(appState, target, 'signal', { from: tabId, payload: signalPayload });
                    return reply({ ok: true });
                }

                if (type === 'request_speak') {
                    if (!appState.queue.includes(tabId)) {
                        appState.queue.push(tabId);
                    }
                    broadcast(appState, 'queue', { queue: appState.queue });
                    return reply({ ok: true });
                }

                if (type === 'stop_speaking') {
                    if (appState.currentSpeaker === tabId) {
                        appState.currentSpeaker = null;
                        broadcast(appState, 'current_speaker', { tabId: null });
                    }
                    return reply({ ok: true });
                }
                
                return reply({ ok: false, error: 'unknown-action' });

            } catch (e) {
                res.writeHead(400); res.end(JSON.stringify({ok: false, error: 'bad-request'}));
            }
        });
        return;
    }

    res.writeHead(404);
    res.end('Not Found in App');
}

module.exports = { handleWebMeet };
