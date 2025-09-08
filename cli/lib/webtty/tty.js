const { spawn } = require('child_process');

function createTTYSession({ runtime, containerName, ptyLib }) {
  const execArgs = ['exec', '-it', '-w', '/agent', containerName, 'sh'];
  const env = { ...process.env, TERM: 'xterm-256color' };

  let isPTY = false;
  let ptyProc = null;
  let childProc = null;
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

  if (ptyLib) {
    try {
      ptyProc = ptyLib.spawn(runtime, execArgs, {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env,
      });
      isPTY = true;
      ptyProc.onData(emitOutput);
      ptyProc.onExit(() => emitClose());
    } catch (_) {
      // fallthrough to non-pty
    }
  }

  if (!isPTY) {
    childProc = spawn(runtime, execArgs, { env });
    childProc.stdout.on('data', emitOutput);
    childProc.stderr.on('data', emitOutput);
    childProc.on('close', () => emitClose());
  }

  return {
    isPTY,
    onOutput(handler) { if (handler) outputHandlers.add(handler); return () => outputHandlers.delete(handler); },
    onClose(handler) { if (handler) closeHandlers.add(handler); return () => closeHandlers.delete(handler); },
    write(data) {
      if (isPTY) {
        try { ptyProc?.write?.(data); } catch (_) {}
      } else {
        try { childProc?.stdin?.write?.(data); } catch (_) {}
      }
    },
    resize(cols, rows) {
      if (!cols || !rows) return;
      if (isPTY) {
        try { ptyProc?.resize?.(cols, rows); } catch (_) {}
      } else {
        // Best-effort resize inside the shell when not using node-pty
        try { childProc?.stdin?.write?.(`stty cols ${cols} rows ${rows}\n`); } catch (_) {}
      }
    },
  };
}

module.exports = { createTTYSession };

