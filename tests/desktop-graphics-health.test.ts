import { expect, it } from 'vitest';
import { graphicsFaults } from '../desktop/graphics-health.ts';
it('rejects GPU crashes even across process-log chunks and after context recovery', () => {
  expect(graphicsFaults(['GPU process exited unex', 'pectedly: exit_code=512\n'], [], 0)).toEqual([
    'GPU process exited unexpectedly: exit_code=512',
  ]);
  expect(
    graphicsFaults(
      [],
      [
        { type: 'log', text: 'THREE.WebGLRenderer: Context Lost.' },
        { type: 'log', text: 'THREE.WebGLRenderer: Context Restored.' },
      ],
      1,
    ),
  ).toHaveLength(2);
});
it('does not treat an ordinary warning or completed context restoration as a new loss', () => {
  expect(
    graphicsFaults(
      [],
      [
        { type: 'warning', text: 'Software rendering is active' },
        { type: 'log', text: 'THREE.WebGLRenderer: Context Restored.' },
      ],
      0,
    ),
  ).toEqual([]);
});
it('rejects an unavailable health observation instead of assuming success', () => {
  for (const count of [NaN, -1, 0.5]) expect(graphicsFaults([], [], count)).not.toEqual([]);
});

import {
  createGraphicsLogScanner,
  createProcessGraphicsObservation,
  observationFaults,
} from '../desktop/graphics-health.ts';
it('observes abnormal GPU exits before a client connects and returns independent snapshots', () => {
  const observer = createProcessGraphicsObservation();
  observer.record({ type: 'Utility', reason: 'crashed', exitCode: 1 });
  observer.record({ type: 'GPU', reason: 'clean-exit', exitCode: 0 });
  expect(observer.read()).toEqual({ observed: true, gpuExits: 1, faults: [] });
  observer.record({ type: 'GPU', reason: 'crashed', exitCode: 512 });
  const copy = observer.read();
  copy.faults.length = 0;
  expect(observer.read().faults).toHaveLength(1);
  for (let i = 0; i < 100; i++) observer.record({ type: 'GPU', reason: 'killed', exitCode: 9 });
  expect(observer.read().faults).toHaveLength(32);
  expect(observer.read().gpuExits).toBe(102);
});
it('scans full log chunks and preserves a split crash marker beyond retained diagnostics', () => {
  const scanner = createGraphicsLogScanner();
  scanner.push('x'.repeat(12000) + 'GPU process exited unex');
  scanner.push('pectedly: exit_code=512\n');
  scanner.push('healthy recovery\n'.repeat(10000));
  expect(scanner.faults()).toHaveLength(1);
});
it('retains document losses across navigation but does not equate pagehide with failure', () => {
  const process = { observed: true, gpuExits: 0, faults: [] };
  const doc = {
    version: 1,
    observationErrors: [],
    documents: [
      { id: 'old', url: 'motobound://game/babylon.html', losses: 0, ended: true },
      { id: 'new', url: 'motobound://game/index.html', losses: 0, ended: false },
    ],
  };
  expect(observationFaults(process, doc)).toEqual([]);
  doc.documents[0].losses = 1;
  expect(observationFaults(process, doc)[0]).toContain('Document old');
  expect(observationFaults(undefined, undefined)).toHaveLength(2);
  expect(
    observationFaults(process, { ...doc, observationErrors: ['history unavailable'] }),
  ).toContain('history unavailable');
});
