import { chromium, expect, test, type CDPSession } from '@playwright/test';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import ts from 'typescript';
import { browserBackend, requireBrowserBackend } from '../scripts/browser-backend.ts';
import type * as Fixture from './fixtures/engine-native-page-history.ts';

const backend = browserBackend(process.env.APEX_BROWSER_BACKEND);
// Playwright deliberately disables BFCache by default. Remove only that flag
// for this file; retain the same verified renderer and executable as the suite.
test.use({
  // Playwright does not support restored Page lifecycle bookkeeping. This
  // case uses raw CDP throughout; automatic Page snapshots must stay off too.
  trace: 'off',
  screenshot: 'off',
  launchOptions: {
    executablePath:
      process.env.CHROMIUM_PATH ||
      (backend.name === 'mesa' ? chromium.executablePath() : undefined),
    args: backend.args,
    ignoreDefaultArgs: ['--disable-back-forward-cache'],
  },
});

const historyPath = '/__engine_native_page_history__';
const awayPath = '/__engine_native_page_history_away__';
let html: string;
let sourceHash: string;
let server: Server;
let origin: string;
let pageRequests = 0;
let session: CDPSession | null = null;

function productionHost() {
  const bytes = readFileSync(resolve('src/main.ts'), 'utf8');
  sourceHash = createHash('sha256').update(bytes).digest('hex');
  const source = ts.createSourceFile('main.ts', bytes, ts.ScriptTarget.Latest, true);
  const owner = source.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === 'GameApp',
  );
  if (!owner) throw new Error('Missing current GameApp');
  const names = [
    'disposed',
    'errorStopped',
    'pageSuspended',
    'pageEpoch',
    'pageMenuRecovery',
    'pageWaiters',
    'generation',
    'rendererBuild',
    'circuitStartup',
    'initTimeout',
    'worker',
    'workerPause',
    'current',
    'previous',
    'savingSettings',
    'timer',
    'previousTime',
    'renderedAt',
    'renderedState',
    'post',
    'scheduleFrame',
    'pageHide',
    'pageShow',
    'suspendOnBlur',
    'suspendPlayback',
    'pause',
    'resume',
    'dispose',
  ];
  const members = names.map((name) => {
    const member = owner.members.find((node) => node.name?.getText(source) === name);
    if (!member) throw new Error(`Missing current GameApp.${name}`);
    return member.getText(source);
  });
  const registrations = owner.members.filter(ts.isConstructorDeclaration).flatMap((constructor) =>
    constructor
      .body!.statements.filter((statement) => {
        if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression))
          return false;
        const call = statement.expression;
        return (
          ts.isPropertyAccessExpression(call.expression) &&
          call.expression.name.text === 'addEventListener' &&
          ts.isStringLiteral(call.arguments[0]) &&
          ['pagehide', 'pageshow', 'blur'].includes(call.arguments[0].text)
        );
      })
      .map((statement) => statement.getText(source)),
  );
  expect(registrations).toHaveLength(3);
  const pumps: ts.BinaryExpression[] = [];
  function findPump(node: ts.Node) {
    if (
      ts.isBinaryExpression(node) &&
      node.left.getText(source) === 'this.inputPump' &&
      ts.isNewExpression(node.right)
    )
      pumps.push(node);
    ts.forEachChild(node, findPump);
  }
  findPump(owner);
  expect(pumps).toHaveLength(1);
  return ts.transpileModule(
    `class Host { ${members.join('\n')}
    install() { ${registrations.join('\n')} ${pumps[0].getText(source)}; }
  }`,
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    },
  ).outputText;
}

test.beforeAll(async () => {
  async function bundle(path: string, globalName?: string) {
    const result = await build({
      entryPoints: [resolve(path)],
      bundle: true,
      write: false,
      format: 'iife',
      globalName,
      platform: 'browser',
      target: 'es2022',
    });
    return result.outputFiles[0].text;
  }
  const fixture = await bundle(
    'e2e/fixtures/engine-native-page-history.ts',
    'EngineNativePageHistory',
  );
  const worker = await bundle('e2e/fixtures/engine-native-page-history.worker.ts');
  const host = productionHost();
  const literal = (value: string) => JSON.stringify(value).replaceAll('<', '\\u003c');
  html = `<!doctype html><html><head><meta charset="utf-8"><title>Native retained engine owner</title>
    <style>body{margin:20px}canvas{display:block;width:64px;height:64px}#drive{padding:12px}
    [data-mode="driving"] #resume{visibility:hidden}</style></head><body data-mode="paused">
    <canvas id="view" width="16" height="16"></canvas><div id="drive" tabindex="0">Driving focus</div>
    <div id="modal"><button id="resume" data-action="resume">Resume retained owner</button></div>
    <a id="away" href="${awayPath}">Leave engine page</a>
    <script>${fixture.replaceAll('</script', '<\\/script')}</script>
    <script>EngineNativePageHistory.open(${literal(worker)},${literal(host)}).then(() => {
      window.engineHistoryReady=true;
    }).catch(error => {window.engineHistoryError=String(error);});</script></body></html>`;
  // A real HTTP document avoids Playwright's request-routing/lifecycle layer.
  // Only this fixture's two pages are served; no repository files are written.
  server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.setHeader('cache-control', 'max-age=0');
    if (request.url === historyPath) {
      pageRequests++;
      response.end(html);
    } else if (request.url === awayPath) {
      response.end(
        '<!doctype html><title>Away from engine</title><h1>Separate native history entry</h1>',
      );
    } else {
      response.statusCode = 204;
      response.end();
    }
  });
  await new Promise<void>((yes, no) => {
    server.once('error', no);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', no);
      yes();
    });
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

async function evaluate<T>(cdp: CDPSession, expression: string): Promise<T> {
  const deadline = Date.now() + 5000;
  for (;;) {
    let result;
    try {
      result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
    } catch (error) {
      // A document swap may briefly have no main execution context. Retry
      // that protocol boundary only; application exceptions remain failures.
      if (
        Date.now() >= deadline ||
        !/Cannot find (?:default execution |execution )?context|Execution context was destroyed|Inspected target navigated/i.test(
          String(error),
        )
      )
        throw error;
      await sleep(20);
      continue;
    }
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
      );
    return result.result.value as T;
  }
}
const snapshot = (cdp: CDPSession) =>
  evaluate<ReturnType<typeof Fixture.snapshot>>(cdp, 'window.EngineNativePageHistory.snapshot()');
const inspect = (cdp: CDPSession) =>
  evaluate<Fixture.WorkerInspection>(cdp, 'window.EngineNativePageHistory.inspectWorker()');
async function ready(cdp: CDPSession) {
  await expect
    .poll(async () => {
      const result = await evaluate<{ ready: boolean; error?: string; path: string }>(
        cdp,
        '({ready: !!window.engineHistoryReady, error: window.engineHistoryError, path: location.pathname})',
      );
      if (result.error) throw new Error(result.error);
      return result;
    })
    .toMatchObject({ ready: true, path: historyPath });
}
async function click(cdp: CDPSession, selector: string) {
  const point = await evaluate<{ x: number; y: number }>(
    cdp,
    `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing native history control');
    element.scrollIntoView({block:'center'});
    const rect=element.getBoundingClientRect();
    return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  })()`,
  );
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...point,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...point,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}
const keys = {
  KeyW: { key: 'w', windowsVirtualKeyCode: 87 },
  BracketRight: { key: ']', windowsVirtualKeyCode: 221 },
  BracketLeft: { key: '[', windowsVirtualKeyCode: 219 },
};
async function key(
  cdp: CDPSession,
  code: keyof typeof keys,
  type: 'keyDown' | 'keyUp',
  autoRepeat = false,
) {
  await cdp.send('Input.dispatchKeyEvent', { type, code, ...keys[code], autoRepeat });
}

test.afterEach(async () => {
  if (!session) return;
  try {
    await evaluate(session, 'window.EngineNativePageHistory?.close()');
  } finally {
    await session.detach();
    session = null;
  }
});
test.afterAll(async () => {
  if (!server) return;
  await new Promise<void>((yes, no) => {
    server.close((error) => (error ? no(error) : yes()));
    server.closeAllConnections();
  });
});

test('native Back restores the same paused engine owners twice; terminal reload releases them', async ({
  page,
}, info) => {
  const errors: string[] = [];
  const cacheFailures: unknown[] = [];
  const navigations: { type?: string; url: string; frame: string }[] = [];
  const cdp = (session = await page.context().newCDPSession(page));
  cdp.on(
    'Runtime.exceptionThrown',
    (event: {
      exceptionDetails: {
        text: string;
        exception?: { description?: string };
      };
    }) => errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text),
  );
  cdp.on('Page.backForwardCacheNotUsed', (event: unknown) => cacheFailures.push(event));
  cdp.on('Page.frameNavigated', (event: { type?: string; frame: { url: string; id: string } }) =>
    navigations.push({ type: event.type, url: event.frame.url, frame: event.frame.id }),
  );
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.bringToFront');
  await cdp.send('Page.navigate', { url: origin + historyPath });
  await ready(cdp);
  const boot = await snapshot(cdp);
  requireBrowserBackend(backend.name, boot.backend);
  expect(boot.state).toBe('paused');
  expect(boot.inputIntervals).toBe(1);
  expect(boot.workerInstance).toBeTruthy();
  await click(cdp, '#resume');
  await expect.poll(async () => (await inspect(cdp)).tick).toBeGreaterThan(5);

  const cycles = [];
  for (let cycle = 1; cycle <= 2; cycle++) {
    await click(cdp, '#drive');
    await key(cdp, 'KeyW', 'keyDown');
    await key(cdp, 'BracketRight', 'keyDown');
    await expect.poll(async () => (await inspect(cdp)).lastInput?.throttle ?? 0).toBeGreaterThan(0);
    const before = { page: await snapshot(cdp), worker: await inspect(cdp) };
    await click(cdp, '#away');
    await expect.poll(() => evaluate<string>(cdp, 'location.pathname')).toBe(awayPath);
    const away = await evaluate<unknown>(
      cdp,
      "JSON.parse(sessionStorage.getItem('engine-native-page-history-last-hide') ?? 'null')",
    );
    await info.attach(`history-${cycle}-departure.json`, {
      body: JSON.stringify({ before, away }, null, 2),
      contentType: 'application/json',
    });
    await sleep(250);
    const history = await cdp.send('Page.getNavigationHistory');
    const previous = history.entries[history.currentIndex - 1];
    expect(previous.url).toBe(origin + historyPath);
    await cdp.send('Page.navigateToHistoryEntry', { entryId: previous.id });
    await ready(cdp);
    const returned = await snapshot(cdp);
    await info.attach(`history-${cycle}-admission.json`, {
      body: JSON.stringify(
        {
          sourceHash,
          backend: backend.name,
          pageRequests,
          history,
          cacheFailures,
          navigations,
          returned,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(away).toMatchObject({
      kind: 'pagehide',
      persisted: true,
      trusted: true,
      instance: boot.instance,
      workerInstance: boot.workerInstance,
      state: 'paused',
      disposed: false,
      suspended: true,
      epoch: cycle,
      pendingFrames: 0,
      inputIntervals: 0,
      counters: { rendererDisposals: 0, workerTerminations: 0, inputDisposals: 0, uiDisposals: 0 },
      raf: { accountingBalance: 0, currentHandle: null, pending: [] },
    });
    // Reloads fail these assertions; a history command or navigation.type
    // alone is never used as a substitute for actual BFCache admission.
    expect(returned.instance, JSON.stringify(returned.notRestoredReasons)).toBe(boot.instance);
    expect(returned.workerInstance).toBe(boot.workerInstance);
    expect(pageRequests).toBe(1);
    const restored = returned.events.filter(
      (event) => event.kind === 'pageshow' && event.persisted,
    );
    expect(restored).toHaveLength(cycle);
    expect(restored.at(-1)).toMatchObject({
      trusted: true,
      state: 'paused',
      disposed: false,
      suspended: false,
      epoch: cycle,
      generation: boot.generation,
      pendingFrames: 1,
      inputIntervals: 1,
      input: { throttle: 0, shift: 0 },
      clocks: { previousTime: 0, renderedAt: 0, demoClockAt: 0, liveSkyChecked: 0 },
    });
    expect(returned.resumeCommands.filter((entry) => entry.epoch === cycle)).toEqual([]);
    await expect
      .poll(async () => (await snapshot(cdp)).pause)
      .toMatchObject({ pending: false, paused: true });
    const paused = await inspect(cdp);
    expect(paused.instance).toBe(boot.workerInstance);
    expect(paused.paused).toBe(true);
    expect(paused.lastInput).toMatchObject({ throttle: 0, shift: 0 });
    await sleep(150);
    const held = await inspect(cdp);
    expect(held.tick).toBe(paused.tick);
    expect(held.steps).toBe(paused.steps);
    expect(held.inputMessages).toBe(paused.inputMessages);
    await expect.poll(async () => (await snapshot(cdp)).pixels).toEqual([0, 255, 0, 255]);
    const presentation = await snapshot(cdp);
    expect(presentation.contextLost).toBe(false);
    expect(presentation.glError).toBe(0);
    // Native CI recorded timestamp repeats before the first departure.
    // Keep that diagnostic, but identify ownership by the actual request and
    // delivery, including cancelled requests and immediate startup calls.
    expect(presentation.counters).toMatchObject({
      maxPendingFrames: 1,
      maxFrameCallsPerRequest: 1,
      duplicateFrameDeliveries: 0,
      untrackedFrameDeliveries: 0,
      pendingFrameIdCollisions: 0,
      framesWithoutRequest: 0,
      startupFramesWithoutRequest: 0,
      staleOwnerFrames: 0,
      maxInputIntervals: 1,
      rendererResets: cycle,
      rendererDisposals: 0,
      workerTerminations: 0,
    });
    expect(presentation.pendingFrames).toBe(1);
    expect(presentation.raf).toMatchObject({
      accountingBalance: 0,
      pending: [
        {
          nativeId: presentation.raf.currentHandle,
          epoch: cycle,
          generation: boot.generation,
          cancelled: false,
          delivered: false,
          frameCalls: 0,
        },
      ],
    });
    expect(presentation.counters.frames).toBeGreaterThan(before.page.counters.frames);

    await click(cdp, '#resume');
    await click(cdp, '#drive');
    // The keys were never released. Deliver browser-native repeat events via
    // CDP; they must not become fresh driving intent in the restored owner.
    await key(cdp, 'KeyW', 'keyDown', true);
    await key(cdp, 'BracketRight', 'keyDown', true);
    await expect.poll(async () => (await inspect(cdp)).tick).toBeGreaterThan(paused.tick + 2);
    const repeated = await inspect(cdp);
    expect(repeated.lastInput).toMatchObject({ throttle: 0, shift: 0 });
    expect(repeated.positiveShifts).toBe(paused.positiveShifts);
    const inputOwner = await snapshot(cdp);
    expect(
      inputOwner.keys.filter((key) => key.epoch === cycle && key.repeat).map((key) => key.code),
    ).toEqual(['KeyW', 'BracketRight']);
    expect(inputOwner.keys.every((key) => key.trusted)).toBe(true);
    expect(inputOwner.resumeClicks.at(-1)).toEqual({ trusted: true, epoch: cycle });
    expect(inputOwner.resumeCommands.filter((entry) => entry.epoch === cycle)).toHaveLength(1);
    await key(cdp, 'KeyW', 'keyUp');
    await key(cdp, 'BracketRight', 'keyUp');
    await key(cdp, 'BracketLeft', 'keyDown');
    await key(cdp, 'BracketLeft', 'keyUp');
    await key(cdp, 'KeyW', 'keyDown');
    await expect
      .poll(async () => (await inspect(cdp)).negativeShifts)
      .toBeGreaterThan(repeated.negativeShifts);
    await expect.poll(async () => (await inspect(cdp)).lastInput?.throttle ?? 0).toBeGreaterThan(0);
    const fresh = await inspect(cdp);
    expect(fresh.applied.some((entry) => entry.tick >= paused.tick && entry.throttle > 0)).toBe(
      true,
    );
    await key(cdp, 'KeyW', 'keyUp');
    cycles.push({
      cycle,
      before,
      away,
      returned,
      paused,
      held,
      presentation,
      repeated,
      inputOwner,
      fresh,
    });
  }

  // Reload is intentionally a terminal event, separately checked after the
  // two proved retained navigations. Its new instance must not count as reuse.
  const retained = await snapshot(cdp);
  await cdp.send('Page.reload');
  await expect
    .poll(async () => {
      const identity = await evaluate<string | null>(
        cdp,
        'window.engineHistoryReady ? window.EngineNativePageHistory.snapshot().instance : null',
      );
      return identity !== null && identity !== retained.instance;
    })
    .toBe(true);
  await ready(cdp);
  const reloaded = await snapshot(cdp);
  expect(reloaded.instance).not.toBe(retained.instance);
  expect(reloaded.workerInstance).not.toBe(retained.workerInstance);
  expect(pageRequests).toBe(2);
  expect(reloaded.priorHide).toMatchObject({
    kind: 'pagehide',
    persisted: false,
    trusted: true,
    instance: boot.instance,
    disposed: true,
    pendingFrames: 0,
    inputIntervals: 0,
    raf: { accountingBalance: 0, currentHandle: null, pending: [] },
    counters: {
      workerTerminations: 1,
      inputDisposals: 1,
      rendererDisposals: 1,
      uiDisposals: 1,
      audioDisposals: 1,
      cueDisposals: 1,
    },
  });
  expect(reloaded.errors).toEqual([]);
  expect(errors).toEqual([]);
  await info.attach('native-page-history.json', {
    body: JSON.stringify(
      {
        sourceHash,
        backend: backend.name,
        ignoredDefaultArgs: ['--disable-back-forward-cache'],
        preservedLaunchArgs: backend.args,
        boot,
        cycles,
        retained,
        reloaded,
        cacheFailures,
        navigations,
        errors,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
