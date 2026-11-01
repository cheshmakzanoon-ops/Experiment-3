import {
  runtimeAbPin,
  type Leg,
  type ImmutableReceipt,
} from '../../scripts/electron-runtime-ab-contract.mjs';
export const immutable: ImmutableReceipt = {
  source: {
    version: 1,
    commit: '1'.repeat(40),
    fingerprint: '2'.repeat(64),
    electron: '45.2.1',
    platform: 'linux',
    arch: 'x64',
    hostArch: 'x64',
  },
  sourceTreeSha256: '3'.repeat(64),
  payloadSha256: '4'.repeat(64),
  payloadBytes: 100,
  smokeSha256: '5'.repeat(64),
  compiledSmokeSha256: '9'.repeat(64),
};
export const clean = {
  schemaVersion: 1,
  ok: true,
  reason: 'quiescent',
  scanned: 4,
  owned: 0,
  signaledTerm: 0,
  signaledKill: 0,
  settled: 0,
  emptyScans: 2,
};
export const exited = { spawned: true, exitCode: 0, signal: null };
export function smoke(leg: Leg) {
  const pin = runtimeAbPin(leg);
  return {
    platform: 'linux',
    arch: 'x64',
    hostArch: 'x64',
    graphicsBackend: 'mesa',
    source: structuredClone(immutable.source),
    runtime: {
      platform: pin.platform,
      arch: pin.arch,
      electron: pin.electron,
      chromium: pin.chromium,
      node: pin.node,
    },
    smokeJourney: {
      requestedJourney: 'full',
      diagnosticOnly: false,
      omittedChecks: [] as string[],
    },
    success: true,
    renderer: 'ANGLE (Mesa llvmpipe)',
    gpuTrace: { enabled: false },
    contextLosses: 0,
    firstGraphicsFault: null,
    errors: [] as string[],
    remoteRequests: [] as string[],
    assetFailures: [] as string[],
    graphicsFaults: [] as string[],
    stages: [
      'launch',
      'electron-connected',
      'window-created',
      'document-loaded',
      'babylon-ready',
    ].map((name, index) => ({ name, elapsedMs: index })),
    checks: [
      'packaged process architecture matches target',
      'packaged offline Babylon entry started',
      'pause/resume/restart',
      'native keyboard drives the existing simulation',
      'original bundled Formula model imports through the offline protocol',
      'ten source-bound scalar-height materials enabled before presentation',
      'diagnostic panel preserves the central driving view and touch controls',
      'applied authored wheel rotation moves during simulation and freezes during pause',
      'sandbox/context isolation active, Node integration disabled',
      'all four retained disciplines enter, accept real throttle, pause and return in the installed game',
    ],
    compatibility: ['formula', 'gp', 'mx', 'festival'].map((discipline) => ({
      discipline,
      ready: { failure: null },
      driving: { failure: null },
      paused: { failure: null },
      resumed: { failure: null },
      pausedAgain: { failure: null },
      returned: { failure: null },
      completedAt: 100,
    })),
  };
}
