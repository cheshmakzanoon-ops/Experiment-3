'use strict';
/**
 * Release smoke test, active only when MOTOBOUND_SMOKE_OUT is set (never by a
 * normal or Steam launch). It drives the real packaged game through its own UI
 * and writes a JSON report:
 *
 *   phase "write":   menu appears -> environment probe -> change a setting in
 *                    the real settings screen -> the save mirror file holds it
 *   phase "restore": (after the harness deleted Chromium's IndexedDB) the
 *                    setting is restored from the mirror into IndexedDB
 *   MOTOBOUND_SMOKE_DRIVE=1: (restore phase only; the write phase leaves the settings transition open) additionally start a practice session and count
 *                    rendered frames once the car is on track
 */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Real process memory of the whole app (Electron reports KiB), for the store requirements. */
function memory() {
  const processes = app.getAppMetrics().map((p) => ({
    type: p.type,
    pid: p.pid,
    workingSetMiB: Math.round(p.memory.workingSetSize / 1024),
    privateMiB: Math.round((p.memory.privateBytes ?? 0) / 1024),
    cpuPercent: Math.round(p.cpu.percentCPUUsage * 10) / 10,
  }));
  return {
    totalWorkingSetMiB: processes.reduce((n, p) => n + p.workingSetMiB, 0),
    totalPrivateMiB: processes.reduce((n, p) => n + p.privateMiB, 0),
    processes,
  };
}

async function run({ getWindow, out, mirrors, savesDir, steam, log, quit }) {
  const started = Date.now();
  const phase = process.env.MOTOBOUND_SMOKE_PHASE || 'write';
  const report = {
    phase,
    ok: false,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${process.platform}/${process.arch}`,
      packaged: app.isPackaged,
    },
    steam: { available: steam.available, reason: steam.reason },
    steps: [],
    consoleErrors: [],
    consoleWarnings: [],
    loadFailures: [],
    crashes: [],
  };
  const step = (name, detail) => {
    report.steps.push({ name, ms: Date.now() - started, ...detail });
    log(`smoke: ${name} ${JSON.stringify(detail ?? {})}`);
  };
  const win = getWindow();
  const wc = win.webContents;
  wc.on('console-message', (...args) => {
    const first = args[0];
    const params =
      first && typeof first === 'object' && 'message' in first
        ? first
        : { level: args[1], message: args[2], lineNumber: args[3], sourceId: args[4] };
    const level = params.level;
    const entry = `${params.message} (${path.basename(String(params.sourceId ?? ''))}:${params.lineNumber})`;
    if (level === 'error' || level === 3) report.consoleErrors.push(entry);
    else if (level === 'warning' || level === 2) report.consoleWarnings.push(entry);
  });
  wc.on('did-fail-load', (_e, code, description, url) =>
    report.loadFailures.push({ code, description, url }),
  );
  wc.on('render-process-gone', (_e, details) => report.crashes.push(details));
  const js = (code) => wc.executeJavaScript(code, true);
  const waitFor = async (label, code, timeoutMs, pollMs = 500) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let value = null;
      try {
        value = await js(code);
      } catch {
        value = null;
      }
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
      await sleep(pollMs);
    }
  };

  try {
    await waitFor(
      'menu',
      `(() => { const m = document.getElementById('menu'); return !!m && m.getClientRects().length > 0; })()`,
      420000,
    );
    step('menu-visible', {});
    await sleep(3000);
    report.memoryAtMenu = memory();

    const environment = await js(`(async () => {
      const result = { url: location.href, secure: isSecureContext, isolated: crossOriginIsolated };
      result.bridge = Boolean(window.motobound && window.motobound.desktop);
      result.bridgeApp = window.motobound && window.motobound.desktop && window.motobound.desktop.app;
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2');
        const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
        result.webgl2 = { ok: Boolean(gl), renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null };
      } catch (e) { result.webgl2 = { ok: false, error: String(e) }; }
      try {
        const source = 'self.onmessage = (e) => self.postMessage(e.data * 2)';
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const worker = new Worker(url, { type: 'module' });
        result.moduleWorker = await new Promise((resolve) => {
          worker.onmessage = (e) => resolve(e.data === 42);
          worker.onerror = () => resolve(false);
          worker.postMessage(21);
          setTimeout(() => resolve(false), 5000);
        });
        worker.terminate();
      } catch (e) { result.moduleWorker = String(e); }
      result.evalAllowedByCsp = (() => { try { new Function('return 1')(); return true; } catch (e) { return false; } })();
      result.audio = typeof AudioContext;
      result.getGamepads = typeof navigator.getGamepads;
      result.indexedDB = typeof indexedDB;
      try { localStorage.setItem('smoke', '1'); localStorage.removeItem('smoke'); result.localStorage = true; }
      catch (e) { result.localStorage = String(e); }
      result.offline = !navigator.onLine ? 'offline' : 'navigator.onLine=true (no requests are made; see blocked list)';
      return result;
    })()`);
    report.environment = environment;
    step('environment', { webgl2: environment.webgl2?.ok, bridge: environment.bridge });
    report.gpu = app.getGPUFeatureStatus();

    const readSaved = (key) => `(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('apex-formula', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('saved');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const value = await new Promise((resolve, reject) => {
        const tx = db.transaction('saved', 'readonly').objectStore('saved').get(${JSON.stringify(key)});
        tx.onsuccess = () => resolve(tx.result);
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return value === undefined ? null : { quickStart: value.quickStart, version: value.version };
    })()`;

    if (phase === 'write') {
      await js(`(async () => {
        const click = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text)?.click();
        click('GARAGE & SETTINGS');
        await new Promise((r) => setTimeout(r, 600));
        // A setting that needs no renderer rebuild, so the save lands within seconds even on a software GPU.
        const quick = document.querySelector('[name=quickStart]');
        quick.checked = true;
        quick.dispatchEvent(new Event('change', { bubbles: true }));
        click('APPLY & SAVE');
        return true;
      })()`);
      step('settings-applied', {});
      // The save follows the settings transition; wait for the real write rather than guessing.
      const deadline = Date.now() + 240000;
      while (!mirrors.main.keys().includes('settings') && Date.now() < deadline) await sleep(500);
      step('mirror-received-settings', { keys: mirrors.main.keys() });
      mirrors.main.flush();
      const file = path.join(savesDir, 'saves.json');
      const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
      report.mirror = {
        file,
        bytes: fs.statSync(file).size,
        revision: disk.revision,
        keys: Object.keys(disk.entries),
        settingsQuickStart: disk.entries.settings?.quickStart ?? null,
        backupExists: fs.existsSync(`${file}.bak`),
      };
      step('mirror-file', {
        keys: report.mirror.keys,
        quickStart: report.mirror.settingsQuickStart,
      });
      report.indexedDb = await js(readSaved('settings'));
      report.pass = {
        mirrorHasSettings: report.mirror.settingsQuickStart === true,
        indexedDbHasSettings: report.indexedDb?.quickStart === true,
      };
      // Ghost laps are Float32Arrays: they must survive the IPC hop and the JSON file, and (in the
      // restore phase) come back out of the mirror into IndexedDB as typed arrays.
      const probe = await js(`(async () => {
        const saves = window.motobound.desktop.saves;
        await saves.put('ghost:smoke-probe', { samples: new Float32Array([1.5, -2.25, 0.001]), nested: { n: 7 } }, 0);
        const all = await saves.load();
        const v = all.entries['ghost:smoke-probe'];
        return {
          kind: Object.prototype.toString.call(v && v.samples),
          values: v ? Array.from(v.samples) : null,
          nested: v ? v.nested.n : null,
        };
      })()`);
      mirrors.ghosts.flush();
      const ghostFile = path.join(savesDir, 'ghosts.json');
      report.ghostProbe = {
        ...probe,
        file: fs.existsSync(ghostFile) ? fs.statSync(ghostFile).size : 0,
      };
      step('typed-array-probe', report.ghostProbe);
      report.pass.typedArrayThroughIpc =
        probe.kind === '[object Float32Array]' && probe.values?.[0] === 1.5 && probe.nested === 7;
      report.pass.ghostFileWritten = report.ghostProbe.file > 0;
    } else {
      report.indexedDb = await js(readSaved('settings'));
      report.mirror = { keys: mirrors.main.keys() };
      step('restore-check', { indexedDb: report.indexedDb });
      const ghost = await js(`(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('apex-formula', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const v = await new Promise((resolve, reject) => {
          const tx = db.transaction('saved', 'readonly').objectStore('saved').get('ghost:smoke-probe');
          tx.onsuccess = () => resolve(tx.result);
          tx.onerror = () => reject(tx.error);
        });
        db.close();
        return v ? { kind: Object.prototype.toString.call(v.samples), values: Array.from(v.samples) } : null;
      })()`);
      report.ghostRestored = ghost;
      step('typed-array-restored', ghost ?? {});
      report.pass = {
        restoredIntoIndexedDb: report.indexedDb?.quickStart === true,
        typedArrayRestored: ghost?.kind === '[object Float32Array]' && ghost.values[1] === -2.25,
      };
    }

    if (process.env.MOTOBOUND_SMOKE_DRIVE === '1') {
      // The settings dialog is modal and leaves the menu inert; close it like a player would.
      await js(`(async () => {
        document.querySelector('[aria-label="Close settings"]')?.click();
        await new Promise((r) => setTimeout(r, 800));
        return !document.getElementById('settingsForm');
      })()`);
      const clicked = await js(`(async () => {
        const mode = document.getElementById('mode');
        if (mode) { mode.value = 'practice'; mode.dispatchEvent(new Event('change', { bubbles: true })); }
        const opponents = document.getElementById('opponents');
        if (opponents) { opponents.value = '3'; opponents.dispatchEvent(new Event('change', { bubbles: true })); }
        const enter = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('ENTER CIRCUIT'));
        enter && enter.click();
        return Boolean(enter);
      })()`);
      if (!clicked) throw new Error('ENTER CIRCUIT button not found');
      step('enter-circuit-clicked', {});
      const state = await waitFor(
        'driving',
        `(() => {
          const go = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'GO STRAIGHT TO LIGHTS');
          if (go && go.getClientRects().length) go.click();
          const d = window.apexDiagnostics && window.apexDiagnostics();
          return d && d.state === 'driving' ? 'driving' : null;
        })()`,
        900000,
        1000,
      );
      step('driving', { state });
      await sleep(5000);
      report.memoryDriving = memory();
      report.frames = await js(`new Promise((resolve) => {
        let n = 0; const t0 = performance.now();
        const tick = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else resolve({ frames: n, seconds: (performance.now() - t0) / 1000 }); };
        requestAnimationFrame(tick);
      })`);
      // Simulation cost per fixed step (worker, CPU only) and dropped steps: H.STEP_MS = 8, H.DROPPED = 9.
      report.simulation = await js(`(() => {
        const d = window.apexDiagnostics();
        const f = d.frame;
        return f ? { stepMs: f[8], droppedSteps: f[9], tick: f[11], cars: f[12], state: d.state } : null;
      })()`);
      report.pass.drivingSessionStarted = state === 'driving';
    }

    // Display mode round trip through the real bridge. Without a window manager (Xvfb) the OS may
    // ignore fullscreen requests, so this is recorded, not asserted.
    report.display = await js(`(async () => {
      const d = window.motobound.desktop.display;
      const read = async () => ({ ...(await d.get()), inner: [innerWidth, innerHeight], screen: [screen.width, screen.height] });
      const before = await read();
      await d.set('fullscreen');
      await new Promise((r) => setTimeout(r, 1500));
      const fullscreen = await read();
      await d.set('windowed');
      await new Promise((r) => setTimeout(r, 1500));
      const windowed = await read();
      return { before, fullscreen, windowed };
    })()`);
    step('display-roundtrip', report.display);

    // The demo/leaderboard bridge calls reach the shell and answer without Steam. The store call
    // itself is not made here: with an app id staged it would open a browser (src/store-link.cjs).
    report.releaseBridge = await js(`(async () => {
      const d = window.motobound.desktop;
      const lb = d.steam.leaderboards ? await d.steam.leaderboards.status() : null;
      const bad = d.steam.leaderboards
        ? await d.steam.leaderboards.submit('../not-a-board', 90000, [])
        : null;
      return { openStore: typeof (d.shell && d.shell.openStore), leaderboards: lb, refusedBadName: bad };
    })()`);
    step('release-bridge', report.releaseBridge);
    report.pass.storeBridgeExposed = report.releaseBridge.openStore === 'function';
    report.pass.leaderboardBridgeAnswers =
      report.releaseBridge.leaderboards !== null &&
      typeof report.releaseBridge.leaderboards.available === 'boolean' &&
      report.releaseBridge.refusedBadName !== null &&
      report.releaseBridge.refusedBadName.ok === false;

    const failed = Object.entries(report.pass ?? {}).filter(([, v]) => v !== true);
    report.ok =
      failed.length === 0 && report.consoleErrors.length === 0 && report.crashes.length === 0;
  } catch (error) {
    report.error = String(error);
    // Leave enough of the page behind to diagnose a failed step without a screenshot.
    try {
      report.pageAtFailure = await js(`({
        mode: document.getElementById('app')?.dataset.mode ?? null,
        settingsFormOpen: Boolean(document.getElementById('settingsForm')),
        busy: document.getElementById('settingsForm')?.getAttribute('aria-busy') ?? null,
        toast: document.querySelector('[role=status], .toast')?.textContent ?? null,
        fatal: document.querySelector('.fatal, [role=alertdialog]')?.textContent?.slice(0, 300) ?? null,
        state: window.apexDiagnostics ? window.apexDiagnostics().state : null,
      })`);
    } catch {
      /* the page itself may be gone */
    }
  } finally {
    report.totalMs = Date.now() - started;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    log(`smoke: wrote ${out} ok=${report.ok}`);
    quit();
  }
}

module.exports = { run };
