const { spawn } = require('child_process');

function createTTYSession({ runtime, containerName, ptyLib, workdir }) {
  const DEBUG = process.env.WEBTTY_DEBUG === '1';
  const log = (...args) => { if (DEBUG) console.log('[webtty][tty]', ...args); };
  const wd = workdir || process.cwd();
  const execArgs = ['exec', '-it', containerName, 'bash', '-lc', `cd '${wd}' && PS1='# ' exec bash --noprofile --norc`];
  const env = { ...process.env, TERM: 'xterm-256color' };

  let isPTY = false;
  let ptyProc = null;
  const outputHandlers = new Set();
  const closeHandlers = new Set();

  const emitOutput = (data) => {
    for (const h of outputHandlers) {
      try { h(data); } catch (_) {}
    }
  };
  const emitClose = () => {
    for (const h of closeHandlers) {
      try { h(); } catch (_) {}
    }
  };

  if (!ptyLib) {
    throw new Error("node-pty is required for WebTTY session");
  }
  try {
    ptyProc = ptyLib.spawn(runtime, execArgs, {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env,
    });
    isPTY = true;
    log('spawned PTY', { runtime, containerName });
    ptyProc.onData(emitOutput);
    ptyProc.onExit(() => { log('pty exit'); emitClose(); });
  } catch (e) {
    log('pty spawn failed', e?.message || e);
    throw e;
  }

  return {
    isPTY,
    onOutput(handler) { if (handler) outputHandlers.add(handler); return () => outputHandlers.delete(handler); },
    onClose(handler) { if (handler) closeHandlers.add(handler); return () => closeHandlers.delete(handler); },
    write(data) {
      if (DEBUG) log('write', { bytes: Buffer.byteLength(data || '') });
      try { ptyProc?.write?.(data); } catch (e) { log('write error', e?.message || e); }
    },
    resize(cols, rows) {
      if (!cols || !rows) return;
      try { ptyProc?.resize?.(cols, rows); } catch (e) { log('resize error', e?.message || e); }
      if (DEBUG) log('resized', { cols, rows, pty: isPTY });
    },
  };
}

module.exports = { createTTYSession };
