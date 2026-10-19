import { test as base, type ConsoleMessage } from '@playwright/test';

const PREFIX = '__APEX_MENU_TIMING__';
const RETAINED_EVENTS = 4096;

interface TimingRecord {
  kind: string;
  at: number;
  [key: string]: string | number | boolean | null;
}

type RetainedRecord = TimingRecord & { origin: number; receivedAt: number };

interface TimingPacket {
  origin: number;
  sequence: number;
  dropped: number;
  events: TimingRecord[];
}

/** Test-only timing evidence. Native input, rendering, clocks and graphics stay
 * unchanged. Stream bounded batches to Node so a stuck page cannot prevent its
 * last successful heartbeat/fence observations from becoming an attachment. */
export const menuTimingTest = base.extend<{ menuTimingEvidence: undefined }>({
  menuTimingEvidence: [
    async ({ page }, use, info) => {
      const events: RetainedRecord[] = [];
      const contexts: Record<string, RetainedRecord> = {};
      const initialMilestones: RetainedRecord[] = [];
      const recentMilestones: RetainedRecord[] = [];
      let totalMilestones = 0;
      let contextMetadataDropped = 0;
      let total = 0;
      const browserDroppedByDocument: Record<string, number> = {};
      const packets: Record<string, number> = {};
      const listener = (message: ConsoleMessage) => {
        const text = message.text();
        if (!text.startsWith(PREFIX) || text.length > 200000) return;
        let packet: TimingPacket;
        try {
          packet = JSON.parse(text.slice(PREFIX.length)) as TimingPacket;
        } catch {
          return;
        }
        if (!Array.isArray(packet.events) || !Number.isFinite(packet.origin)) return;
        const receivedAt = Date.now();
        packets[packet.origin] = packet.sequence;
        browserDroppedByDocument[packet.origin] = packet.dropped;
        for (const event of packet.events) {
          const retained = { ...event, origin: packet.origin, receivedAt };
          events[total++ % RETAINED_EVENTS] = retained;
          if (event.kind === 'context') {
            const key = `${packet.origin}:${event.context}`;
            if (Object.keys(contexts).length < 64 || key in contexts) contexts[key] = retained;
            else contextMetadataDropped++;
          }
          if (
            [
              'document',
              'context',
              'visibility',
              'context-lost',
              'fence-start',
              'fence-end',
              'fence-delete',
            ].includes(event.kind) ||
            (event.kind === 'wait-end' &&
              (event.result === 37146 || event.result === 37148 || event.result === 37149))
          ) {
            if (initialMilestones.length < 128) initialMilestones.push(retained);
            recentMilestones[totalMilestones++ % 512] = retained;
          }
        }
      };
      page.on('console', listener);
      await page.addInitScript(
        ({ prefix }) => {
          const limit = 512;
          const events: TimingRecord[] = [];
          let dropped = 0;
          let sequence = 0;
          let lastFlush = -Infinity;
          const record = (kind: string, fields: Omit<TimingRecord, 'kind' | 'at'> = {}) => {
            if (events.length === limit) {
              events.shift();
              dropped++;
            }
            events.push({ kind, at: performance.now(), ...fields });
          };
          const emit = (immediate = false) => {
            const now = performance.now();
            if (!events.length || (!immediate && now - lastFlush < 250)) return;
            lastFlush = now;
            // Every test has its original finite deadline. Also cap packets per
            // document so unexpected lifecycle behavior cannot log indefinitely.
            if (sequence >= 1600) {
              dropped += events.length;
              events.length = 0;
              return;
            }
            console.debug(
              prefix +
                JSON.stringify({
                  origin: performance.timeOrigin,
                  sequence: ++sequence,
                  dropped,
                  events: events.splice(0),
                }),
            );
          };
          const nativeRAF = window.requestAnimationFrame.bind(window);
          let callback = 0;
          let activeCallback = 0;
          let immediateRafStarts = 0;
          window.requestAnimationFrame = (run) =>
            nativeRAF((clock) => {
              const id = ++callback;
              const started = performance.now();
              activeCallback = id;
              record('app-raf-start', { id, clock, name: run.name.slice(0, 48) });
              // Preserve the next draw's entry before it can block the event
              // loop; this short transition burst has a strict callback bound.
              if (immediateRafStarts > 0) {
                immediateRafStarts--;
                emit(true);
              } else emit();
              try {
                Reflect.apply(run, window, [clock]);
              } finally {
                record('app-raf-end', { id, duration: performance.now() - started });
                activeCallback = 0;
              }
            });
          let browserFrames = 0;
          let lastBrowserFrame = 0;
          const heartbeat = () => {
            browserFrames++;
            lastBrowserFrame = performance.now();
            nativeRAF(heartbeat);
          };
          nativeRAF(heartbeat);

          const contexts = new WeakMap<WebGL2RenderingContext, number>();
          const fences = new WeakMap<WebGLSync, number>();
          let nextContext = 0;
          let nextFence = 0;
          const getContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (
            this: HTMLCanvasElement,
            ...args: Parameters<typeof getContext>
          ) {
            const result = Reflect.apply(getContext, this, args) as ReturnType<typeof getContext>;
            if (args[0] !== 'webgl2' || !result) return result;
            const gl = result as WebGL2RenderingContext;
            if (contexts.has(gl)) return result;
            const context = ++nextContext;
            contexts.set(gl, context);
            record('context', { context, canvas: this.id, width: this.width, height: this.height });
            const fenceSync = gl.fenceSync;
            gl.fenceSync = function (condition, flags) {
              const started = performance.now();
              record('fence-start', {
                context,
                condition,
                flags,
                activeCallback,
                caller: new Error().stack?.split('\n').slice(2, 5).join('\n').slice(0, 600) ?? '',
              });
              emit();
              const fence = fenceSync.call(this, condition, flags);
              const id = fence ? ++nextFence : null;
              if (fence) fences.set(fence, id!);
              record('fence-end', { context, fence: id, duration: performance.now() - started });
              emit();
              return fence;
            };
            const clientWaitSync = gl.clientWaitSync;
            gl.clientWaitSync = function (fence, flags, timeout) {
              const started = performance.now();
              record('wait-start', { context, fence: fences.get(fence) ?? null, flags, timeout });
              const result = clientWaitSync.call(this, fence, flags, timeout);
              record('wait-end', {
                context,
                fence: fences.get(fence) ?? null,
                result,
                duration: performance.now() - started,
              });
              emit();
              return result;
            };
            const deleteSync = gl.deleteSync;
            gl.deleteSync = function (fence) {
              record('fence-delete', {
                context,
                fence: fence ? (fences.get(fence) ?? null) : null,
              });
              return deleteSync.call(this, fence);
            };
            this.addEventListener('webglcontextlost', () => {
              record('context-lost', { context });
              emit(true);
            });
            emit();
            return result;
          } as typeof getContext;

          let previousMenu: boolean | null = null;
          let previousModal: boolean | null = null;
          const observeVisibility = () => {
            const menu = document.querySelector<HTMLElement>('#menu');
            const modal = document.querySelector<HTMLDialogElement>('#modal');
            const menuHidden = menu ? menu.hidden : null;
            const modalOpen = modal ? modal.open : null;
            if (menuHidden !== previousMenu || modalOpen !== previousModal) {
              immediateRafStarts = 8;
              record('visibility', { menuHidden, modalOpen });
              previousMenu = menuHidden;
              previousModal = modalOpen;
              emit(true);
            }
          };
          new MutationObserver(observeVisibility).observe(document, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['hidden', 'open'],
          });
          observeVisibility();
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries())
              record('long-task', { start: entry.startTime, duration: entry.duration });
          }).observe({ type: 'longtask', buffered: true });
          setInterval(() => {
            record('timer', {
              browserFrames,
              lastBrowserFrame,
              activeCallback,
              callbacks: callback,
            });
            emit(true);
          }, 500);
          record('document', { visibility: document.visibilityState });
          emit(true);
        },
        { prefix: PREFIX },
      );
      try {
        await use(undefined);
      } finally {
        page.off('console', listener);
        const tail = total > RETAINED_EVENTS ? total % RETAINED_EVENTS : 0;
        const ordered =
          total > RETAINED_EVENTS ? [...events.slice(tail), ...events.slice(0, tail)] : events;
        await info.attach('menu-frame-timing.json', {
          body: JSON.stringify({
            boundary:
              'Timing instrumentation only; original inputs, workload, deadlines and assertions.',
            test: info.title,
            status: info.status,
            packets,
            totalEvents: total,
            retainedEvents: ordered.length,
            nodeDropped: Math.max(0, total - RETAINED_EVENTS),
            contexts,
            contextMetadataDropped,
            initialMilestones,
            totalMilestones,
            recentMilestones:
              totalMilestones > 512
                ? [
                    ...recentMilestones.slice(totalMilestones % 512),
                    ...recentMilestones.slice(0, totalMilestones % 512),
                  ]
                : recentMilestones,
            browserDroppedByDocument,
            // GL enum numbers are unmodified native results, not inferred completion.
            waitResults: {
              ALREADY_SIGNALED: 37146,
              TIMEOUT_EXPIRED: 37147,
              CONDITION_SATISFIED: 37148,
              WAIT_FAILED: 37149,
            },
            events: ordered,
          }),
          contentType: 'application/json',
        });
      }
    },
    { auto: true },
  ],
});
