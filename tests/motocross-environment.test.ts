import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { BuildQueue } from '../src/rendering/build-queue.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { OffroadScene } from '../src/rendering/offroad/index.ts';
import { mxFurnitureGround } from '../src/rendering/offroad/mx-ground-pose.ts';
import { MxFieldCover } from '../src/rendering/offroad/mx-field-cover.ts';
import { MxCourseDressing } from '../src/rendering/offroad/mx-course-dressing.ts';
import { MX_SOIL_COLOURS, MX_SOIL_DETAIL_HOOK } from '../src/rendering/offroad/mx-soil-detail.ts';
import { sampleMxSoilTransition } from '../src/rendering/offroad/mx-soil-transition.ts';
import { Roost, ROOST_CAPACITY } from '../src/rendering/offroad/roost.ts';
import { MxDustMaterial } from '../src/rendering/offroad/mx-dust-material.ts';
import { Stadium } from '../src/rendering/offroad/stadium.ts';
import { StartGate } from '../src/rendering/offroad/start-gate.ts';
import { TerrainView, SOIL_COLOURS } from '../src/rendering/offroad/terrain-view.ts';
import { valleyRidgeBackdrop } from '../src/rendering/venue-kit/terrain.ts';
import { terrainFor } from '../src/rendering/terrain.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { SOIL_KINDS } from '../src/simulation/offroad/course.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { GATE_DROP_SECONDS } from '../src/simulation/offroad/session.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { PHASE } from '../src/simulation/race.ts';
import { MATERIAL } from '../src/simulation/surface-material.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';

function shader(material: T.Material, kind: 'physical' | 'points') {
  const source = T.ShaderLib[kind];
  const result = {
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
    uniforms: T.UniformsUtils.clone(source.uniforms),
  } as StudioShader;
  material.onBeforeCompile(result, {} as T.WebGLRenderer);
  return result;
}

it('keeps every riding line inside the valley floor and builds a saddle between two distant ridges', () => {
  const track = rigTrack('valley-ridge-mx'), ground = terrainFor(track);
  const cx = track.points.reduce((sum, point) => sum + point.x, 0) / track.points.length;
  const cz = track.points.reduce((sum, point) => sum + point.z, 0) / track.points.length;
  for (const point of track.points)
    expect(valleyRidgeBackdrop(point.x - cx, point.z - cz)).toBe(0);
  const saddle = ground.height(cx + 900, cz);
  expect(ground.height(cx, cz + 900) - saddle).toBeGreaterThan(90);
  expect(ground.height(cx - 1450, cz) - saddle).toBeGreaterThan(100);
});

function frameAt(s = 100) {
  const track = rigTrack('valley-ridge-mx'),
    surface = Track.offroadOf(track) as TrackTerrainSurface;
  const p = track.at(s, trackPoint()),
    q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.atan2(p.tx, p.tz));
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  frame[H.CARS] = 1;
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
  frame[o + F.X] = p.x;
  frame[o + F.Y] = surface.terrain.baseHeight(s, 0) + 0.55;
  frame[o + F.Z] = p.z;
  frame.set(q.toArray(), o + F.QX);
  frame[o + F.SPEED] = 15;
  frame[o + F.VX] = p.tx * 15;
  frame[o + F.VZ] = p.tz * 15;
  frame[o + F.S] = s;
  for (let i = 0; i < 4; i++) {
    const w = o + WHEEL_BASE + i * WHEEL_STRIDE;
    frame[w + W.LOAD] = 600;
    frame[w + W.SLIP] = 0.24;
    frame[w + W.SURFACE] = MATERIAL.DIRT;
  }
  return frame;
}

function finiteGeometry(root: T.Object3D) {
  let draws = 0;
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    draws++;
    const pos = object.geometry.getAttribute('position');
    expect([...pos.array].every(Number.isFinite), object.name).toBe(true);
    if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
    expect(Number.isFinite(object.geometry.boundingSphere!.radius), object.name).toBe(true);
  });
  return draws;
}

describe('Valley Ridge event grounds', () => {
  it('keeps event paths outside the course and shares one mipmapped cover across the verge and hills', () => {
    const track = rigTrack('valley-ridge-mx'), cover = new MxFieldCover(track);
    const pixels = cover.texture.image.data as Uint8Array, size = cover.texture.image.width;
    let walked = 0, wheelTracks = 0, lush = 0, dry = 0;
    for (let k = 0; k < pixels.length; k += 4) {
      if (pixels[k] > 70) walked++;
      if (pixels[k+1] > 75) wheelTracks++;
      if (pixels[k+2] < 60) lush++;
      if (pixels[k+2] > 165) dry++;
    }
    expect(Math.min(walked, wheelTracks)).toBeGreaterThan(100);
    expect(Math.min(lush, dry)).toBeGreaterThan(500);
    const bound = cover.bounds, p = trackPoint();
    for (let s = 0; s < track.length; s += 3.2) {
      track.at(s, p);
      for (const alpha of [-0.75, 0, 0.75]) {
        const x = p.x + p.nx*p.width*alpha, z = p.z + p.nz*p.width*alpha;
        const k = 4*(Math.floor((x-bound.x)*bound.z*size) + size*Math.floor((z-bound.y)*bound.w*size));
        expect(pixels[k] + pixels[k+1]).toBe(0);
      }
    }
    expect(cover.texture.minFilter).toBe(T.LinearMipmapLinearFilter);
    const verge = new T.MeshStandardMaterial(), hill = new T.MeshStandardMaterial();
    let released = 0;
    cover.texture.addEventListener('dispose', () => released++);
    cover.install(verge); cover.install(hill); cover.install(verge);
    verge.dispose(); expect(released).toBe(0);
    hill.dispose(); expect(released).toBe(1);
  });
});

describe('reference-informed MX environments', () => {
  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    'keeps %s race lines clear while batching surveyed course furniture',
    (id) => {
      const track = rigTrack(id),
        course = (Track.offroadOf(track) as TrackTerrainSurface).course;
      const dressing = new MxCourseDressing(track);
      expect(dressing.stats.stakes).toBeGreaterThan(60);
      expect(dressing.stats.jumpMarkers).toBeGreaterThan(8);
      // Two shared-geometry understory layers add two outdoor submissions;
      // instanced straw bales and team vans add one more each (outdoor only).
      expect(finiteGeometry(dressing.root)).toBeLessThanOrEqual(16);
      const m = new T.Matrix4(),
        point = trackPoint(),
        p = new T.Vector3();
      const stakes = dressing.root.getObjectByName('MX course-edge stakes') as T.InstancedMesh;
      // The broad faces read as flexible blades without extending the old
      // tapered-pole envelope or adding triangles/draws beside tight SX lanes.
      const position = stakes.geometry.getAttribute('position'),
        normal = stakes.geometry.getAttribute('normal');
      stakes.geometry.computeBoundingBox();
      const bounds = stakes.geometry.boundingBox!,
        size = bounds.getSize(new T.Vector3());
      expect(bounds.min.y).toBeCloseTo(0, 6);
      expect(bounds.max.y).toBeCloseTo(0.82, 6);
      expect(size.x).toBeGreaterThan(size.z * 3);
      expect(size.z).toBeGreaterThan(0);
      expect((stakes.geometry.index?.count ?? position.count) / 3).toBeLessThanOrEqual(28);
      expect([...normal.array].every(Number.isFinite)).toBe(true);
      for (let i = 0; i < position.count; i++) {
        const oldRadius = 0.034 - (0.007 * position.getY(i)) / 0.82;
        expect(Math.hypot(position.getX(i), position.getZ(i))).toBeLessThanOrEqual(
          oldRadius + 1e-7,
        );
      }
      for (let i = 0; i < stakes.count; i++) {
        stakes.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        const lateral = track.nearest(p.x, p.z, point);
        const legal = course.legalWidth(point.width, point.s, lateral);
        expect(Math.abs(lateral), `stake ${i} at ${point.s.toFixed(1)} m`).toBeGreaterThan(
          legal - 0.06,
        );
      }
      if (id === 'valley-ridge-mx') {
        expect(dressing.stats.banners).toBeGreaterThan(12);
        expect(dressing.stats.bermScrimSpans).toBeGreaterThan(8);
        expect(dressing.stats.grassClumps).toBeGreaterThan(1000);
        expect(dressing.stats.stones).toBeGreaterThan(30);
        const rocks = dressing.root.getObjectByName('MX shoulder stones') as T.InstancedMesh;
        const scales: number[] = [], tints = new Set<number>();
        const width = new T.Vector3(), height = new T.Vector3(), shade = new T.Color();
        const vertex = new T.Vector3();
        const shape = rocks.geometry.getAttribute('position');
        for (let i = 0; i < rocks.count; i++) {
          rocks.getMatrixAt(i, m);
          const x = m.elements[12], z = m.elements[14], ground = mxFurnitureGround(track, x, z);
          scales.push(height.setFromMatrixColumn(m, 1).length() / width.setFromMatrixColumn(m, 0).length());
          rocks.getColorAt(i, shade);
          tints.add(shade.getHex());
          let base = Infinity, crown = -Infinity;
          for (let j = 0; j < shape.count; j++) {
            vertex.fromBufferAttribute(shape, j).applyMatrix4(m);
            base = Math.min(base, vertex.y);
            crown = Math.max(crown, vertex.y);
          }
          expect(base).toBeLessThan(ground);
          expect(crown).toBeGreaterThan(ground);
        }
        expect(Math.min(...scales)).toBeLessThan(0.30);
        expect(Math.max(...scales)).toBeGreaterThan(0.80);
        expect(tints.size).toBeGreaterThan(35);
        expect(dressing.stats.canopies).toBeGreaterThan(0);
      } else {
        expect(dressing.stats.blocks).toBeGreaterThan(25);
        expect(dressing.stats.bermScrimSpans).toBe(0);
        expect(dressing.stats.grassClumps).toBe(0);
      }
      dressing.dispose();
      expect(dressing.root.children).toHaveLength(0);
    },
  );

  it('keeps render heights exact while adding MX-only grading and a single color decode', () => {
    const track = rigTrack('valley-ridge-mx'),
      t = (Track.offroadOf(track) as TrackTerrainSurface).terrain;
    const view = new TerrainView(track);
    const mesh = view.group.children[0] as T.Mesh,
      g = mesh.geometry;
    const coordinates = g.getAttribute('mxCourse'),
      position = g.getAttribute('position'),
      color = g.getAttribute('color');
    let soilSamples = 0;
    for (let i = 0; i < position.count; i += 17) {
      const lateral = coordinates.getX(i),
        s = coordinates.getY(i);
      expect(position.getY(i)).toBeCloseTo(t.baseHeight(s, lateral), 4);
      const sample = sampleMxSoilTransition(t, lateral, s);
      const expected = SOIL_KINDS.reduce(
        (sum, kind, index) => sum + new T.Color(MX_SOIL_COLOURS[kind]).r * sample.weights[index],
        0,
      );
      expect(color.getX(i)).toBeCloseTo(expected, 5);
      if (coordinates.getZ(i) > 0.5) soilSamples++;
    }
    expect(soilSamples).toBeGreaterThan(10);
    expect(studioHookKeys(view.material)).toContain(MX_SOIL_DETAIL_HOOK);
    expect(view.soilSlots[0]).toBe('meadow');
    expect(view.soilMacro).toBe('dryEarth');
    const compiled = shader(view.material, 'physical');
    expect(compiled.fragmentShader).toContain('vec3 apexMacro = apexScanMacro( apexScanDryEarthC,');
    expect(compiled.fragmentShader).toContain('mxPreparedRelief');
    expect(compiled.fragmentShader).toContain('apexSoilWetness');
    expect(compiled.vertexShader).not.toContain('transformed.y += mx');
    view.dispose();
    const rx = new TerrainView(rigTrack('kestrel-rx'));
    expect(rx.soilMacro).toBe(rx.soilSlots[0]);
    expect((rx.group.children[0] as T.Mesh).geometry.hasAttribute('mxCourse')).toBe(false);
    expect(studioHookKeys(rx.material)).not.toContain(MX_SOIL_DETAIL_HOOK);
    const rxMesh = rx.group.children[0] as T.Mesh,
      rxT = (Track.offroadOf(rx.track) as TrackTerrainSurface).terrain;
    const rxKind = rxT.soilKind(rxT.cellIndex(rxT.lateralMin, 0));
    const legacy = new T.Color(SOIL_COLOURS[rxKind]).convertSRGBToLinear();
    expect(rxMesh.geometry.getAttribute('color').getX(0)).toBeCloseTo(legacy.r, 6);
    rx.dispose();
  });

  it('uses prepared earth rather than the synthetic turf slot for the actual SX course macro', () => {
    const view = new TerrainView(rigTrack('arena-nord-sx'));
    expect(view.soilSlots).toEqual(['meadow', 'dryEarth', 'forest']);
    expect(view.soilMacro).toBe('dryEarth');
    const compiled = shader(view.material, 'physical');
    expect(compiled.fragmentShader).toContain('vec3 apexMacro = apexScanMacro( apexScanDryEarthC,');
    expect(compiled.fragmentShader).toContain(
      'vec3 apexMacroFar = apexScanMacro( apexScanDryEarthC,',
    );
    view.dispose();
  });

  it('builds a stadium with real truss members and under 16 material batches', () => {
    const arena = new Stadium(rigTrack('arena-nord-sx'));
    expect(finiteGeometry(arena.root)).toBeLessThan(16);
    expect(arena.crowd.count).toBeGreaterThan(1000);
    expect(arena.root.getObjectByName('Merged open-web roof trusses and columns')).toBeTruthy();
    expect(arena.root.getObjectByName('Merged arena round floodlight lenses')).toBeTruthy();
    expect(arena.root.getObjectByName('Arena concourse ribbon boards')).toBeTruthy();
    const lights: T.Light[] = [];
    arena.root.traverse((o) => {
      if (o instanceof T.Light) lights.push(o);
    });
    expect(lights).toHaveLength(0);
    arena.dispose();
    expect(arena.root.children).toHaveLength(0);
  });

  it('drops the gate between recorded snapshots and holds it upright until green', () => {
    const track = rigTrack('valley-ridge-mx');
    const course = (Track.offroadOf(track) as TrackTerrainSurface).course;
    const gate = new StartGate(track, course);
    const presentation = new PresentedFrame();
    const a = frameAt(), b = a.slice();
    const green = 6.03125;
    const render = (alpha: number) => {
      const displayed = presentation.sample(a, b, alpha);
      gate.update(displayed, b);
      const elapsed = T.MathUtils.clamp((displayed[H.TIME] - green) / GATE_DROP_SECONDS, 0, 1);
      expect(gate.movingLeaves.rotation.x).toBeCloseTo(elapsed * elapsed * Math.PI / 2, 6);
      return gate.movingLeaves.rotation.x;
    };
    try {
      a[H.PHASE] = PHASE.LIGHTS;
      b[H.PHASE] = PHASE.RACING;
      a[H.TIME] = 6;
      b[H.TIME] = 6.05;
      b[H.RACE_TIME] = b[H.TIME] - green;
      expect(render(0.5)).toBe(0);
      expect(render(0.8)).toBeGreaterThan(0);
      a[H.PHASE] = PHASE.RACING;
      a[H.TIME] = green + 0.15;
      b[H.TIME] = green + 0.20;
      a[H.RACE_TIME] = a[H.TIME] - green;
      b[H.RACE_TIME] = b[H.TIME] - green;
      const held = render(0.25);
      expect(render(0.75)).toBeGreaterThan(held);
      expect(render(0.25)).toBe(held);
    } finally {
      gate.dispose();
    }
  });

  it('opens the welded gate on the same snapshot release without filling its aperture', () => {
    const track = rigTrack('valley-ridge-mx'),
      course = (Track.offroadOf(track) as TrackTerrainSurface).course;
    const gate = new StartGate(track, course),
      frame = frameAt();
    const hinge = gate.root.children[0].children.find((o) => o instanceof T.Group) as T.Group;
    const panel = hinge.children[0] as T.InstancedMesh;
    const draws = () => {
      let count = 0;
      gate.root.traverseVisible((object) => {
        if (object instanceof T.Mesh) count++;
      });
      return count;
    };
    expect(panel).toBeInstanceOf(T.InstancedMesh);
    expect(panel.count).toBe(gate.panelCount);
    expect(draws()).toBe(6);
    const pad = gate.root.getObjectByName('MX numbered starter pad') as T.Mesh<
      T.BufferGeometry,
      T.MeshPhysicalMaterial
    >;
    const uv = pad.geometry.getAttribute('uv');
    const positions = pad.geometry.getAttribute('position');
    const normals = pad.geometry.getAttribute('normal');
    const u: number[] = [],
      v: number[] = [];
    for (let i = 0; i < positions.count; i++) {
      if (normals.getY(i) < 0.99) continue;
      u.push(uv.getX(i));
      v.push(uv.getY(i));
    }
    expect(Math.max(...u) - Math.min(...u)).toBeCloseTo(
      (gate.panelCount + 1) * course.spec.gate!.spacing,
      4,
    );
    expect(Math.max(...v) - Math.min(...v)).toBeCloseTo(2.6, 4);
    expect(pad.geometry.getAttribute('uv1').array).toEqual(uv.array);
    const paint = shader(pad.material, 'physical');
    const laneLayout = paint.uniforms.mxPadLanes.value as T.Vector3;
    expect(laneLayout.toArray()).toEqual([
      course.spec.gate!.spacing,
      (-(gate.panelCount - 1) * course.spec.gate!.spacing) / 2,
      gate.panelCount,
    ]);
    const version = panel.instanceMatrix.version;
    expect(panel.geometry.index!.count).toBeGreaterThan(200);
    const ray = new T.Raycaster(new T.Vector3(0.065, 0.35, -1), new T.Vector3(0, 0, 1));
    const twoSided = new T.MeshBasicMaterial({ side: T.DoubleSide });
    panel.updateMatrixWorld(true);
    // The child panel in local space has a visible hole between welded bars.
    const local = new T.Mesh(panel.geometry, twoSided);
    local.updateMatrixWorld(true);
    expect(ray.intersectObject(local)).toHaveLength(0);
    frame[H.PHASE] = PHASE.RACING;
    frame[H.RACE_TIME] = 2;
    gate.update(frame);
    expect(hinge.rotation.x).toBeCloseTo(Math.PI / 2, 6);
    frame[H.RACE_TIME] = 0;
    gate.update(frame);
    expect(hinge.rotation.x).toBe(0);
    expect(panel.instanceMatrix.version).toBe(version);
    let disposed = 0;
    panel.addEventListener('dispose', () => disposed++);
    frame[H.CARS] = gate.panelCount + 4;
    gate.update(frame);
    expect(disposed).toBe(1);
    expect(gate.panelCount).toBe(frame[H.CARS]);
    expect(laneLayout.z).toBe(gate.panelCount);
    expect(laneLayout.y).toBeCloseTo((-(gate.panelCount - 1) * laneLayout.x) / 2);
    expect(draws()).toBe(6);
    twoSided.dispose();
    gate.dispose();
  });
});

describe('MX contact, dust and landing presentation', () => {
  it.each(['arena-nord-sx', 'valley-ridge-mx'] as const)('sets the starting grates at %s flush in open concrete pockets and widens with the field', (venue) => {
    const track = rigTrack(venue), course = (Track.offroadOf(track) as TrackTerrainSurface).course;
    const gate = new StartGate(track, course), frame = frameAt();
    const down = new T.Vector3(0, -1, 0), ray = new T.Raycaster();
    const sample = (o: T.Mesh, x: number, z: number) => {
      const p = gate.root.localToWorld(new T.Vector3(x, 1.2, z));
      ray.set(p, down);
      return ray.intersectObject(o)[0]?.point.y;
    };
    try {
      for (const count of [gate.panelCount, gate.panelCount + 2]) {
        frame[H.CARS] = count;
        gate.update(frame);
        gate.root.updateMatrixWorld(true);
        const concrete = gate.root.getObjectByName('MX numbered starter pad') as T.Mesh;
        const name = venue === 'arena-nord-sx' ? 'Arena Nord' : 'Valley Ridge';
        const steel = gate.root.getObjectByName(name + ' expanded-steel launch grates') as T.InstancedMesh;
        const lod = steel.parent as T.LOD;
        const camera = new T.PerspectiveCamera(), where = lod.getWorldPosition(new T.Vector3());
        camera.position.copy(where).add(new T.Vector3(0,2,35));
        camera.updateMatrixWorld();
        lod.update(camera);
        const distant = lod.getObjectByName('Filtered launch grates') as T.InstancedMesh;
        expect(distant.visible).toBe(true);
        expect(steel.visible).toBe(false);
        expect(distant.geometry.index!.count/3).toBe(2);
        expect(distant.count).toBe(steel.count);
        camera.position.copy(where).add(new T.Vector3(0,1,4));
        camera.updateMatrixWorld();
        lod.update(camera);
        expect(steel.visible).toBe(true);
        expect(distant.visible).toBe(false);
        expect(steel.count).toBe(count);
        const lane = -((count - 1) * course.spec.gate!.spacing) / 2;
        const top = gate.root.position.y + 0.01;
        expect(sample(concrete, lane + 0.46, -1.38)).toBeCloseTo(top, 5);
        expect(sample(concrete, lane, -1.38)).toBeUndefined();
        expect(sample(steel, lane + 0.356, -1.38)).toBeCloseTo(top, 5);
        let open = 0, supported = 0;
        // Raycast into physical diamonds between the cross-bearers.
        for (let i = 0; i < 40; i++) {
          const height = sample(steel, lane - 0.1 + i * 0.005, -1.52);
          if (height === undefined) open++;
          else if (height >= top - 0.006) supported++;
        }
        expect(open).toBeGreaterThan(15);
        expect(supported).toBeGreaterThan(2);
      }
    } finally {
      gate.dispose();
    }
  });

  it('projects both gate tyres onto the concrete and starts throwing soil only past the slab', () => {
    const track = rigTrack('valley-ridge-mx');
    const course = (Track.offroadOf(track) as TrackTerrainSurface).course;
    const gate = new StartGate(track, course),
      roost = new Roost(track);
    const gateS = course.spec.gate!.s;
    roost.startPad = gate;
    // A rut in the soil below the fixed slab must not sink the tyre shadow.
    roost.groundHeight = () => gate.root.position.y - 0.09;
    const frame = frameAt(gateS - 1.35),
      o = carBase(0);
    try {
      const slab = gate.root.getObjectByName('MX numbered starter pad') as T.Mesh;
      const datum = slab.localToWorld(new T.Vector3(0, 0.06, 0));
      expect(gate.padHeightAt(datum.x, datum.z)).toBeCloseTo(datum.y, 6);
      for (let i = 0; i < 12; i++) roost.update(frame, 1 / 60);
      for (const front of [true, false]) {
        const patch = roost.wheelPatch(0, front)!;
        expect(patch.onStartPad).toBe(true);
        expect(patch.position.y).toBeCloseTo(datum.y, 5);
        expect(patch.normal.toArray()).toEqual([0, 1, 0]);
      }
      expect(roost.contactShadows!.count).toBe(2);
      expect(roost.active).toBe(0);
      const beyond = frameAt(gateS + 5);
      for (let i = 0; i < 12; i++) roost.update(beyond, 1 / 60);
      expect(gate.padHeightAt(beyond[o + F.X], beyond[o + F.Z])).toBe(-Infinity);
      expect(roost.wheelPatch(0, false)!.onStartPad).toBe(false);
      expect(roost.active).toBeGreaterThan(0);
    } finally {
      gate.dispose();
      roost.dispose();
    }
  });

  it('keeps fixed track geometry in the static sunlight and camera-only detail out of the paint probe', () => {
    const track = rigTrack('valley-ridge-mx'), queue = new BuildQueue();
    const world = new OffroadScene(track, queue);
    try {
      queue.runSynchronously();
      const sun: T.Object3D[] = [], probe: T.Object3D[] = [];
      world.appendCaptureExclusions(sun, 'static-shadow');
      world.appendCaptureExclusions(probe, 'probe');
      expect(sun).toContain(world.gate!.movingLeaves);
      expect(sun).not.toContain(world.gate!.root);
      expect(sun).not.toContain(world.terrain!.group);
      expect(probe).not.toContain(world.gate!.movingLeaves);
      expect(probe).toContain(world.dressing!.turf);
      expect(probe).toContain(world.looseSoil!.root);
      expect(probe).not.toContain(world.dressing!.root);
      expect(probe).not.toContain(world.terrain!.group);
      expect(world.gate!.root.visible && world.gate!.movingLeaves.visible).toBe(true);
    } finally { world.dispose(); }
  });

  it('clears particles and airborne edge history on a short reverse seek', () => {
    // Keep construction pending: this exercises the production snapshot
    // path and particle history without building unrelated course meshes.
    const world = new OffroadScene(rigTrack('valley-ridge-mx'), new BuildQueue());
    const frame = frameAt(),
      o = carBase(0);
    frame[H.TIME] = 10;
    world.update(frame);
    frame[H.TIME] = 10.1;
    world.update(frame);
    expect(world.roost.active).toBeGreaterThan(0);
    frame[H.TIME] = 10.15;
    frame[o + OFFROAD_BASE + O.AIRBORNE] = 1;
    world.update(frame);
    frame[H.TIME] = 10.14;
    frame[o + F.SPEED] = 0;
    frame[o + OFFROAD_BASE + O.AIRBORNE] = 0;
    frame[o + OFFROAD_BASE + O.LANDING_SPEED] = 8;
    world.update(frame);
    expect(world.roost.active).toBe(0);
    frame[H.TIME] = 10.15;
    world.update(frame);
    expect(world.roost.active).toBe(0); // No invented landing after the seek.
    world.dispose();
  });
  it('uses bounded mixed particle sizes, pauses airborne emission, and clears on rewind', () => {
    const roost = new Roost(rigTrack('valley-ridge-mx')),
      frame = frameAt();
    for (let i = 0; i < 8; i++) roost.update(frame, 1 / 60);
    expect(roost.active).toBeGreaterThan(15);
    expect(roost.active).toBeLessThanOrEqual(ROOST_CAPACITY);
    const sizes = roost.points.geometry.getAttribute('mxParticleSize'),
      alpha = roost.points.geometry.getAttribute('mxParticleAlpha'),
      shape = roost.points.geometry.getAttribute('mxParticleShape');
    const visible = Array.from({ length: sizes.count }, (_, i) => ({
      size: sizes.getX(i),
      alpha: alpha.getX(i),
      dust: shape.getX(i),
      seed: shape.getY(i),
    })).filter((p) => p.alpha > 0);
    expect(visible.some((p) => p.size < 0.11)).toBe(true);
    expect(visible.some((p) => p.size > 0.28)).toBe(true);
    expect(visible.filter((p) => p.size < 0.11).every((p) => p.dust === 0)).toBe(true);
    expect(visible.filter((p) => p.size > 0.28).every((p) => p.dust === 1)).toBe(true);
    expect(new Set(visible.map((p) => p.seed)).size).toBeGreaterThan(10);
    const material = roost.points.material as MxDustMaterial;
    expect(material).toBeInstanceOf(MxDustMaterial);
    expect(material.lights).toBe(true);
    expect(material.fog).toBe(true);
    expect(Object.values(material.uniforms).some((u) => u.value instanceof T.Texture)).toBe(false);
    expect(roost.contactShadows!.count).toBe(2);
    const active = roost.active;
    frame[carBase(0) + OFFROAD_BASE + O.AIRBORNE] = 1;
    roost.update(frame, 1 / 60); // Deliberately keep stale positive loads.
    expect(roost.active).toBeLessThanOrEqual(active);
    expect(roost.contactShadows!.count).toBe(0);
    roost.clear();
    expect(roost.active).toBe(0);
    expect([...alpha.array].every((a) => a === 0)).toBe(true);
    roost.dispose();
  });

  it('emits one impact burst on landing and wet soil suppresses broad dust', () => {
    const track = rigTrack('valley-ridge-mx');
    const dry = new Roost(track),
      wet = new Roost(track),
      frame = frameAt(),
      o = carBase(0);
    frame[o + F.SPEED] = 0;
    frame[o + OFFROAD_BASE + O.AIRBORNE] = 1;
    dry.update(frame, 1 / 60);
    wet.update(frame, 1 / 60);
    frame[o + OFFROAD_BASE + O.AIRBORNE] = 0;
    frame[o + OFFROAD_BASE + O.LANDING_SPEED] = 7;
    dry.update(frame, 1 / 60);
    frame[o + OFFROAD_BASE + O.MOISTURE] = 0.7;
    wet.update(frame, 1 / 60);
    expect(dry.active).toBe(30); // Fifteen fragments at each observed tyre contact.
    expect(wet.active).toBe(30);
    const broad = (r: Roost) =>
      [...r.points.geometry.getAttribute('mxParticleSize').array].filter((v) => v > 0.2).length;
    expect(broad(dry)).toBeGreaterThan(12);
    expect(broad(wet)).toBe(0);
    const before = dry.active;
    dry.update(frame, 1 / 60);
    expect(dry.active).toBeLessThanOrEqual(before);
    dry.dispose();
    wet.dispose();
    const legacy = new Roost(rigTrack('kestrel-rx'));
    expect(legacy.contactShadows).toBeNull();
    expect(legacy.points.material).toBeInstanceOf(T.PointsMaterial);
    legacy.dispose();
  });
});
