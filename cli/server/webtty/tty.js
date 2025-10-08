import { buildExecArgs } from '../../services/docker/index.js';

function createTTYFactory({ runtime, containerName, ptyLib, workdir, entry }) {
  const DEBUG = process.env.WEBTTY_DEBUG === '1';
  const log = (...args) => { if (DEBUG) console.log('[webtty][tty]', ...args); };
  const factory = () => {
    const wd = workdir || process.cwd();
    const env = { ...process.env, TERM: 'xterm-256color' };
    const shellCmd = entry && String(entry).trim()
      ? entry
      : "(command -v /bin/bash >/dev/null 2>&1 && exec /bin/bash) || exec /bin/sh";
    const execArgs = buildExecArgs(containerName, wd, shellCmd, true);
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

    if (!ptyLib) throw new Error("'node-pty' is required for console sessions.");
    try {
      ptyProc = ptyLib.spawn(runtime, execArgs, {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env
      });
      isPTY = true;
      log('spawned PTY', { runtime, containerName, entry: entry || 'sh' });
      ptyProc.onData(emitOutput);
      ptyProc.onExit(() => {
        log('pty exit');
        emitClose();
      });
    } catch (e) {
      log('pty spawn failed', e?.message || e);
      throw e;
    }

    return {
      isPTY,
      onOutput(handler) {
        if (handler) outputHandlers.add(handler);
        return () => outputHandlers.delete(handler);
      },
      onClose(handler) {
        if (handler) closeHandlers.add(handler);
        return () => closeHandlers.delete(handler);
      },
      write(data) {
        if (DEBUG) log('write', { bytes: Buffer.byteLength(data || '') });
        try { ptyProc?.write?.(data); } catch (e) { log('write error', e?.message || e); }
      },
      resize(cols, rows) {
        if (!cols || !rows) return;
        try { ptyProc?.resize?.(cols, rows); }
        catch (e) { log('resize error', e?.message || e); }
        if (DEBUG) log('resized', { cols, rows, pty: isPTY });
      },
      close() {
        try { ptyProc?.kill?.(); } catch (_) {}
      }
    };
  };

  return { create: factory };
}

export { createTTYFactory };

function createLocalTTYFactory({ ptyLib, workdir, command }) {
  const DEBUG = process.env.WEBTTY_DEBUG === '1';
  const log = (...args) => { if (DEBUG) console.log('[webtty][tty-local]', ...args); };
  const factory = () => {
    const wd = workdir || process.cwd();
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

    const hasCustom = !!(command && String(command).trim());
    const parentShell = process.env.WEBTTY_SHELL || process.env.SHELL || '/bin/sh';
    const entry = hasCustom
      ? String(command)
      : 'command -v /bin/bash >/dev/null 2>&1 && exec /bin/bash || exec /bin/sh';
    const shCmd = `cd '${wd}' && ${entry}`;

    if (!ptyLib) throw new Error("'node-pty' is required for local console sessions.");
    try {
      ptyProc = ptyLib.spawn(parentShell, ['-lc', shCmd], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: wd,
        env
      });
      isPTY = true;
      log('spawned PTY local', { entry });
      ptyProc.onData(emitOutput);
      ptyProc.onExit(() => {
        log('pty exit');
        emitClose();
      });
    } catch (e) {
      log('pty spawn failed', e?.message || e);
      throw e;
    }

    return {
      isPTY,
      onOutput(handler) {
        if (handler) outputHandlers.add(handler);
        return () => outputHandlers.delete(handler);
      },
      onClose(handler) {
        if (handler) closeHandlers.add(handler);
        return () => closeHandlers.delete(handler);
      },
      write(data) {
        if (DEBUG) log('write', { bytes: Buffer.byteLength(data || '') });
        try { ptyProc?.write?.(data); } catch (e) { log('write error', e?.message || e); }
      },
      resize(cols, rows) {
        if (!cols || !rows) return;
        try { ptyProc?.resize?.(cols, rows); }
        catch (e) { log('resize error', e?.message || e); }
        if (DEBUG) log('resized', { cols, rows, pty: isPTY });
      },
      close() {
        try { ptyProc?.kill?.(); } catch (_) {}
      }
    };
  };

  return { create: factory };
}

export { createLocalTTYFactory };
