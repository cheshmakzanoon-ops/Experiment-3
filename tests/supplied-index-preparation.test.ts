import * as T from 'three';
import { expect, it, vi } from 'vitest';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import {
  snapshotSuppliedIndexEvidence,
  INDEX_EVIDENCE_SUBJECT_LIMIT,
} from '../src/rendering/supplied-index-evidence.ts';

function fixture() {
  let cancelled = false,
    lost = false;
  const camera = new T.PerspectiveCamera(),
    mirrors = [new T.PerspectiveCamera(), new T.PerspectiveCamera()];
  const hiddenRoots = [new T.Group()];
  const prepareCamera = vi.fn((..._args: unknown[]) => true),
    root = new T.Group();
  const counters = { buffers: 0, uploads: 0, uploadedBytes: 0 };
  const diagnostics = vi.fn(() => ({
    meshes: 1,
    geometries: 1,
    submissions: 0,
    omittedTriangles: 0,
    compacted: { ...counters },
  }));
  const car = {
    root,
    suppliedPlayer: {
      lods: { drawRanges: { prepareCamera, diagnostics, enabled: true, compact: true } },
    },
  };
  const plan = { cameras: mirrors, hiddenRoots };
  const target = {
    preparingIndexStreams: (() => cancelled) as (() => boolean) | null,
    indexEvidenceAfterDraw: null as ((returned: boolean) => void) | null,
    gpuFrames: { ready: vi.fn(() => true) },
    renderer: { getContext: vi.fn(() => ({ isContextLost: () => lost })) },
    scene: new T.Scene(),
    camera,
    cars: [car],
    photo: null as unknown,
    debug: false,
    reflection: { prepareMirrorViews: vi.fn(() => plan) },
    refreshReflectionExclusions: vi.fn(),
    preparation: {
      observe: vi.fn((_label: string, work: () => void) => work()),
      checkpoint: vi.fn(),
    },
  };
  const method = (
    RacingRenderer.prototype as unknown as {
      prepareSuppliedIndexStreams(...args: unknown[]): unknown;
    }
  ).prepareSuppliedIndexStreams;
  return {
    target,
    car,
    camera,
    mirrors,
    hiddenRoots,
    plan,
    prepareCamera,
    counters,
    diagnostics,
    cancel: () => {
      cancelled = true;
    },
    lose: () => {
      lost = true;
    },
    run: (studio = false) => method.call(target, car, 1 / 120, 'cockpit', studio),
  };
}

it('prepares only scheduled mirror cameras then the exact main camera with no cadence consumption', () => {
  const f = fixture();
  expect(f.run()).toBe(f.plan);
  expect(f.target.gpuFrames.ready).toHaveBeenCalledOnce();
  expect(f.target.refreshReflectionExclusions).toHaveBeenCalledExactlyOnceWith(f.car);
  expect(f.target.reflection.prepareMirrorViews).toHaveBeenCalledExactlyOnceWith(
    f.car.root,
    1 / 120,
  );
  expect(f.prepareCamera.mock.calls.map((args) => args[2])).toEqual([...f.mirrors, f.camera]);
  for (const args of f.prepareCamera.mock.calls.slice(0, 2)) expect(args[4]).toBe(f.hiddenRoots);
  expect(f.target.preparation.checkpoint).toHaveBeenCalledWith(
    'mark',
    'indices:prepared',
    0,
    expect.objectContaining({ status: 'prepared', scheduledMirrors: 2 }),
  );
});
it('does nothing outside owned preparation', () => {
  const f = fixture();
  f.target.preparingIndexStreams = null;
  expect(f.run()).toBeNull();
  expect(f.target.gpuFrames.ready).not.toHaveBeenCalled();
  expect(f.prepareCamera).not.toHaveBeenCalled();
});
it('rejects a pending owner gate before acquiring context, mirror planning or buffer work', () => {
  const f = fixture();
  f.target.gpuFrames.ready.mockReturnValue(false);
  expect(() => f.run()).toThrow('idle GPU frame gate');
  expect(f.target.renderer.getContext).not.toHaveBeenCalled();
  expect(f.target.reflection.prepareMirrorViews).not.toHaveBeenCalled();
  expect(f.prepareCamera).not.toHaveBeenCalled();
});
it.each(['cancelled', 'lost'] as const)('does not upload for a %s owner', (state) => {
  const f = fixture();
  if (state === 'cancelled') {
    f.cancel();
    expect(f.run()).toBeNull();
  } else {
    f.lose();
    expect(() => f.run()).toThrow('context lost');
  }
  expect(f.prepareCamera).not.toHaveBeenCalled();
});
it.each(['cancelled', 'lost'] as const)(
  'stops before the next camera when %s during preupload',
  (state) => {
    const f = fixture();
    f.prepareCamera.mockImplementationOnce(() => {
      if (state === 'cancelled') f.cancel();
      else f.lose();
      return false;
    });
    if (state === 'cancelled') expect(f.run()).toBeNull();
    else expect(() => f.run()).toThrow('context lost');
    expect(f.prepareCamera).toHaveBeenCalledOnce();
    expect(
      f.target.preparation.checkpoint.mock.calls.some((args) => args[1] === 'indices:prepared'),
    ).toBe(false);
  },
);
it.each(['photo', 'debug', 'override', 'studio'] as const)(
  'declines %s without buffer allocation or mirror planning',
  (mode) => {
    const f = fixture();
    if (mode === 'photo') f.target.photo = {};
    if (mode === 'debug') f.target.debug = true;
    if (mode === 'override') f.target.scene.overrideMaterial = new T.MeshBasicMaterial();
    expect(f.run(mode === 'studio')).toBeNull();
    expect(f.prepareCamera).not.toHaveBeenCalled();
    expect(f.target.reflection.prepareMirrorViews).not.toHaveBeenCalled();
    expect(f.target.preparation.checkpoint).toHaveBeenCalledWith(
      'mark',
      'indices:declined:unsupported-presentation',
      0,
      expect.objectContaining({ declined: true, scheduledMirrors: null }),
    );
  },
);
it('retains decline rather than falsely claiming every stream prepared', () => {
  const f = fixture();
  f.prepareCamera.mockReturnValueOnce(false);
  f.run();
  expect(f.target.preparation.checkpoint).toHaveBeenCalledWith(
    'mark',
    'indices:declined',
    0,
    expect.objectContaining({ declined: true }),
  );
});

it('reports no compact owner as not applicable rather than an applied optimization', () => {
  const f = fixture();
  f.target.cars = [];
  f.run();
  expect(f.target.preparation.checkpoint).toHaveBeenCalledWith(
    'mark',
    'indices:not-applicable',
    0,
    expect.objectContaining({
      status: 'not-applicable',
      declined: false,
      scheduledMirrors: 2,
      before: expect.objectContaining({ subjects: 0, suppliedOwners: 0, eligibleOwners: 0 }),
      cameras: [],
    }),
  );
  expect(f.prepareCamera).not.toHaveBeenCalled();
});
it('records per-camera CPU pool counters and post-draw aggregate without claiming GPU completion', () => {
  const f = fixture();
  f.prepareCamera.mockImplementation(() => {
    f.counters.buffers++;
    f.counters.uploads++;
    f.counters.uploadedBytes += 12;
    return true;
  });
  f.run();
  const ready = f.target.preparation.checkpoint.mock.calls.find(
    (args) => args[1] === 'indices:prepared',
  )![3];
  expect(ready.before).toMatchObject({
    subjects: 1,
    eligibleOwners: 1,
    compacted: { buffers: 0, uploads: 0, uploadedBytes: 0 },
  });
  expect(ready.afterPreparation.compacted).toEqual({ buffers: 3, uploads: 3, uploadedBytes: 36 });
  expect(
    ready.cameras.map((row: { before: { buffers: number }; after: { buffers: number } }) => [
      row.before.buffers,
      row.after.buffers,
    ]),
  ).toEqual([
    [0, 1],
    [1, 2],
    [2, 3],
  ]);
  f.target.indexEvidenceAfterDraw!(true);
  const after = f.target.preparation.checkpoint.mock.calls.at(-1)![3];
  expect(after.afterDraw.compacted).toEqual(ready.afterPreparation.compacted);
  expect(after).toMatchObject({ drawReturned: true, gpuCompletionClaimed: false });
  expect(after.scope).toContain('all-cameras');
  // An unprepared shadow/probe/wet camera may legitimately allocate afterwards.
  f.counters.buffers++;
  f.counters.uploads++;
  f.counters.uploadedBytes += 12;
  expect(() => f.target.indexEvidenceAfterDraw!(false)).not.toThrow();
  expect(f.target.preparation.checkpoint.mock.calls.at(-1)![3]).toMatchObject({
    drawReturned: false,
    afterDraw: { compacted: { buffers: 4 } },
  });
});
it('bounds primitive-only subject evidence and explicitly reports omitted rows', () => {
  const f = fixture();
  const snapshot = snapshotSuppliedIndexEvidence(Array.from({ length: 20 }, () => f.car));
  expect(snapshot.sampledSubjects).toBe(INDEX_EVIDENCE_SUBJECT_LIMIT);
  expect(snapshot.owners).toHaveLength(INDEX_EVIDENCE_SUBJECT_LIMIT);
  expect(snapshot).toMatchObject({ subjects: 20, omittedSubjects: 8, truncated: true });
  expect(JSON.stringify(snapshot).length).toBeLessThan(4000);
  expect(JSON.stringify(snapshot)).not.toContain('submissions');
});
it('unavailable CPU diagnostics never prevent preparation or replace a failed draw', () => {
  const f = fixture();
  f.diagnostics.mockImplementation(() => {
    throw new Error('diagnostic unavailable');
  });
  expect(() => f.run()).not.toThrow();
  expect(f.prepareCamera).toHaveBeenCalledTimes(3);
  expect(f.target.preparation.checkpoint).toHaveBeenCalledWith(
    'mark',
    'indices:evidence-unavailable',
    0,
    expect.objectContaining({ before: null, afterPreparation: null }),
  );
  expect(() => f.target.indexEvidenceAfterDraw!(false)).not.toThrow();
});

it('reports a disabled compact owner as not applicable even when its ordinary helper declines', () => {
  const f = fixture();
  f.car.suppliedPlayer.lods.drawRanges.compact = false;
  f.prepareCamera.mockReturnValue(false);
  f.run();
  expect(f.target.preparation.checkpoint).toHaveBeenCalledWith(
    'mark',
    'indices:not-applicable',
    0,
    expect.objectContaining({
      before: expect.objectContaining({ subjects: 1, suppliedOwners: 1, eligibleOwners: 0 }),
    }),
  );
});
it('caps per-camera rows without changing preparation calls or inventing full evidence', () => {
  const f = fixture();
  f.target.cars = Array.from({ length: 20 }, () => f.car);
  f.run();
  expect(f.prepareCamera).toHaveBeenCalledTimes(60);
  const ready = f.target.preparation.checkpoint.mock.calls.find(
    (args) => args[1] === 'indices:evidence-unavailable',
  )![3];
  expect(ready.cameras).toHaveLength(36);
  expect(ready.cameraRowsDropped).toBe(24);
  expect(ready.before.truncated).toBe(true);
  expect(JSON.stringify(ready).length).toBeLessThan(32768);
});

it('retains the failed camera counters without replacing the allocation failure', () => {
  const f = fixture();
  f.prepareCamera.mockImplementationOnce(() => {
    throw new Error('original allocation failure');
  });
  expect(() => f.run()).toThrow('original allocation failure');
  const failed = f.target.preparation.checkpoint.mock.calls.find(
    (args) => args[1] === 'indices:error',
  )![3];
  expect(failed.cameras).toHaveLength(1);
  expect(failed.cameras[0]).toMatchObject({
    kind: 'mirror',
    cameraId: f.mirrors[0].id,
    prepared: false,
    returned: false,
    before: { buffers: 0 },
    after: { buffers: 0 },
  });
});
