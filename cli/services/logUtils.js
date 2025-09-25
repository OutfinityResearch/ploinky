const fs = require('fs');
const path = require('path');

function getLogPath(kind) {
  const base = path.resolve('.ploinky/logs');
  const map = { router: 'router.log' };
  const file = map[kind] || map.router;
  return path.join(base, file);
}

async function logsTail(kind) {
  const file = getLogPath(kind);
  if (!fs.existsSync(file)) { console.log(`No log file yet: ${file}`); return; }
  try {
    const { spawn } = require('child_process');
    const p = spawn('tail', ['-f', file], { stdio: 'inherit' });
    await new Promise(resolve => p.on('exit', resolve));
  } catch (_) {
    console.log(`Following ${file} (fallback watcher). Stop with Ctrl+C.`);
    let pos = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    const loop = () => {
      try {
        const st = fs.statSync(file);
        if (st.size > pos) {
          const len = st.size - pos; const buf = Buffer.alloc(len);
          fs.readSync(fd, buf, 0, len, pos); process.stdout.write(buf.toString('utf8'));
          pos = st.size;
        }
      } catch (_) {}
      setTimeout(loop, 1000);
    };
    loop();
  }
}

function showLast(count, kind) {
  const n = Math.max(1, parseInt(count || '200', 10) || 200);
  const file = getLogPath('router');
  const list = [file];
  for (const f of list) {
    if (!fs.existsSync(f)) { console.log(`No log file: ${f}`); continue; }
    try {
      const { spawnSync } = require('child_process');
      const r = spawnSync('tail', ['-n', String(n), f], { stdio: 'inherit' });
      if (r.status !== 0) throw new Error('tail failed');
    } catch (e) {
      try {
        const data = fs.readFileSync(f, 'utf8');
        const lines = data.split('\n');
        const chunk = lines.slice(-n).join('\n');
        console.log(chunk);
      } catch (e2) {
        console.error(`Failed to read ${f}: ${e2.message}`);
      }
    }
  }
}

module.exports = {
  getLogPath,
  logsTail,
  showLast
};
