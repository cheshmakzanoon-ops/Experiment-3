import {
  SessionStartOwner,
  type SessionStartScope,
} from '../../src/session/session-start-owner.ts';

interface Session {
  dispose(): void;
}

type Outcome = 'pending' | 'resolved' | 'rejected';

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  let outcome: Outcome = 'pending';
  const promise = new Promise<Value>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {
    promise,
    get outcome() {
      return outcome;
    },
    resolve(value: Value) {
      outcome = 'resolved';
      resolve(value);
    },
    reject(reason: unknown) {
      outcome = 'rejected';
      reject(reason);
    },
  };
}

function observe(pending: Promise<void>, settled: (outcome: Outcome) => void = () => undefined) {
  const result = { outcome: 'pending' as Outcome, count: 0, error: null as string | null };
  void pending.then(
    () => {
      result.outcome = 'resolved';
      result.count++;
      settled('resolved');
    },
    (error: unknown) => {
      result.outcome = 'rejected';
      result.count++;
      result.error = error instanceof Error ? error.message : String(error);
      settled('rejected');
    },
  );
  return result;
}

// Real task boundaries exercise the browser's promise jobs without awaiting an
// intentionally unresolved operation or depending on a wall-clock deadline.
const nextTask = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

const rejectionEvents: { type: string; message: string }[] = [];
for (const type of ['unhandledrejection', 'rejectionhandled'] as const) {
  window.addEventListener(type, (event: PromiseRejectionEvent) => {
    rejectionEvents.push({
      type,
      message: event.reason instanceof Error ? event.reason.message : String(event.reason),
    });
    // Do not preventDefault: Playwright's pageerror observer must see leaks too.
  });
}

export async function nativeRejections() {
  // Keep surveillance installed for the whole document, including late jobs
  // after the scenario and its final cancellation have returned.
  await nextTask();
  await nextTask();
  return rejectionEvents.slice();
}

export async function pendingCancellation() {
  const reports = [];
  for (const stage of ['load', 'create'] as const) {
    const owner = new SessionStartOwner<Session>();
    const loaded = deferred<void>();
    const created = deferred<Session>();
    const replacementLoad = deferred<void>();
    const order: string[] = [];
    let firstScope!: SessionStartScope;
    let firstReady = 0,
      firstFailed = 0,
      replacementReady = 0,
      replacementDisposed = 0;
    const replacement = {
      dispose() {
        replacementDisposed++;
      },
    };
    const first = observe(
      owner.start({
        load: () => (stage === 'load' ? loaded.promise : Promise.resolve()),
        create: (_module, scope) => {
          firstScope = scope;
          return created.promise;
        },
        ready: () => {
          firstReady++;
        },
        failed: () => {
          firstFailed++;
        },
      }),
      (outcome) => order.push(`start-${outcome}`),
    );
    const workState = () => (stage === 'load' ? loaded.outcome : created.outcome);
    try {
      await nextTask();
      const beforeCancel = { result: { ...first }, work: workState(), starting: owner.starting };
      order.push('cancel');
      owner.cancel();
      order.push('cancel-returned');
      const synchronousOutcome = first.outcome;
      const second = observe(
        owner.start({
          load: () => replacementLoad.promise,
          create: async () => replacement,
          ready: () => {
            replacementReady++;
          },
          failed: () => {
            throw new Error('Unexpected replacement failure');
          },
        }),
      );
      await nextTask();
      order.push('next-task');
      const afterCancel = {
        result: { ...first },
        work: workState(),
        starting: owner.starting,
        sessionAbsent: owner.session === null,
        oldAborted: stage === 'create' ? firstScope.signal.aborted : null,
        oldCurrent: stage === 'create' ? firstScope.current() : null,
      };
      // Reject only after proving cancellation settled with work still pending.
      // Promise.race must keep observing this departed completion in Chromium.
      const late = new Error(`Late ${stage} failure`);
      if (stage === 'load') loaded.reject(late);
      else created.reject(late);
      await nextTask();
      const afterLateRejection = {
        result: { ...first },
        work: workState(),
        starting: owner.starting,
        sessionAbsent: owner.session === null,
        firstReady,
        firstFailed,
      };
      replacementLoad.resolve();
      await nextTask();
      const recovered = {
        result: { ...second },
        owned: owner.session === replacement,
        starting: owner.starting,
        replacementReady,
        replacementDisposed,
      };
      owner.cancel();
      owner.cancel();
      reports.push({
        stage,
        beforeCancel,
        synchronousOutcome,
        order: order.slice(),
        afterCancel,
        afterLateRejection,
        recovered,
        replacementDisposed,
      });
    } finally {
      owner.cancel();
    }
  }
  return reports;
}

export async function lateCreationCleanup() {
  const owner = new SessionStartOwner<Session>();
  const created = deferred<Session>(),
    replacementCreated = deferred<Session>();
  const status = document.createElement('output');
  document.body.append(status);
  let firstScope!: SessionStartScope, replacementScope!: SessionStartScope;
  let firstReady = 0,
    firstFailed = 0,
    staleDisposed = 0,
    staleWrites = 0;
  let replacementReady = 0,
    replacementDisposed = 0;
  const first = observe(
    owner.start({
      load: async () => undefined,
      create: (_module, scope) => {
        firstScope = scope;
        return created.promise;
      },
      ready: () => {
        firstReady++;
      },
      failed: () => {
        firstFailed++;
      },
    }),
  );
  try {
    await nextTask();
    const staleWrite = firstScope.guard(() => {
      staleWrites++;
      status.textContent = 'departed';
    });
    owner.cancel();
    const replacement = {
      dispose() {
        replacementDisposed++;
      },
    };
    const second = observe(
      owner.start({
        load: async () => undefined,
        create: (_module, scope) => {
          replacementScope = scope;
          scope.guard(() => {
            status.textContent = 'successor:preparing';
          })();
          return replacementCreated.promise;
        },
        ready: () => {
          replacementReady++;
          status.textContent = 'successor:ready';
        },
        failed: () => {
          throw new Error('Unexpected replacement failure');
        },
      }),
    );
    await nextTask();
    const beforeLateCreation = {
      result: { ...first },
      work: created.outcome,
      replacementWork: replacementCreated.outcome,
      starting: owner.starting,
      text: status.textContent,
    };
    created.resolve({
      dispose() {
        staleDisposed++;
        staleWrite();
        queueMicrotask(staleWrite);
        throw new Error('Late departed disposal failed');
      },
    });
    await nextTask();
    const afterLateCreation = {
      result: { ...first },
      staleDisposed,
      staleWrites,
      firstReady,
      firstFailed,
      oldAborted: firstScope.signal.aborted,
      oldCurrent: firstScope.current(),
      current: replacementScope.current(),
      aborted: replacementScope.signal.aborted,
      starting: owner.starting,
      sessionAbsent: owner.session === null,
      text: status.textContent,
    };
    replacementCreated.resolve(replacement);
    await nextTask();
    const recovered = {
      result: { ...second },
      owned: owner.session === replacement,
      starting: owner.starting,
      replacementReady,
      replacementDisposed,
      text: status.textContent,
    };
    owner.cancel();
    owner.cancel();
    await nextTask();
    return {
      beforeLateCreation,
      afterLateCreation,
      recovered,
      final: {
        staleDisposed,
        replacementDisposed,
        staleWrites,
        sessionAbsent: owner.session === null,
      },
    };
  } finally {
    owner.cancel();
    status.remove();
  }
}

export async function reentrantRecovery() {
  const reports = [];
  for (const boundary of ['abort', 'recovery'] as const) {
    const owner = new SessionStartOwner<Session>();
    const replacementCreated = deferred<Session>();
    const status = document.createElement('output');
    document.body.append(status);
    const order: string[] = [];
    let firstScope!: SessionStartScope, replacementScope!: SessionStartScope;
    const successor: { result?: ReturnType<typeof observe> } = {};
    let firstDisposed = 0,
      firstFailed = 0,
      staleWrites = 0,
      outerFailures = 0;
    let replacementReady = 0,
      replacementDisposed = 0,
      replacementStarts = 0;
    let revokedAtAbort = false;
    const replacement = {
      dispose() {
        replacementDisposed++;
      },
    };
    const startReplacement = () => {
      replacementStarts++;
      order.push('successor-start');
      successor.result = observe(
        owner.start({
          load: async () => undefined,
          create: (_module, scope) => {
            replacementScope = scope;
            status.textContent = 'successor:preparing';
            return replacementCreated.promise;
          },
          ready: () => {
            replacementReady++;
            status.textContent = 'successor:ready';
          },
          failed: () => {
            throw new Error('Unexpected replacement failure');
          },
        }),
      );
    };
    const first = observe(
      owner.start({
        load: async () => undefined,
        create: async (_module, scope) => {
          firstScope = scope;
          const staleWrite = scope.guard(() => {
            staleWrites++;
            status.textContent = 'departed';
          });
          scope.signal.addEventListener(
            'abort',
            () => {
              order.push('abort');
              revokedAtAbort = owner.session === null && !owner.starting && !scope.current();
              if (boundary === 'abort') startReplacement();
              queueMicrotask(staleWrite);
            },
            { once: true },
          );
          return {
            dispose() {
              firstDisposed++;
              order.push('dispose');
              staleWrite();
              throw new Error('Departed cleanup failed');
            },
          };
        },
        ready: () => {
          order.push('ready');
          throw new Error('Departed ready failed');
        },
        failed: () => {
          firstFailed++;
          order.push('recover');
          if (boundary === 'recovery') {
            startReplacement();
            throw new Error('Departed recovery failed');
          }
          // Model the host's recovery: an obsolete call would cancel its successor.
          owner.cancel();
        },
      }),
      (outcome) => {
        if (outcome === 'rejected') {
          outerFailures++;
          owner.cancel();
          status.textContent = 'outer-failure';
        }
      },
    );
    try {
      await nextTask();
      const afterRecovery = {
        result: { ...first },
        successorResult: successor.result ? { ...successor.result } : null,
        revokedAtAbort,
        firstDisposed,
        firstFailed,
        outerFailures,
        staleWrites,
        replacementStarts,
        oldAborted: firstScope.signal.aborted,
        oldCurrent: firstScope.current(),
        current: replacementScope?.current() ?? false,
        aborted: replacementScope?.signal.aborted ?? null,
        starting: owner.starting,
        sessionAbsent: owner.session === null,
        text: status.textContent,
      };
      replacementCreated.resolve(replacement);
      await nextTask();
      const recovered = {
        result: successor.result ? { ...successor.result } : null,
        owned: owner.session === replacement,
        starting: owner.starting,
        replacementReady,
        replacementDisposed,
        outerFailures,
        text: status.textContent,
      };
      owner.cancel();
      owner.cancel();
      reports.push({
        boundary,
        order: order.slice(),
        afterRecovery,
        recovered,
        final: { firstDisposed, replacementDisposed, outerFailures, staleWrites },
      });
    } finally {
      owner.cancel();
      status.remove();
    }
  }
  return reports;
}
