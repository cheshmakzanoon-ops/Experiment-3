import * as T from 'three';
import { clamp } from '../../src/core/math.ts';
import { CIRCUITS } from '../../src/simulation/circuits.ts';
import { gpCornerShapes } from '../../src/simulation/gp-corner-shape.ts';
import { Track, trackPoint } from '../../src/simulation/track.ts';
import { CircuitScene } from '../../src/rendering/circuit.ts';
import { StaticTransformGroup } from '../../src/rendering/static-transform-group.ts';
import { surfaceMaterial } from '../../src/rendering/surface-detail.ts';
import { WeatherPresentation } from '../../src/rendering/weather-presentation.ts';
import { buildBoards } from '../../src/rendering/venue-kit/structures.ts';
import type { GpCourseBridgeSite } from '../../src/rendering/venue-kit/gp-course-bridge.ts';
import { VenueKitContext } from '../../src/rendering/venue-kit/context.ts';
import { buildBarrierChunk } from '../../src/rendering/venue-kit/barriers.ts';
import { chunks } from '../../src/rendering/venue-kit/sweep.ts';

/** Isolated real course geometry/material review. The surrounding surfaces
 * provide the actual graded road datum; this is not a complete gameplay or
 * whole-scene performance capture. Actual app journeys remain separate. */
export function captureGpCourse() {
  const track = new Track('clear', false, undefined, CIRCUITS['poggio-alto']),
    kit = new VenueKitContext(track),
    corner = track.circuit.corners[0],
    shape = gpCornerShapes(track)[0],
    entry = corner.s - shape.entry,
    surfaces = new StaticTransformGroup(),
    ribbon = Object.create(CircuitScene.prototype) as CircuitScene;
  Object.assign(ribbon, { track, surfaces });
  buildBoards(kit);
  const bridgeRoot = kit.root.children.find((object) => object.userData.gpCourseBridge),
    bridge = bridgeRoot?.userData.gpCourseBridge as GpCourseBridgeSite | undefined;
  if (!bridgeRoot || !bridge) throw new Error('Missing production GP course bridge');
  const spans: [number, number][] = [
    [entry - 250, corner.s + shape.exit + 70],
    [bridge.s - 110, bridge.s + 60],
  ];
  spans.sort((a, b) => a[0] - b[0]);
  if (spans[1][0] <= spans[0][1]) {
    spans[0][1] = Math.max(spans[0][1], spans[1][1]);
    spans.splice(1, 1);
  }
  const road = surfaceMaterial('asphalt'),
    p = trackPoint();
  for (const [from, to] of spans) {
    for (const [start, end] of chunks(from, to, 60)) buildBarrierChunk(kit, start, end);
    // Production ribbons, the same materials as the course kit, same geometry
    // datum. No billboard or simplified proxy stands in for the new hardware.
    ribbon.ribbon(kit.materials.ground, {
      start: from,
      end: to,
      columns: 8,
      offset: (s, t) => (t * 2 - 1) * (track.at(s, p).width + 40),
      height: () => -0.07,
    });
    for (const side of [-1, 1] as const)
      ribbon.ribbon(kit.materials.gravel, {
        start: from,
        end: to,
        columns: 5,
        offset: (s, t) => {
          track.at(s, p);
          return side * (p.width + 1.5 + t * (track.boundaryAt(p, side) - p.width - 1.5));
        },
        height: () => -0.025,
      });
    ribbon.ribbon(road, {
      start: from,
      end: to,
      columns: 10,
      offset: (s, t) => (t * 2 - 1) * track.at(s, p).width,
    });
    for (const side of [-1, 1] as const)
      ribbon.ribbon(kit.materials.concrete, {
        start: from,
        end: to,
        offset: (s, t) => side * (track.at(s, p).width - 0.15 + t * 0.13),
        height: () => 0.004,
      });
  }
  surfaces.sealTransforms();
  kit.root.sealTransforms();
  const scene = new T.Scene();
  scene.background = new T.Color(0xb8c9d5);
  scene.add(surfaces, kit.root);
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1000, 640);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const camera = new T.PerspectiveCamera(53, 1000 / 640, 0.1, 1100),
    sun = new T.DirectionalLight(0xffefdb, 2.6),
    centre = track.at(corner.s, trackPoint());
  sun.position.set(centre.x - 80, centre.y + 170, centre.z + 35);
  sun.target.position.set(centre.x, centre.y, centre.z);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, {
    left: -160,
    right: 160,
    top: 160,
    bottom: -160,
    near: 1,
    far: 500,
  });
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target, new T.HemisphereLight(0xd1e5ff, 0x675d47, 1.6));
  const weather = new WeatherPresentation();
  weather.install(scene);
  const place = (station: number, lateral: number, above: number) => {
    const at = track.at(station, trackPoint());
    return new T.Vector3(
      at.x + at.nx * lateral,
      at.y + at.bank * clamp(lateral, -12, 12) + above,
      at.z + at.nz * lateral,
    );
  };
  const outside = shape.direction === 'left' ? -1 : 1;
  const resources = () => ({
    ...renderer.info.memory,
    programs: renderer.info.programs?.length ?? 0,
  });
  const draw = (view: 'approach' | 'padding' | 'bridge', wet: boolean) => {
    const focus = view === 'bridge' ? track.at(bridge.s, trackPoint()) : centre;
    sun.position.set(focus.x - 80, focus.y + 170, focus.z + 35);
    sun.target.position.set(focus.x, focus.y, focus.z);
    if (view === 'bridge') {
      camera.position.copy(place(bridge.s - 70, -1.8, 1.3));
      camera.lookAt(place(bridge.s + 40, 0, 1.8));
    } else if (view === 'approach') {
      camera.position.copy(place(entry - 91, outside * 4, 1.3));
      camera.lookAt(place(entry - 5, outside * 3, 1.1));
    } else {
      const s = corner.s + 4,
        boundary = track.boundary(s, outside);
      camera.position.copy(place(s - 5, outside * (boundary - 6.5), 1.35));
      camera.lookAt(place(s + 7, outside * (boundary - 0.6), 0.8));
    }
    camera.updateMatrixWorld(true);
    weather.surface.value.set(wet ? 1 : 0, 0, 0, 0);
    for (const cell of kit.cells)
      cell.object.visible = cell.centre.distanceTo(camera.position) < cell.range;
    renderer.render(scene, camera);
    const gl = renderer.getContext(),
      pixels = new Uint8Array(1000 * 640 * 4);
    gl.readPixels(0, 0, 1000, 640, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261;
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619);
    return {
      view,
      wet,
      image: renderer.domElement.toDataURL('image/png'),
      hash: hash >>> 0,
      error: gl.getError(),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      resources: resources(),
    };
  };
  try {
    draw('bridge', false);
    draw('bridge', true);
    draw('approach', false);
    draw('padding', true);
    const approach = draw('approach', false),
      held = draw('approach', false),
      padding = draw('padding', false),
      wet = draw('padding', true),
      rewind = draw('approach', false),
      bridgeDry = draw('bridge', false),
      bridgeHeld = draw('bridge', false),
      bridgeWet = draw('bridge', true),
      bridgeRestored = draw('bridge', false);
    let covers = 0;
    kit.root.traverse((object) => {
      if (object instanceof T.InstancedMesh && object.name === 'GP rounded protective covers')
        covers += object.count;
    });
    return {
      captures: [approach, held, padding, wet, rewind, bridgeDry, bridgeHeld, bridgeWet, bridgeRestored],
      bridgeSite: bridge,
      bridgeMeshes: bridgeRoot.children.length,
      covers,
      markerGroups: kit.cells.filter((cell) => cell.object.name.startsWith('GP T')).length,
    };
  } finally {
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    scene.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        materials.add(material);
    });
    for (const material of materials) {
      for (const value of Object.values(material))
        if (value instanceof T.Texture) textures.add(value);
      material.dispose();
    }
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    weather.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
