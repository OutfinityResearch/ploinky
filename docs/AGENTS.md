# Repository Guidelines

## Project Structure & Module Organization
- app entry: `index.html` (static page) and `app.js` (ES modules).
- components: `components/` organized by type (`page/`, `components/`, `base/`, `modals/`). Each component keeps `name/name.(js|html|css)`.
- services: `services/` for browser-side services (e.g., `LocalStorage.js`).
- styles: global CSS in `css/`; component styles live next to their component.
- framework config: `webskel.json` maps component names to presenter classes used by `WebSkel/` runtime.
- data: `posts.json` for bundled demo posts; `sources/` contains category folders with `config.json` and generated `posts.json`.

## Build, Test, and Development Commands
- Serve locally: from this folder, `python3 -m http.server 8080` then open `http://localhost:8080`.
- Alternative servers: `npx http-server -p 8080` or `npx serve .`.
- Generate posts (Node 18+): `node sources/generate.js sources/tech` (replace `tech` with a category). Writes/updates `sources/<category>/posts.json` by fetching RSS.
- Switch page at runtime: `window.webSkel.changeToDynamicPage('external-sources-settings-page', 'app')` for quick navigation during dev.

## Coding Style & Naming Conventions
- JavaScript: ES modules, 4-space indent, semicolons, prefer single quotes. Keep functions small and pure; avoid global state except where `WebSkel` requires (e.g., `window.webSkel`).
- Components: use kebab-case for component folders/files (e.g., `story-card`). Presenter class is PascalCase (e.g., `StoryCard`). Register new components in `webskel.json` with the correct `type` and `presenterClassName`.
- CSS: use existing variables and dark theme tokens; scope styles to the component root where possible.

## Testing Guidelines
- No test runner is configured. Use manual testing in a local server:
  - Verify initial load of `news-feed-page`, story navigation, and infinite scroll.
  - Test `External Sources` by adding/removing URLs and reloading; confirm merged posts appear.
  - Check responsive layout and dark theme across mobile/desktop widths.

## Commit & Pull Request Guidelines
- Commits: use clear, imperative messages; Conventional Commits encouraged (e.g., `feat: add story autoplay controls`, `fix: guard missing container in news feed`).
- Pull Requests: include a concise description, linked issues, test steps, and screenshots/GIFs for UI changes. Keep PRs focused and small.

## Security & Configuration Tips
- Only add trusted external `posts.json` URLs; RSS fetching in `sources/generate.js` runs client-side Node and should use HTTPS where available.
- Do not embed secrets; the app is static and uses IndexedDB for non-sensitive local state.
