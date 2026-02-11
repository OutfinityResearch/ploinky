# Review specificatii vs implementare (`docs/specs` vs `cli`)

Data: 2026-02-09

## Scope si metoda
- Analiza statica pe codul din `cli/` si documentatia din `docs/specs/`.
- Mapare automata pentru fisierele de spec care au `## Source File`.
- Rezultat mapare: `107` spec-uri cu `Source File`, `107` fisiere `cli/*` mapate, `0` spec-uri fara implementare.
- Fisiere `cli/*` fara spec dedicat: `27`.

## Probleme critice de securitate

### 1) `OPENAI_API_KEY` este expus direct catre browser
- Evidenta implementare: `cli/server/handlers/webchat.js:254` returneaza cheia reala in `client_secret.value`.
- Evidenta spec: `docs/specs/src/cli/server/webchat/strategies/stt/server-webchat-strategies-stt-openai-realtime.md:5` afirma utilizare de token-uri efemere.
- Impact: compromitere API key (cost, acces neautorizat la API, reuse in afara aplicatiei).
- Status: contradictie intre obiectivul de securitate si implementarea curenta.

### 2) Control incomplet pentru token-urile de agent pe endpoint-ul agregat `/mcp`
- Evidenta implementare: `cli/server/RoutingServer.js:187` autentifica bearer-ul pentru `/mcp` si `/mcps/*`, dar pentru `/mcp` ajunge in `handleRouterMcp` fara verificare `allowedTargets` (`cli/server/RoutingServer.js:224`).
- Evidenta implementare buna, dar doar pe ruta per-agent: `cli/server/mcp-proxy/index.js:154` valideaza `allowedTargets`.
- Evidenta suplimentara: validarea bearer in `ensureAgentAuthenticated` nu verifica `aud/clientId` (`cli/server/authHandlers.js:123`, `cli/server/auth/service.js:291`).
- Impact: un token valid la nivel de issuer poate avea acces mai larg decat ar trebui prin agregator.

## Probleme high severity

### 3) Lipsa limitelor de marime pentru body (DoS memory)
- Evidenta: `cli/server/handlers/common.js:76` (`readJsonBody`) si `cli/server/handlers/common.js:106` (`parseMultipartFormData`) acumuleaza body integral in memorie.
- Impact: request-uri mari pot consuma excesiv memoria procesului router.

### 4) Open redirect / header trust in fluxul SSO
- Evidenta: `returnTo` este preluat direct (`cli/server/authHandlers.js:193`) si folosit ca redirect (`cli/server/authHandlers.js:216`).
- Evidenta: baza URL este derivata direct din `x-forwarded-host` / `host` (`cli/server/authHandlers.js:21`).
- Impact: phishing/open-redirect si posibile URL-uri de callback construite pe host nevalidat.

### 5) Bug la `Max-Age` pentru cookie clearing
- Evidenta: `const maxAge = options.maxAge || 604800` in `cli/server/handlers/common.js:71`.
- Impact: `maxAge: 0` nu functioneaza cum se asteapta pentru expirare imediata (logout/clear-cookie devine inconsistent).

## Probleme medium severity

### 6) `/dashboard/run` executa orice subcomanda `ploinky`
- Evidenta: `cli/server/handlers/dashboard.js:143` parseaza `cmd` din request si ruleaza `spawn('ploinky', args, ...)`.
- Impact: suprafata mare de actiuni sensibile in browser (chiar daca necesita autentificare).

### 7) XSS potential in UI status prin `innerHTML` cu date ne-escape-uite
- Evidenta: `cli/server/status/status.js:68`, `cli/server/status/status.js:75`, `cli/server/status/status.js:84`, `cli/server/status/status.js:91`.
- Impact: daca valori din datele de status ajung contaminate, se poate injecta HTML/script.

### 8) Executie shell extinsa din manifest/profile hooks
- Evidenta: `cli/services/lifecycleHooks.js:86` ruleaza inline command cu `execSync(..., shell: true)`.
- Impact: designul permite executie arbitrara de comenzi host/container din profile; e ok doar daca sursa manifest/profile este total de incredere.

## Nepotriviri specificatii vs implementare

### A) DS05 documenteaza comenzi/forme vechi
- Spec: `docs/specs/DS/DS05-cli-commands.md:463` (`run <agent> [command]`), `:479` (`webtty [agent] [token]`), `:493` (`webchat [agent] [token]`), exemple cu `/webtty/<agent>`.
- Cod: `cli/commands/cli.js:203` arata ca `run` legacy este scos; `cli/commands/cli.js:246` arata ca argumentele pentru `webchat` au fost eliminate.
- Concluzie: DS05 nu mai reflecta comportamentul actual al CLI.

### B) DS02 descrie un model de autentificare diferit de cel implementat
- Spec: `docs/specs/DS/DS02-architecture.md:385` spune verificare token direct din query/cookie/header in router.
- Cod: autentificarea legacy pentru web apps se face prin login page -> `POST /<app>/auth` -> sesiune cookie (`cli/server/handlers/webchat.js:308`, `cli/server/handlers/webtty.js:86`, `cli/server/handlers/dashboard.js:86`).
- Concluzie: fluxul din DS02 este incomplet/depasit fata de implementare.

### C) Divergenta de port implicit
- Spec: `docs/specs/DS/DS02-architecture.md:349` mentioneaza default `ROUTER_PORT=8088`.
- Cod: default efectiv este `8080` (`cli/services/workspaceUtil.js:115`, `cli/server/RoutingServer.js:318`).

### D) DS07 mentioneaza `maxRequestSize`, dar in router nu exista enforcement
- Spec: `docs/specs/DS/DS07-mcp-protocol.md:515` mentioneaza `maxRequestSize: '10mb'`.
- Cod router: parser-ele HTTP locale nu aplica limita (`cli/server/handlers/common.js:76`, `cli/server/routerHandlers.js:675`, `cli/server/mcp-proxy/index.js:190`).

## Implementari fara specificatii clare (`cli` fara `Source File` in specs)

Fisiere identificate (`27`):
- `cli/package.json`
- `cli/server/dashboard/dashboard.css`
- `cli/server/dashboard/dashboard.html`
- `cli/server/dashboard/dashboard.js`
- `cli/server/dashboard/login.html`
- `cli/server/dashboard/login.js`
- `cli/server/handlers/ttsStrategies/index.js`
- `cli/server/handlers/ttsStrategies/noop.js`
- `cli/server/handlers/ttsStrategies/openai.js`
- `cli/server/status/login.html`
- `cli/server/status/login.js`
- `cli/server/status/status.css`
- `cli/server/status/status.html`
- `cli/server/status/status.js`
- `cli/server/webchat/chat.html`
- `cli/server/webchat/login.html`
- `cli/server/webchat/login.js`
- `cli/server/webchat/markdown.js`
- `cli/server/webchat/tty.js`
- `cli/server/webchat/webchat.css`
- `cli/server/webmeet/login.html`
- `cli/server/webmeet/webmeet-favicon.svg`
- `cli/server/webmeet/webmeet.css`
- `cli/server/webmeet/webmeet.html`
- `cli/server/webtty/login.html`
- `cli/server/webtty/webtty.css`
- `cli/server/webtty/webtty.html`

## Complexitate inutila / cost de mentenanta

### 1) Duplicare a logicii de auth/session in handlers web
- Exemple: `webtty`, `webchat`, `dashboard`, `webmeet` au fluxuri foarte similare (`handleAuth`, `authorized`, `ensureAppSession`).
- Efect: bugfix-uri de securitate trebuie replicate in 4 locuri.

### 2) Duplicare login token parsing in 5 fisiere UI
- Exemple: `cli/server/webtty/login.js`, `cli/server/webchat/login.js`, `cli/server/dashboard/login.js`, `cli/server/webmeet/login.js`, `cli/server/status/login.js`.
- Efect: inconsistente de UX/securitate apar usor.

### 3) Fisiere monolitice cu responsabilitati mixte
- Exemple: `cli/services/dependencyInstaller.js`, `cli/services/docker/agentServiceManager.js`, `cli/services/workspaceUtil.js`.
- Efect: testare dificila, risc mai mare la schimbari mici.

## Taskuri propuse pentru remediere

### P0 (urgent)
1. Inlocuieste returnarea cheii OpenAI brute din `/webchat/realtime-token` cu token efemer server-side (si adauga expirare scurta + scope strict).
2. Impune autorizare pe `/mcp` pentru tokenuri de agent: aplica `allowedTargets` si pe endpoint-ul agregat.
3. Extinde validarea JWT pentru agent auth: issuer + audience/client + tip token/claim specific agent.
4. Adauga limite de body size pentru JSON/multipart in toate endpoint-urile HTTP care citesc payload brut.

### P1 (important)
1. Corecteaza `buildCookie` pentru `maxAge: 0` (`??` in loc de `||`) si adauga test de regresie pentru logout/clear-cookie.
2. Normalizeaza/valideaza `returnTo` si host headers in SSO (allowlist relative paths + trusted proxy config).
3. Restrange `/dashboard/run` la o allowlist de comenzi sigure sau muta pe endpoint-uri explicite (`status`, `logs`, `restart`).
4. Escape UI data in `status.js` (evita `innerHTML` pentru campuri provenite din runtime data).

### P2 (aliniere spec + reducere complexitate)
1. Actualizeaza `DS05-cli-commands.md` la semantica reala (`run` removed, web commands behavior actual).
2. Actualizeaza `DS02-architecture.md` pentru fluxul real de auth (legacy login + cookie session + SSO flow) si port implicit real.
3. Clarifica in `DS07` daca limita `maxRequestSize` este obligatorie pentru router; daca da, implementeaz-o explicit.
4. Adauga spec-uri pentru cele 27 fisiere nespecificate sau marcheaza explicit ce fisiere sunt "implementation detail / no-spec".
5. Extrage module comune: auth/session web handler, login token parser shared, util comun pentru request body parsing cu limite.

## Concluzie scurta
- Specificatiile de tip `src/cli/*` sunt in general aliniate cu implementarea (0 surse lipsa).
- Problemele majore sunt in zona de securitate operationala si in documentatia DS (contradictii/outdated behavior).
