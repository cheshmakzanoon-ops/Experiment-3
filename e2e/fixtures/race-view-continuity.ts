/** Actual asset-loading factory and full renderer with deliberate test-only
 * pose/camera cuts. These controlled frames are not a completed race, telemetry
 * receipt or human/hardware acceptance. Ordinary race suites remain separate. */
import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { F, H, carBase } from '../../src/simulation/protocol.ts';
import { carLod } from '../../src/rendering/lod.ts';
import { detailDistance } from '../../src/rendering/view-detail.ts';
import { visibleReducedWheelPivots } from './visible-wheel-pivots.ts';
import { DEFAULT_PHOTO } from '../../src/rendering/photo-camera.ts';

export async function raceViewContinuity() {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 1 });
  const a = sim.makeFrame(),
    b = a.slice();
  const p = new T.Vector3();
  a[H.TIME] = 10;
  b[H.TIME] = 10.1;
  // A controlled long-baseline camera cut makes stale-camera LOD observable on
  // the first frame. No production simulation or saved replay is modified.
  a[carBase(1) + F.X] += 300;
  b.set(a);
  b[H.TIME] = 10.1;
  b[carBase(1) + F.X] += 40;
  const originalA = a.slice(),
    originalB = b.slice();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:640px;height:400px;display:block';
  document.body.style.cssText = 'margin:0';
  document.body.append(canvas);
  const view = await RacingRenderer.create(
    canvas,
    sim.track,
    () => {},
    () => false,
  );
  if (!view) throw new Error('Scene construction cancelled');
  const rows = [];
  let staleDecisionDifferences = 0;
  try {
    view.setQuality('low');
    view.setCars(2);
    const draw = (name: string, follow: number, alpha: number, zoom: boolean) => {
      view.setPhoto(
        {
          ...DEFAULT_PHOTO,
          target: follow,
          view: zoom ? 'orbit' : 'chase',
          focalLength: 150,
          distance: 40,
        },
        2,
      );
      view.changeCamera('chase');
      const previous = view.cars.map((c) => c.lodLevel),
        oldCamera = view.camera.position.clone();
      view.draw(a, b, alpha, 1 / 60, false, true);
      const levels = view.cars.map((c) => c.lodLevel);
      const expected = view.cars.map((c, i) =>
        carLod(
          detailDistance(
            c.root.position.distanceTo(view.camera.position),
            view.camera.fov,
            view.camera.aspect,
          ),
          previous[i],
          'low',
          i === follow,
        ),
      );
      const stale = view.cars.map((_, i) => {
        const o = carBase(i);
        return carLod(
          p.set(b[o + F.X], b[o + F.Y], b[o + F.Z]).distanceTo(oldCamera),
          previous[i],
          'low',
          i === follow,
        );
      });
      staleDecisionDifferences += levels.filter((l, i) => l !== stale[i]).length;
      // Read the posed active wheels, not just the visibility flags. A late LOD
      // swap after update() can otherwise display an unposed representation.
      const wheels = view.cars.map((c) => {
        const active =
          c.suppliedPlayer?.wheels ??
          (c.lodLevel ? visibleReducedWheelPivots(c.root) : c.wheelPivots);
        return active.map((w) => w.position.toArray());
      });
      return {
        name,
        follow,
        alpha,
        levels,
        expected,
        stale,
        wheels,
        camera: view.camera.position.toArray(),
        fov: view.camera.fov,
        image: canvas.toDataURL('image/png'),
        triangles: view.renderer.info.render.triangles,
        calls: view.renderer.info.render.calls,
      };
    };
    // Warm both direction cuts and both selected detail representations before
    // testing bounded resources. Exact identity is checked by normal loaders.
    draw('warm-0', 0, 1, false);
    draw('warm-1', 1, 0.25, false);
    draw('warm-photo', 0, 0.25, true);
    const before = { ...view.renderer.info.memory };
    rows.push(draw('first-follow-0', 0, 1, false));
    rows.push(draw('first-follow-1', 1, 0.25, false));
    rows.push(draw('held-follow-1', 1, 0.25, false));
    rows.push(draw('photo-long-lens', 0, 0.25, true));
    rows.push(draw('rewound-follow-0', 0, 1, false));
    return {
      rows,
      before,
      after: { ...view.renderer.info.memory },
      staleDecisionDifferences,
      sourceUnchanged:
        a.every((v, i) => Object.is(v, originalA[i])) &&
        b.every((v, i) => Object.is(v, originalB[i])),
      authored: view.stats().authoredDriver,
      glError: view.renderer.getContext().getError(),
      scope: 'Controlled production renderer camera cuts, not human driving or target-hardware FPS',
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}

/** Cold first-use shader regression, with the original lazy-colour behaviour
 * as a negative control. No simulation observations or race receipts are made. */
export async function coldPitPrograms(preallocate: boolean) {
  const { PitCrewView } = await import('../../src/rendering/pit-crew.ts');
  const { HEADER, CAR_STRIDE, W, WHEEL_BASE, WHEEL_STRIDE } = await import(
    '../../src/simulation/protocol.ts'
  );
  const crew = new PitCrewView(),
    scene = new T.Scene();
  const camera = new T.PerspectiveCamera(58, 640 / 400, 0.1, 200);
  camera.position.set(7, 5, 10);
  camera.lookAt(0, 0.6, 0);
  scene.background = new T.Color(0x23303b);
  scene.add(crew.root, new T.HemisphereLight(0xffffff, 0x555555, 2));
  const sun = new T.DirectionalLight(0xffffff, 3);
  sun.position.set(5, 8, 6);
  scene.add(sun);
  const cloth = crew.root.children.slice(0, 2) as T.InstancedMesh[];
  if (!preallocate)
    cloth.forEach((mesh) => {
      mesh.instanceColor = null;
    });
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(640, 400);
  document.body.append(renderer.domElement);
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  frame[H.CARS] = 1;
  frame[H.PHASE] = 3;
  frame[H.TIME] = 100;
  frame[o + F.QW] = 1;
  frame[o + F.Y] = 0.6;
  frame[o + F.IN_PIT] = 1;
  frame[o + F.PIT_PHASE] = 3;
  frame[o + F.PIT_CLOCK] = 1.8;
  frame[o + F.JACK_HEIGHT] = 0.16;
  for (let w = 0; w < 4; w++) frame[o + WHEEL_BASE + w * WHEEL_STRIDE + W.LENGTH] = 0.3;
  const original = frame.slice();
  const programs = () => renderer.info.programs?.length ?? 0;
  try {
    // Production prepare() already compiles this scene with zero visible crew.
    // The first real update must not change its instancing-colour program key.
    await renderer.compileAsync(scene, camera);
    const before = programs(),
      emptyActors = crew.activeActors;
    crew.update(frame, camera.position);
    renderer.render(scene, camera);
    const first = programs(),
      nearActors = crew.activeActors;
    const image = renderer.domElement.toDataURL('image/png');
    camera.position.set(0, 3, 70);
    camera.lookAt(0, 0.6, 0);
    crew.update(frame, camera.position);
    renderer.render(scene, camera);
    const mid = programs(),
      midActors = crew.activeActors;
    const memory = { ...renderer.info.memory };
    crew.update(frame, camera.position);
    renderer.render(scene, camera);
    return {
      preallocate,
      before,
      first,
      mid,
      held: programs(),
      emptyActors,
      nearActors,
      midActors,
      image,
      memory,
      after: { ...renderer.info.memory },
      glError: renderer.getContext().getError(),
      sourceUnchanged: frame.every((v, i) => Object.is(v, original[i])),
      scope: 'Controlled shader-variant stability; not first-stop timing or human acceptance',
    };
  } finally {
    crew.dispose();
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>();
    scene.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      geometries.add(object.geometry);
      for (const m of Array.isArray(object.material) ? object.material : [object.material])
        materials.add(m);
      if (object.customDepthMaterial) materials.add(object.customDepthMaterial);
      if (object.customDistanceMaterial) materials.add(object.customDistanceMaterial);
      if (object instanceof T.InstancedMesh) object.dispose();
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    renderer.dispose();
    renderer.domElement.remove();
  }
}
