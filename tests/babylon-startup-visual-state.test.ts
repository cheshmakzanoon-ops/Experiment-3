import { readFileSync } from 'node:fs';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { loadBabylonStartGantry } from '../src/engine/babylon/start-gantry.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Animation } from '@babylonjs/core/Animations/animation.js';
import { BabylonCircuitScene } from '../src/engine/babylon/circuit-scene.ts';
import {
  captureStartupVisualState,
  inspectStartupVisualState,
} from '../src/engine/babylon/startup-visual-state.ts';
import { SimulationComponent } from '../src/engine/simulation-component.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((f) => f());
  vi.restoreAllMocks();
});
function setup() {
  const engine = new NullEngine();
  const component = new SimulationComponent({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  // Deliberately ineligible context: no WebGL-only original substrate preparation.
  const view = new BabylonCircuitScene(engine, component.simulation.track, 1);
  cleanups.push(() => {
    view.dispose();
    engine.dispose();
  });
  component.setPaused(true);
  view.render(component.frame);
  return { view, component };
}

describe('audited static startup CPU visual fingerprint', () => {
  it('remains identical across actual renders of the same paused authoritative snapshot', () => {
    const { view, component } = setup();
    const frame = component.frame.slice();
    const tick = component.simulation.tick;
    const first = captureStartupVisualState(view);
    expect(first).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      view.render(component.frame);
      expect(captureStartupVisualState(view)).toBe(first);
    }
    expect(component.frame).toEqual(frame);
    expect(component.simulation.tick).toBe(tick);
  });
  it('does not ask scene readiness, compute world matrices, or render', () => {
    const { view } = setup();
    const ready = vi.spyOn(view.scene, 'isReady').mockImplementation(() => {
      throw new Error('off-lane readiness');
    });
    const matrix = vi.spyOn(view.camera, 'getWorldMatrix').mockImplementation(() => {
      throw new Error('matrix computation');
    });
    const render = vi.spyOn(view.scene, 'render');
    expect(captureStartupVisualState(view)).not.toBeNull();
    expect(ready).not.toHaveBeenCalled();
    expect(matrix).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
  it.each(['position', 'projection', 'material', 'mesh', 'visibility', 'binding'] as const)(
    'detects %s mutations',
    (kind) => {
      const { view } = setup();
      const before = captureStartupVisualState(view);
      const mesh = view.scene.meshes[0];
      if (kind === 'position') view.camera.position.x += 1;
      if (kind === 'projection') view.camera.fov += 0.1;
      if (kind === 'material') (mesh.material as StandardMaterial).diffuseColor.r += 0.1;
      if (kind === 'mesh') mesh.position.z += 1;
      if (kind === 'visibility') mesh.isVisible = false;
      if (kind === 'binding') mesh.material = new StandardMaterial('replacement', view.scene);
      expect(captureStartupVisualState(view)).not.toBe(before);
    },
  );
  it('captures PBR emission and original raw texture transforms/bindings', () => {
    const { view } = setup();
    const material = new PBRMaterial('lamp', view.scene);
    view.scene.meshes[0].material = material;
    const texture = RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, view.scene);
    material.albedoTexture = texture;
    const first = captureStartupVisualState(view);
    expect(first).not.toBeNull();
    material.emissiveColor.r = 1;
    const second = captureStartupVisualState(view);
    expect(second).not.toBe(first);
    texture.uOffset = 0.25;
    expect(captureStartupVisualState(view)).not.toBe(second);
  });
  it.each([
    'controls',
    'gravity',
    'collisions',
    'translation',
    'rotation',
    'animation',
    'disposed',
    'nonfinite',
  ] as const)('rejects unproven %s state', (kind) => {
    const { view } = setup();
    if (kind === 'controls') view.camera.inputs.attachedToElement = true;
    if (kind === 'gravity') view.camera.applyGravity = true;
    if (kind === 'collisions') view.camera.checkCollisions = true;
    if (kind === 'translation') view.camera.cameraDirection.x = 0.01;
    if (kind === 'rotation') view.camera.cameraRotation.y = 0.01;
    if (kind === 'animation')
      view.scene.meshes[0].animations.push(
        new Animation('moving', 'position.x', 30, Animation.ANIMATIONTYPE_FLOAT),
      );
    if (kind === 'disposed') view.dispose();
    if (kind === 'nonfinite') view.camera.position.x = NaN;
    expect(captureStartupVisualState(view)).toBeNull();
    view.camera.inputs.attachedToElement = false;
  });
  it('bounds unknown oversized scene collections', () => {
    const { view } = setup();
    const original = view.scene.meshes.slice();
    try {
      view.scene.meshes.push(...Array(1025).fill(view.scene.meshes[0]));
      expect(captureStartupVisualState(view)).toBeNull();
    } finally {
      view.scene.meshes.splice(0, view.scene.meshes.length, ...original);
    }
  });
});

it.each([
  'panAccumulatedPixels',
  'rotationAccumulatedPixels',
  'panDeltaCurrentFrame',
  'rotationDeltaCurrentFrame',
] as const)('rejects retained movement %s even with zero legacy inputs', (field) => {
  const { view } = setup();
  expect(view.camera.cameraDirection.lengthSquared()).toBe(0);
  expect(view.camera.cameraRotation.lengthSquared()).toBe(0);
  view.camera.movement[field].x = 0.001;
  expect(captureStartupVisualState(view)).toBeNull();
});
it('rejects actual post-input inertial glide after legacy direction resets', () => {
  const { view, component } = setup();
  view.camera.cameraDirection.x = 1;
  view.render(component.frame);
  expect(view.camera.cameraDirection.lengthSquared()).toBe(0);
  expect(view.camera.movement.panDeltaCurrentFrame.lengthSquared()).toBeGreaterThan(0);
  expect(captureStartupVisualState(view)).toBeNull();
});

it.each(['mesh', 'transform-node'] as const)(
  'detects changed frozen cached world matrix on %s without recomputing it',
  (kind) => {
    const { view } = setup();
    const node = kind === 'mesh' ? view.scene.meshes[0] : view.entrants[0];
    node.freezeWorldMatrix(Matrix.Translation(1, 2, 3));
    const before = captureStartupVisualState(view);
    const position = node.position.clone();
    node.freezeWorldMatrix(Matrix.Translation(4, 5, 6));
    const get = vi.spyOn(node, 'getWorldMatrix').mockImplementation(() => {
      throw new Error('must not compute');
    });
    const compute = vi.spyOn(node, 'computeWorldMatrix').mockImplementation(() => {
      throw new Error('must not compute');
    });
    const after = captureStartupVisualState(view);
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(node.position.equals(position)).toBe(true);
    expect(get).not.toHaveBeenCalled();
    expect(compute).not.toHaveBeenCalled();
    expect(JSON.parse(after!)).toHaveLength(25);
    expect(JSON.parse(after!)[0]).toHaveLength(6);
  },
);
it('reads an eagerly constructed camera movement owner without replacing or constructing it', () => {
  const { view } = setup();
  const descriptor = Object.getOwnPropertyDescriptor(view.camera, 'movement');
  expect(descriptor).toHaveProperty('value', view.camera.movement);
  expect(descriptor?.get).toBeUndefined();
  const movement = view.camera.movement;
  const before = Object.getOwnPropertyDescriptors(movement);
  expect(captureStartupVisualState(view)).not.toBeNull();
  expect(view.camera.movement).toBe(movement);
  expect(Object.getOwnPropertyDescriptors(movement)).toEqual(before);
});

it.each(['mesh', 'transform-node'] as const)(
  'detects frozen flag changes on %s with an identical cached matrix',
  (kind) => {
    const { view } = setup();
    const node = kind === 'mesh' ? view.scene.meshes[0] : view.entrants[0];
    const matrix = node.worldMatrixFromCache.clone();
    const before = captureStartupVisualState(view);
    expect(node.isWorldMatrixFrozen).toBe(false);
    node.freezeWorldMatrix(matrix);
    expect(node.isWorldMatrixFrozen).toBe(true);
    expect(Array.from(node.worldMatrixFromCache.m)).toEqual(Array.from(matrix.m));
    const after = captureStartupVisualState(view);
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  },
);

it('captures the actual pinned installed A07 glTF transform-only root without inventing draw metadata', async () => {
  const { view, component } = setup();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(new Uint8Array(readFileSync('public/models/aurel-start-gantry.glb'))),
    ),
  );
  cleanups.push(() => vi.unstubAllGlobals());
  const owner = await loadBabylonStartGantry(
    {
      scene: view.scene,
      track: component.simulation.track,
      context: {
        presentation: 'circuit',
        vehicles: [{ classId: 'formula', dynamicsKind: 'four-wheel' }],
      },
      base: 'http://localhost/',
      signal: new AbortController().signal,
      deadline: performance.now() + 120000,
      isCurrent: () => true,
      schedule: new PresentationSchedule(),
      gpu: {
        prepare: async (
          _label: string,
          _deadline: number,
          work: (signal: AbortSignal) => Promise<unknown>,
        ) => work(new AbortController().signal),
      } as Parameters<typeof loadBabylonStartGantry>[0]['gpu'],
    },
    { prepare: async () => {}, present: async () => {} },
  );
  cleanups.push(() => owner.dispose());
  await owner.install();
  view.render(component.frame);
  const root = view.scene.meshes.find((mesh) => mesh.name === '__root__') as Mesh;
  expect(root).toBeInstanceOf(Mesh);
  expect(root.geometry).toBeNull();
  expect(root.subMeshes).toBeUndefined();
  expect(root.getTotalVertices()).toBe(0);
  expect(root.getTotalIndices()).toBe(0);
  expect(root.parent?.name).toBe('A07 original start station');
  expect(owner.diagnostics().activeParts).toBe(4);
  const before = captureStartupVisualState(view);
  expect(before).not.toBeNull();
  expect(inspectStartupVisualState(view).rejectionCode).toBeNull();
  expect(root.subMeshes).toBeUndefined(); // The observer must not alter the actual graph.
  const rootRow = JSON.parse(before!)[21].find((row: unknown[][]) => row[0][0] === root.uniqueId);
  expect(rootRow[10]).toEqual([]);
  const parent = root.parent;
  root.parent = view.entrants[0];
  expect(captureStartupVisualState(view)).not.toBe(before);
  root.parent = parent;
  expect(captureStartupVisualState(view)).toBe(before);
  const localPosition = root.position.clone();
  root.freezeWorldMatrix(Matrix.Translation(4, 5, 6));
  expect(root.position.equals(localPosition)).toBe(true);
  expect(captureStartupVisualState(view)).not.toBe(before);
});

it.each(['undefined', 'null', 'malformed'] as const)(
  'rejects %s draw metadata on a real geometry-bearing mesh',
  (kind) => {
    const { view } = setup();
    const mesh = view.scene.meshes[0];
    const original = mesh.subMeshes;
    expect((mesh as Mesh).geometry).not.toBeNull();
    try {
      Object.defineProperty(mesh, 'subMeshes', {
        configurable: true,
        writable: true,
        value: kind === 'undefined' ? undefined : kind === 'null' ? null : { length: 0 },
      });
      expect(inspectStartupVisualState(view)).toEqual({
        state: null,
        rejectionCode: 'unproven-mesh-draw-metadata',
      });
    } finally {
      mesh.subMeshes = original;
    }
  },
);
it.each([null, { length: 0 }])('rejects malformed transform-only mesh metadata %s', (value) => {
  const { view } = setup();
  const root = new Mesh('nonrendering unknown', view.scene);
  try {
    Object.defineProperty(root, 'subMeshes', { configurable: true, writable: true, value });
    expect(captureStartupVisualState(view)).toBeNull();
  } finally {
    Object.defineProperty(root, 'subMeshes', {
      configurable: true,
      writable: true,
      value: undefined,
    });
  }
});

it.each([undefined, null, false, 0, ''])(
  'reports bounded capture-exception for unexpected getter failure %s',
  (error) => {
    const { view } = setup();
    Object.defineProperty(view.camera, 'parent', {
      configurable: true,
      get() {
        throw error;
      },
    });
    try {
      expect(inspectStartupVisualState(view)).toEqual({
        state: null,
        rejectionCode: 'capture-exception',
      });
      expect(captureStartupVisualState(view)).toBeNull();
    } finally {
      Object.defineProperty(view.camera, 'parent', {
        configurable: true,
        writable: true,
        value: null,
      });
    }
  },
);
it('reports an unsupported camera category without granting state', () => {
  const { view } = setup();
  view.camera.cameraDirection.x = 1;
  expect(inspectStartupVisualState(view)).toEqual({
    state: null,
    rejectionCode: 'unsupported-scene-or-camera',
  });
});

it.each(['vertices', 'indices'] as const)(
  'rejects an absent-submesh geometryless node with contradictory %s count',
  (kind) => {
    const { view } = setup();
    const root = new Mesh('unproven root', view.scene);
    vi.spyOn(root, kind === 'vertices' ? 'getTotalVertices' : 'getTotalIndices').mockReturnValue(1);
    expect(inspectStartupVisualState(view)).toEqual({
      state: null,
      rejectionCode: 'unproven-mesh-draw-metadata',
    });
  },
);
it.each(['row', 'limit'] as const)(
  'rejects unproven submesh %s metadata without weakening bounds',
  (kind) => {
    const { view } = setup();
    const mesh = view.scene.meshes[0],
      original = mesh.subMeshes;
    try {
      Object.defineProperty(mesh, 'subMeshes', {
        configurable: true,
        writable: true,
        value: kind === 'row' ? [{}] : Array(129).fill(original[0]),
      });
      expect(inspectStartupVisualState(view)).toEqual({
        state: null,
        rejectionCode: 'unproven-mesh-draw-metadata',
      });
    } finally {
      mesh.subMeshes = original;
    }
  },
);
