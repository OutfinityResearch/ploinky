(() => {
  const body = document.body;
  const titleBar = document.getElementById('titleBar');
  const themeToggle = document.getElementById('themeToggle');
  const title = body.dataset.title || 'Dashboard';
  titleBar.textContent = title;

  function getTheme(){ return localStorage.getItem('webtty_theme') || 'dark'; }
  function setTheme(t){ document.body.setAttribute('data-theme', t); localStorage.setItem('webtty_theme', t); themeToggle.textContent = (t==='dark'?'Dark':'Light'); }
  themeToggle.onclick = ()=>{ const cur = getTheme(); setTheme(cur==='dark'?'light':'dark'); };
  setTheme(getTheme());

  // External links to Console/Chat servers (open in new tab)
  try {
    const loc = window.location;
    const host = loc.hostname || 'localhost';
    const proto = loc.protocol || 'http:';
    const consolePort = (localStorage.getItem('WEBTTY_PORT') || '9001');
    const chatPort = (localStorage.getItem('WEBCHAT_PORT') || '8080');
    const lnkConsole = document.getElementById('lnkConsole');
    const lnkChat = document.getElementById('lnkChat');
    if (lnkConsole) lnkConsole.href = `${proto}//${host}:${consolePort}/`;
    if (lnkChat) lnkChat.href = `${proto}//${host}:${chatPort}/`;
  } catch(_) {}

  const tabs = Array.from(document.querySelectorAll('.tabs-strip .t'));
  function setTab(name){ tabs.forEach(t => t.classList.toggle('active', t.dataset.tab===name)); ['status','logs','agents','control'].forEach(v => document.getElementById('view-'+v).classList.toggle('active', v===name)); }
  tabs.forEach(t => t.addEventListener('click', ()=> setTab(t.dataset.tab)));

  // /run helper
  async function run(cmd){ const res = await fetch('/run', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ cmd }) }); const j = await res.json().catch(()=>({ok:false})); return j; }

  // Status
  const statusOut = document.getElementById('statusOut');
  async function refreshStatus(){ const j = await run('status'); statusOut.textContent = (j.stdout || j.stderr || '[no output]'); }
  document.getElementById('refreshStatus').onclick = refreshStatus;
  refreshStatus();

  // Logs
  const logsOut = document.getElementById('logsOut');
  const logCount = document.getElementById('logCount');
  async function refreshLogs(){ const n = Math.max(1, parseInt(logCount.value||'200',10)); const j = await run(`last ${n}`); logsOut.textContent = j.stdout || j.stderr || '[no output]'; }
  setInterval(refreshLogs, 1000);
  refreshLogs();

  // Agents
  const agentsList = document.getElementById('agentsList');
  function parseAgentNames(text){ const names = new Set(); (text||'').split('\n').forEach(line => { const m = line.match(/\b([A-Za-z0-9_.-]{2,})\b/); if (m) names.add(m[1]); }); return Array.from(names); }
  async function refreshAgents(){ const j = await run('list agents'); const out = j.stdout || j.stderr || ''; const names = parseAgentNames(out); agentsList.innerHTML = ''; if (!names.length) { const d=document.createElement('div'); d.textContent='No agents found'; d.className='item'; agentsList.appendChild(d); return; } names.forEach(name => { const row = document.createElement('div'); row.className='item'; const left = document.createElement('div'); left.textContent = name; const btn = document.createElement('button'); btn.textContent = 'Start'; btn.onclick = async ()=>{ btn.disabled=true; const r = await run(`start ${name}`); const pre = document.createElement('pre'); pre.textContent = r.stdout || r.stderr || '[no output]'; agentsList.appendChild(pre); btn.disabled=false; }; row.appendChild(left); row.appendChild(btn); agentsList.appendChild(row); }); }
  document.getElementById('refreshAgents').onclick = refreshAgents;
  refreshAgents();

  // Control
  const ctrlOut = document.getElementById('ctrlOut');
  document.getElementById('restartBtn').onclick = async()=>{ ctrlOut.textContent='Restarting…'; const r = await run('restart'); ctrlOut.textContent = r.stdout || r.stderr || '[no output]'; };
})();
