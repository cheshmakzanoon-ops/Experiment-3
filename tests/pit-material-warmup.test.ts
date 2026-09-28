import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import * as T from 'three';
import { PitCrewView } from '../src/rendering/pit-crew.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { warmPitMaterials, type PitMaterialWarmup } from '../src/rendering/pit-material-warmup.ts';
import { CAR_STRIDE, HEADER, F, H, carBase } from '../src/simulation/protocol.ts';

function fixture() {
  const frame = new Float32Array(HEADER + CAR_STRIDE * 2),
    o = carBase(0);
  frame[H.CARS] = 2;
  frame[o + F.QW] = frame[carBase(1) + F.QW] = 1;
  const source = frame.slice();
  const camera = new T.PerspectiveCamera(60, 1.6),
    scene = new T.Scene();
  const root = new T.Group();
  root.visible = false;
  const target = new T.WebGLRenderTarget(8, 8);
  const state = {
    target,
    face: 2,
    mip: 1,
    viewport: new T.Vector4(2, 3, 80, 60),
    scissor: new T.Vector4(4, 5, 60, 40),
    scissorTest: true,
  };
  const saved = { ...state, viewport: state.viewport.clone(), scissor: state.scissor.clone() };
  const stages: { frame: Float32Array; distance: number; visible: boolean }[] = [];
  let draws = 0,
    submits = 0,
    disposed = 0,
    failDraw = false,
    cancelled = false,
    polls = 0;
  const renderer = {
    xr: { enabled: true },
    autoClear: false,
    shadowMap: { autoUpdate: true, needsUpdate: true },
    getRenderTarget: () => state.target,
    getActiveCubeFace: () => state.face,
    getActiveMipmapLevel: () => state.mip,
    getViewport: (out: T.Vector4) => out.copy(state.viewport),
    getScissor: (out: T.Vector4) => out.copy(state.scissor),
    getScissorTest: () => state.scissorTest,
    setRenderTarget(next: T.WebGLRenderTarget, face = 0, mip = 0) {
      state.target = next;
      state.face = face;
      state.mip = mip;
    },
    setViewport(x: T.Vector4 | number, y?: number, width?: number, height?: number) {
      if (x instanceof T.Vector4) state.viewport.copy(x);
      else state.viewport.set(x, y!, width!, height!);
    },
    setScissor(value: T.Vector4) {
      state.scissor.copy(value);
    },
    setScissorTest(value: boolean) {
      state.scissorTest = value;
    },
    render() {
      draws++;
      assert.notEqual(state.target, target);
      assert.deepEqual([state.target.width, state.target.height], [32, 20]);
      assert.equal(state.target.texture.type, T.HalfFloatType);
      assert.equal(renderer.shadowMap.autoUpdate, false);
      assert.equal(renderer.shadowMap.needsUpdate, false);
      if (draws === 1) state.target.addEventListener('dispose', () => disposed++);
      if (failDraw) throw new Error('GPU submission failed');
    },
  };
  const options: PitMaterialWarmup = {
    renderer: renderer as unknown as T.WebGLRenderer,
    scene,
    camera,
    frame,
    crew: {
      root,
      update(sample, probe, visible = true) {
        stages.push({ frame: sample, distance: probe.x - sample[o + F.X], visible });
      },
    },
    submitted: () => {
      submits++;
      polls = 0;
    },
    ready: () => ++polls > 1,
    cancelled: () => cancelled,
    yieldFrame: async () => {
      assert.deepEqual(frame, source);
      assert.equal(state.target, target);
      assert.equal(root.visible, false);
    },
  };
  const restored = () => {
    assert.deepEqual(frame, source);
    assert.equal(state.target, target);
    assert.deepEqual(state, saved);
    assert.equal(root.visible, false);
    assert.equal(renderer.xr.enabled, true);
    assert.equal(renderer.autoClear, false);
    assert.deepEqual(renderer.shadowMap, { autoUpdate: true, needsUpdate: true });
    assert.equal(stages.at(-1)?.frame, frame);
    assert.equal(disposed, 1);
  };
  return {
    options,
    stages,
    restored,
    source,
    frame,
    renderer,
    counts: () => ({ draws, submits }),
    fail: () => {
      failDraw = true;
    },
    cancel: () => {
      cancelled = true;
    },
  };
}

describe('offscreen pit material warmup ownership', () => {
  it('warms both layouts, waits for completion and never edits the live frame', async () => {
    const f = fixture();
    assert.equal(await warmPitMaterials(f.options), 2);
    assert.deepEqual(f.counts(), { draws: 2, submits: 2 });
    assert.deepEqual(
      f.stages.filter((s) => s.frame !== f.frame).map((s) => s.distance),
      [0, 60],
    );
    assert.equal(f.stages[0].frame[carBase(0) + F.PIT_PHASE], 3);
    assert.equal(f.stages[0].frame[carBase(1) + F.PIT_PHASE], 0);
    assert.notEqual(f.stages[0].frame, f.frame);
    f.restored();
  });
  it('restores render ownership, original crew and resources after a GPU error', async () => {
    const f = fixture();
    f.fail();
    await assert.rejects(warmPitMaterials(f.options), /GPU submission failed/);
    f.restored();
  });
  it('returns without allocating or drawing when already cancelled', async () => {
    const f = fixture();
    f.cancel();
    assert.equal(await warmPitMaterials(f.options), 0);
    assert.deepEqual(f.counts(), { draws: 0, submits: 0 });
    assert.equal(f.stages.length, 0);
  });
  it('stops a pending GPU warmup on cancellation and restores the original scene', async () => {
    const f = fixture();
    f.options.ready = () => false;
    f.options.yieldFrame = async () => f.cancel();
    assert.equal(await warmPitMaterials(f.options), 1);
    assert.deepEqual(f.counts(), { draws: 1, submits: 1 });
    f.restored();
  });
  it('exercises all fifteen actual authored actors in each layout, then restores the real grid', async () => {
    const f = fixture(),
      crew = new PitCrewView();
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'race',
      opponents: 7,
      weather: 'clear',
    });
    const frame = sim.makeFrame(),
      original = frame.slice();
    f.options.crew = crew;
    f.options.frame = frame;
    const layouts: number[][] = [],
      render = f.renderer.render;
    f.renderer.render = () => {
      const d = crew.diagnostics();
      assert.equal(d.actors, 15);
      assert.equal(d.crews, 1);
      layouts.push(d.counts.slice(0, 2));
      render();
    };
    try {
      assert.equal(await warmPitMaterials(f.options), 2);
      assert.deepEqual(layouts, [
        [15, 0],
        [0, 15],
      ]);
      assert.equal(crew.activeActors, 0);
      assert.deepEqual(frame, original);
    } finally {
      crew.dispose();
    }
  });
  it('submits only crew surfaces while preserving child lights and restoring all layer masks', async () => {
    const f = fixture(),
      scene = f.options.scene;
    const mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
    const hiddenMesh = mesh.clone();
    hiddenMesh.visible = false;
    const group = new T.Group(),
      light = new T.PointLight();
    group.add(mesh);
    mesh.add(light);
    mesh.layers.enable(5);
    const crewMesh = mesh.clone();
    f.options.crew.root.add(crewMesh);
    const line = new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial());
    const sprite = new T.Sprite();
    scene.add(group, hiddenMesh, line, sprite, f.options.crew.root);
    const draw = f.renderer.render;
    f.renderer.render = () => {
      expectHidden();
      assert.equal(group.visible, true);
      assert.equal(light.visible, true);
      assert.equal(crewMesh.visible, true);
      assert.equal(f.options.crew.root.visible, true);
      draw();
    };
    function expectHidden() {
      for (const object of [mesh, hiddenMesh, line, sprite]) assert.equal(object.layers.mask, 0);
    }
    const restored = () => {
      assert.equal(mesh.visible, true);
      assert.equal(mesh.layers.mask, 33);
      assert.equal(hiddenMesh.layers.mask, 1);
      assert.equal(line.layers.mask, 1);
      assert.equal(sprite.layers.mask, 1);
      assert.equal(hiddenMesh.visible, false);
      assert.equal(line.visible, true);
      assert.equal(sprite.visible, true);
    };
    f.options.yieldFrame = async () => restored();
    assert.equal(await warmPitMaterials(f.options), 2);
    restored();
    f.fail();
    await assert.rejects(warmPitMaterials(f.options), /GPU submission failed/);
    restored();
    mesh.geometry.dispose();
    (mesh.material as T.Material).dispose();
    line.geometry.dispose();
    (line.material as T.Material).dispose();
    sprite.material.dispose();
  });
  it('rejects invalid frame bounds before touching rendering resources', async () => {
    const f = fixture();
    f.frame[H.CARS] = 12;
    await assert.rejects(warmPitMaterials(f.options), /Invalid pit material warmup frame/);
    assert.deepEqual(f.counts(), { draws: 0, submits: 0 });
  });
});
