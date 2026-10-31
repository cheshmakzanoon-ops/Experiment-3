/** Harness-only scopes. Required callers remain full; diagnostics cannot claim
 * that an intentionally omitted authored-model workload passed. */
export function desktopSmokeJourney(value = 'full') {
  if (value !== 'full' && value !== 'compatibility-diagnostic')
    throw new Error(`Unknown desktop smoke journey: ${value}`);
  return {
    requestedJourney: value,
    diagnosticOnly: value === 'compatibility-diagnostic',
    omittedChecks:
      value === 'compatibility-diagnostic'
        ? [
            'Babylon original Formula model import and presentation',
            'Babylon authored wheel motion and pause stability',
            'Babylon imported-model panel layout',
          ]
        : [],
  };
}

export async function runDesktopSmokeJourneys(journey, checks) {
  if (!journey.diagnosticOnly) await checks.authoredModel();
  await checks.captureBabylon();
  // This callback retains the shipped native Game menu and every existing
  // compatibility UI/input assertion. It never navigates directly to a URL.
  await checks.compatibility();
}

/** Race only harness observations, never actual GPU work. No timers, browser
 * hooks or polling changes: the original operation owns its original budget.
 * Per-wait listeners are removed on either outcome; late rejections are handled. */
export function createFirstGraphicsFault() {
  let first;
  const listeners = new Set();
  return {
    record(message) {
      if (first) return;
      first = new Error(`GPU health failed: ${String(message).slice(0, 2048)}`);
      for (const reject of listeners) reject(first);
      listeners.clear();
    },
    read: () => first,
    wait(operation) {
      if (first) return Promise.reject(first);
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (ok, value) => {
          if (settled) return;
          settled = true;
          listeners.delete(onFault);
          if (ok) resolve(value);
          else reject(value);
        };
        const onFault = (error) => finish(false, error);
        listeners.add(onFault);
        try {
          Promise.resolve(operation()).then(
            (value) => (first ? finish(false, first) : finish(true, value)),
            (error) => finish(false, first ?? error),
          );
        } catch (error) {
          finish(false, first ?? error);
        }
      });
    },
  };
}

/** A secondary timeout/snapshot error must not erase an observed GPU crash or
 * an earlier failure. Full evidence collection still runs after this call. */
export function retainNativeSmokeFailure(report, error, graphicsFailure) {
  if (report.success === false && report.failure) return;
  report.success = false;
  report.failure = String(graphicsFailure.read() ?? error);
}
