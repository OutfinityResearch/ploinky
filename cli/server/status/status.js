(() => {
  const body = document.body;
  const titleBar = document.getElementById('titleBar');
  const themeToggle = document.getElementById('themeToggle');
  const statusOut = document.getElementById('statusOut');
  const statusLabel = document.getElementById('statusLabel');
  const statusDot = document.getElementById('statusDot');
  const serversList = document.getElementById('serversList');
  const agentsList = document.getElementById('agentsList');
  const linksList = document.getElementById('linksList');

  const agentName = body.dataset.agent || 'Status';
  titleBar.textContent = `${agentName} Status`;

  const basePath = String(body.dataset.base || '').replace(/\/$/, '');
  const toEndpoint = (path) => {
    const suffix = String(path || '').replace(/^\/+/, '');
    return (basePath ? basePath : '') + '/' + suffix;
  };

  function getTheme() {
    return localStorage.getItem('status_theme') || 'light';
  }

  function setTheme(theme) {
    body.setAttribute('data-theme', theme);
    localStorage.setItem('status_theme', theme);
  }

  themeToggle.addEventListener('click', () => {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  });
  setTheme(getTheme());

  async function refreshStatus() {
    try {
      statusLabel.textContent = 'updating…';
      statusDot.style.background = '#ffb020';
      const res = await fetch(toEndpoint('data'));
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      const output = data.output || '[no output]';
      statusOut.textContent = output;
      statusLabel.textContent = data.code === 0 ? 'ok' : 'check output';
      statusDot.style.background = data.code === 0 ? '#00a884' : '#ffb020';
      renderServers(data.servers || {}, data.static || {});
      renderLinks(data.servers || {}, data.static || {});
      renderAgents(data.agents || []);
    } catch (err) {
      statusLabel.textContent = 'error';
      statusDot.style.background = '#f15c6d';
      statusOut.textContent = `Failed to retrieve status.\n${err?.message || err}`;
      if (serversList) serversList.innerHTML = '<div class="ps-item">No data</div>';
      if (agentsList) agentsList.innerHTML = '<div class="ps-item">No data</div>';
    }
  }

  function renderServers(servers, staticInfo) {
    if (!serversList) return;
    const entries = Object.entries(servers || {});
    const cards = entries.map(([key, info]) => {
      const name = info.displayName || key;
      const configured = Boolean(info.hasToken || info.agent || info.command || info.port);
      const pillClass = configured ? '' : ' default';
      const label = configured ? 'configured' : 'default (built-in)';
      const details = [];
      if (info.port) details.push(`port ${info.port}`);
      if (info.pid) details.push(`pid ${info.pid}`);
      return `<div class="ps-item"><div class="ps-item-title">${name}<span class="ps-pill${pillClass}">${label}</span></div><div class="ps-item-status">${details.join(' • ') || 'no extra details'}</div></div>`;
    });
    if (staticInfo && (staticInfo.agent || staticInfo.hostPath)) {
      const extras = [];
      if (staticInfo.agent) extras.push(`agent ${staticInfo.agent}`);
      if (staticInfo.hostPath) extras.push(staticInfo.hostPath);
      cards.push(`<div class="ps-item"><div class="ps-item-title">Static Assets</div><div class="ps-item-status">${extras.join(' • ') || 'not configured'}</div></div>`);
    }
    if (!cards.length) {
      serversList.innerHTML = '<div class="ps-item">No servers tracked</div>';
      return;
    }
    serversList.innerHTML = cards.join('');
  }

 function renderLinks(servers, staticInfo) {
    if (!linksList) return;
    const entries = [
      { label: 'Dashboard', href: '/dashboard', note: 'through router' },
      { label: 'Web Console', href: '/webtty', note: 'through router' },
      { label: 'WebChat', href: '/webchat', note: 'through router' },
      { label: 'WebMeet', href: '/webmeet', note: servers.webmeet && servers.webmeet.agent ? `moderator ${servers.webmeet.agent}` : 'run "webmeet <agent>" to configure' }
    ];
    linksList.innerHTML = entries.map(entry => (
      `<a class="ps-link" href="${entry.href}" target="_blank" rel="noopener noreferrer">` +
        `<div class="ps-link-title">${entry.label}</div>` +
        `<div class="ps-link-note">${entry.note}</div>` +
      `</a>`
    )).join('');
  }

  function renderAgents(list) {
    if (!agentsList) return;
    if (!list.length) {
      agentsList.innerHTML = '<div class="ps-item">No agents enabled</div>';
      return;
    }
    agentsList.innerHTML = list.map(info => {
      const name = info.agentName || info.container;
      const repo = info.repoName ? `repo: ${info.repoName}` : 'no repo info';
      const image = info.image ? `image: ${info.image}` : '';
      const meta = [repo, image].filter(Boolean).join(' • ');
      return `<div class="ps-item"><div class="ps-item-title">${name}</div><div class="ps-item-status">${meta}</div></div>`;
    }).join('');
  }

  setInterval(refreshStatus, 4000);
  refreshStatus();
})();
