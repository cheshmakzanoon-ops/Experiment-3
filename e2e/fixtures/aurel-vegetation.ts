import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { lightingDirection } from '../../src/rendering/daylight.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H, F, carBase } from '../../src/simulation/protocol.ts';
import { trackPoint } from '../../src/simulation/track.ts';
import { detailDistance } from '../../src/rendering/view-detail.ts';
import { attachDrawLedger } from '../../src/rendering/draw-ledger.ts';
import { buildVegetation } from '../../src/rendering/landscape.ts';

/** Full production factory and immutable simulation snapshots. The retained
 * procedural builder is a controlled scenery-substitution comparison, not a
 * fabricated historical capture. Fixed lap cameras are NOT a human-driven lap. */
export async function surveyAurelVegetation(lighting: 'day' | 'sunset' | 'night') {
  const width = 1280,
    height = 720;
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    opponents: 11,
    weather: lighting === 'night' ? 'rain' : 'clear',
    seed: 1887,
  });
  sim.autoPlayer = true;
  for (let i = 0; i < 8 * 120; i++) sim.step(1 / 120);
  const frame = sim.makeFrame().slice(),
    original = frame.slice(),
    water = sim.track.water.slice();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `display:block;width:${width}px;height:${height}px`;
  document.body.style.cssText = 'margin:0';
  document.body.append(canvas);
  const view = await RacingRenderer.create(
    canvas,
    sim.track,
    () => {},
    () => false,
    { quality: 'medium', graphics: { ...graphicsPreset('medium'), resolutionScale: 1 } },
  );
  if (!view?.circuit.vegetation) throw new Error('Missing production A51-A54 installation');
  const kit = view.circuit.vegetation;
  const gl = view.renderer.getContext(),
    pixels = new Uint8Array(width * height * 4);
  const ledger = attachDrawLedger(view.renderer);
  const images: {
    name: string;
    image: string;
    calls: number;
    triangles: number;
    range: number;
    passes: ReturnType<typeof ledger.snapshot>;
    cpuMs: number;
  }[] = [];
  const legacy = new T.Group();
  legacy.name = 'Retained planting comparison (test only)';
  const resources = () => ({ ...view.renderer.info.memory });
  const sourceIds = kit.chunks
    .flatMap((c) => c.meshes)
    .map((m) => ({
      mesh: m,
      geometry: m.geometry,
      position: m.geometry.getAttribute('position'),
      index: m.geometry.index,
      variant: m.geometry.getAttribute('treePosition'),
    }));
  const updateCut = () => {
    for (const name of [
      'concreteBarriers',
      'steelGuardrails',
      'catchFence',
      'impactBarriers',
      'recoveryGates',
      'marshalPosts',
      'startGantry',
      'signalHardware',
      'trackBoards',
      'broadcastCameras',
      'vegetation',
    ] as const)
      view.circuit[name]?.update(view.camera, 'medium');
    view.circuit.heroGarage?.update(view.camera, 'medium', lighting);
    view.tyreEquipment?.update(view.camera, 'medium');
    view.wheelGunStorage?.update(view.camera);
    view.circuit.tyreBlankets?.update(view.camera, 'medium', lighting);
    view.circuit.pitBuildingFrontage?.update(view.camera, 'medium', lighting);
    view.circuit.pitWallStation?.update(view.camera, 'medium', lighting, frame, 'HELD', true);
    for (let id = 0; id < frame[H.CARS]; id++) {
      const base = carBase(id),
        followed = id === view.reviewCar();
      const d = new T.Vector3(frame[base + F.X], frame[base + F.Y], frame[base + F.Z]).distanceTo(
        view.camera.position,
      );
      view.cars[id].setLod(
        followed ? 0 : detailDistance(d, view.camera.fov, view.camera.aspect),
        'medium',
        followed,
      );
      view.cars[id].update(frame, frame, base, 1, 0, frame[H.TIME], false);
    }
    view.circuit.startFinish.update(frame, view.camera, lighting === 'night');
    view.circuit.staff.update(frame, view.camera.position, true);
    for (const crowd of view.circuit.crowdClusters)
      crowd.update(
        frame[H.TIME],
        view.camera.position,
        frame[H.RAIN],
        frame,
        view.camera.fov,
        view.camera.aspect,
      );
    view.sun.target.position.copy(view.camera.position);
    view.sun.position.copy(view.camera.position).add(lightingDirection(lighting));
    view.venueLighting.update(
      lighting !== 'day',
      view.camera.position,
      lighting === 'sunset' ? 0.18 : 1,
    );
  };
  const render = () => {
    view.renderer.info.reset();
    ledger.begin();
    const start = performance.now();
    view.renderer.render(view.scene, view.camera);
    const cpuMs = performance.now() - start;
    ledger.end();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return cpuMs;
  };
  const capture = (name: string) => {
    const cpuMs = render();
    let min = 255,
      max = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const v = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    images.push({
      name,
      image: canvas.toDataURL('image/png'),
      calls: view.renderer.info.render.calls,
      triangles: view.renderer.info.render.triangles,
      range: max - min,
      passes: ledger.snapshot(),
      cpuMs,
    });
  };
  const point = trackPoint();
  const cut = (station: number, fov = 58, orchard = false) => {
    sim.track.at(station, point);
    view.camera.fov = fov;
    view.camera.position.set(
      point.x - point.nx * (orchard ? 36 : 1) - point.tx * (orchard ? 35 : 0),
      point.y + (orchard ? 4 : 2),
      point.z - point.nz * (orchard ? 36 : 1) - point.tz * (orchard ? 35 : 0),
    );
    view.camera.lookAt(
      point.x + point.tx * (orchard ? 6 : 35) - point.nx * (orchard ? 84 : 0),
      point.y + (orchard ? 1 : 0.5),
      point.z + point.tz * (orchard ? 6 : 35) - point.nz * (orchard ? 84 : 0),
    );
    view.camera.updateProjectionMatrix();
    view.camera.updateMatrixWorld(true);
    updateCut();
  };
  try {
    view.lighting = lighting;
    view.mode = 'cockpit';
    view.draw(frame, frame, 1, 1 / 60);
    const cockpit = {
      name: 'normal-cockpit',
      image: canvas.toDataURL('image/png'),
      stats: view.stats(),
    };
    const foliage = kit.chunks[0].templates.find((p) => p.foliage)!.material.map!;
    const mipmaps = foliage.mipmaps.map((m) => ({ width: m.width, height: m.height }));
    // Two scene graphs, one frozen simulation/lighting/camera and the same renderer.
    // Normal application installation never contains this comparison subtree.
    buildVegetation(
      sim.track,
      legacy,
      view.circuit.serviceSites,
      (x, z, padding) => view.circuit.recoveryGates?.blocksVegetation(x, z, padding) ?? false,
    );
    view.circuit.vegetationGroup.invalidateTransforms();
    view.circuit.vegetationGroup.add(legacy);
    legacy.visible = false;
    view.circuit.vegetationGroup.sealTransforms();
    const comparisons: {
      station: number;
      changedPixels: number;
      beforeCalls: number;
      afterCalls: number;
    }[] = [];
    for (const station of [640, 830]) {
      cut(station, 55, true);
      legacy.visible = true;
      kit.root.visible = false;
      render();
      capture(`orchard-${station}-retained`);
      const before = pixels.slice(),
        beforeCalls = images.at(-1)!.calls;
      legacy.visible = false;
      kit.root.visible = true;
      render();
      capture(`orchard-${station}-authored`);
      let changedPixels = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (
          Math.max(
            Math.abs(before[i] - pixels[i]),
            Math.abs(before[i + 1] - pixels[i + 1]),
            Math.abs(before[i + 2] - pixels[i + 2]),
          ) > 12
        )
          changedPixels++;
      comparisons.push({ station, changedPixels, beforeCalls, afterCalls: images.at(-1)!.calls });
    }
    // Closing two explicit cycles warms existing geometry/material paths, rather
    // than allocating until a memory test happens to pass. All measured cuts recur.
    const cuts = Array.from({ length: 16 }, (_, i) => (i * sim.track.length) / 16);
    for (let warm = 0; warm < 2; warm++)
      for (const s of cuts) {
        cut(s);
        render();
        cut(s, 16);
        render();
      }
    const memoryBefore = resources();
    const memories: ReturnType<typeof resources>[] = [];
    for (let cycle = 0; cycle < 2; cycle++)
      for (const s of cycle ? [...cuts].reverse() : cuts) {
        cut(s);
        if (cycle === 0) capture(`lap-${Math.round(s)}`);
        else render();
        memories.push(resources());
        cut(s, 16);
        render();
        memories.push(resources());
      }
    const identitiesUnchanged = sourceIds.every(
      ({ mesh, geometry, position, index, variant }) =>
        mesh.geometry === geometry &&
        geometry.getAttribute('position') === position &&
        geometry.index === index &&
        geometry.getAttribute('treePosition') === variant,
    );
    return {
      lighting,
      images,
      cockpit,
      comparisons,
      mipmaps,
      detail: kit.diagnostics(),
      identitiesUnchanged,
      memoryBefore,
      memories,
      sourceUnchanged: frame.every((v, i) => Object.is(v, original[i])),
      waterUnchanged: water.every((v, i) => v === sim.track.water[i]),
      glError: gl.getError(),
      contextLost: gl.isContextLost(),
      acceptance: {
        finalArt: false,
        humanLap: false,
        hardwarePerformance: false,
        historicalBaseline: false,
      },
    };
  } finally {
    view.circuit.vegetationGroup.invalidateTransforms();
    legacy.removeFromParent();
    // The retained builder shares geometry/materials within the subtree.
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    legacy.traverse((o) => {
      if (o instanceof T.Mesh) {
        geometries.add(o.geometry);
        for (const m of [
          ...(Array.isArray(o.material) ? o.material : [o.material]),
          o.customDepthMaterial,
          o.customDistanceMaterial,
        ])
          if (m) {
            materials.add(m);
            for (const v of Object.values(m)) if (v instanceof T.Texture) textures.add(v);
          }
        if (o instanceof T.InstancedMesh) o.dispose();
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
    view.dispose();
    canvas.remove();
  }
}
