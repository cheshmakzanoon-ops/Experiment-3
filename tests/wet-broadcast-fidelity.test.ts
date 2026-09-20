import { expect, it } from 'vitest';
import * as T from 'three';
import { FLAG } from '../src/simulation/marshal.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
} from '../src/simulation/protocol.ts';
import { CELL_COLS, CELL_ROWS, Track, trackPoint } from '../src/simulation/track.ts';
import {
  drainSide,
  drainStations,
  surfaceDrainageRate,
} from '../src/simulation/surface-drainage.ts';
import { Effects, PARTICLE_KIND } from '../src/rendering/effects.ts';
import { inStandFootprint } from '../src/rendering/grandstand.ts';
import { installWetRoad } from '../src/rendering/materials.ts';
import {
  buildTrackInfrastructure,
  safetyPanelAppearance,
  trackInfrastructurePlan,
  updateSafetyPanel,
} from '../src/rendering/track-infrastructure.ts';
import { tracksideRigs } from '../src/rendering/trackside.ts';

it('plans dense trackside detail deterministically without invading the racing corridor', () => {
  const track = new Track('clear'),
    a = trackInfrastructurePlan(track),
    b = trackInfrastructurePlan(track),
    point = trackPoint();
  expect(a).toEqual(b);
  expect(a.drains.length).toBeGreaterThan(50);
  expect(a.marshalPosts).toHaveLength(12);
  expect(a.utilities.length).toBeGreaterThan(10);
  expect(a.cameras).toHaveLength(20);

  for (const site of a.drains) {
    track.at(site.s, point);
    expect(Math.abs(site.lateral)).toBeGreaterThan(point.width + 1.3);
    expect(Math.abs(site.lateral)).toBeLessThan(track.boundary(site.s, site.side) - 1);
    expect([site.x, site.y, site.z, site.yaw].every(Number.isFinite)).toBe(true);
  }
  for (const site of [...a.marshalPosts, ...a.utilities]) {
    expect(Math.abs(site.lateral)).toBeGreaterThan(track.boundary(site.s, site.side) + 2);
    expect(inStandFootprint(track, site.x, site.z, 0.8)).toBe(false);
  }
});

it('connects visible low-edge drains to the same bounded physical water evacuation field', () => {
  const track = new Track('clear'),
    plan = trackInfrastructurePlan(track),
    point = trackPoint(),
    station =
      plan.drains.find((site) => Math.abs(track.at(site.s, point).bank) > 0.004) ?? plan.drains[0];
  track.at(station.s, point);
  const ordinal = drainStations(track.length).find((item) => item.s === station.s)!.ordinal;
  expect(station.side).toBe(drainSide(point.bank, point.curvature, ordinal));

  const row = Math.min(CELL_ROWS - 1, Math.floor((station.s / track.length) * CELL_ROWS)),
    drainColumn = station.side < 0 ? 0 : CELL_COLS - 1,
    oppositeColumn = station.side < 0 ? CELL_COLS - 1 : 0,
    drainCell = row * CELL_COLS + drainColumn,
    oppositeCell = row * CELL_COLS + oppositeColumn;
  expect(track.drainage[drainCell]).toBeGreaterThan(track.drainage[oppositeCell]);

  track.water.fill(1);
  track.evolve(0.5, 0.5);
  expect(track.water[drainCell]).toBeLessThan(track.water[oppositeCell]);
  expect(track.water[drainCell]).toBeGreaterThanOrEqual(0);
});

it('keeps drainage coefficients finite, symmetric away from a station and bounded at a drain', () => {
  const track = new Track('clear'),
    point = track.at(120, trackPoint());
  expect(surfaceDrainageRate(120, track.length, point.bank, point.curvature, 0)).toBeCloseTo(
    surfaceDrainageRate(120, track.length, point.bank, point.curvature, 6),
    10,
  );
  const station = drainStations(track.length)[4];
  track.at(station.s, point);
  const side = drainSide(point.bank, point.curvature, station.ordinal),
    column = side < 0 ? 0 : 6,
    rate = surfaceDrainageRate(station.s, track.length, point.bank, point.curvature, column);
  expect(rate).toBeGreaterThan(0.005);
  expect(rate).toBeLessThanOrEqual(0.009000001);
  expect(() => surfaceDrainageRate(NaN, track.length, 0, 0, 0)).toThrow('Invalid drainage');
});

it('makes visible replay camera hardware share the exact replay-director positions', () => {
  const track = new Track('clear'),
    plan = trackInfrastructurePlan(track),
    rigs = tracksideRigs(track);
  expect(plan.cameras).toHaveLength(rigs.length);
  for (let i = 0; i < rigs.length; i++) {
    const site = plan.cameras[i],
      rig = rigs[i];
    expect(site.rigId).toBe(rig.id);
    expect(site.x).toBeCloseTo(rig.position.x, 9);
    expect(site.z).toBeCloseTo(rig.position.z, 9);
    expect(site.cameraY).toBeCloseTo(rig.position.y, 9);
    expect(site.cameraY!).toBeGreaterThan(site.y + 1);
  }
});

it('builds finite batchable marshal, drainage, utility and camera geometry', () => {
  const track = new Track('clear'),
    root = new T.Group(),
    panel = new T.MeshStandardMaterial(),
    plan = buildTrackInfrastructure(track, root, panel);
  root.updateMatrixWorld(true);
  let meshes = 0;
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    meshes++;
    const position = object.geometry.getAttribute('position');
    expect(position).toBeTruthy();
    for (let i = 0; i < position.count; i++)
      expect([position.getX(i), position.getY(i), position.getZ(i)].every(Number.isFinite)).toBe(
        true,
      );
    expect(object.matrixWorld.elements.every(Number.isFinite)).toBe(true);
  });
  expect(meshes).toBeGreaterThan(plan.drains.length + plan.cameras.length * 2);
});

it('drives marshal LED appearance from the actual race flag channel', () => {
  const material = new T.MeshStandardMaterial(),
    frame = new Float32Array(16);
  for (const flag of [FLAG.GREEN, FLAG.YELLOW, FLAG.DOUBLE_YELLOW, FLAG.BLUE, FLAG.CHEQUERED]) {
    frame[H.FLAG] = flag;
    updateSafetyPanel(material, frame);
    const expected = safetyPanelAppearance(flag);
    expect(material.emissive.getHex()).toBe(expected.color);
    expect(material.color.getHex()).toBe(expected.color);
    expect(material.emissiveIntensity).toBe(expected.intensity);
  }
});

it('adds a water-film clearcoat lobe on physical wet asphalt while keeping dry cells explicit', () => {
  const material = new T.MeshPhysicalMaterial({ clearcoat: 1, clearcoatRoughness: 0.1 }),
    state = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, T.RGBAFormat);
  installWetRoad(material, state, true);
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(shader as T.WebGLProgramParametersWithUniforms, {} as T.WebGLRenderer);
  expect(shader.fragmentShader).toContain('material.clearcoat = wet * mix(0.58, 1.0, puddle)');
  expect(shader.fragmentShader).toContain(
    'material.clearcoatRoughness = mix(0.26, mix(0.105, 0.055, puddle), wet)',
  );
  expect(shader.fragmentShader).toContain('roughnessFactor=mix');
  expect(shader.fragmentShader).toContain(
    'normal = normalize(mix(normal, dryRoadNormal, wet * 0.9))',
  );
  expect(shader.uniforms).toHaveProperty('trackState');
  material.dispose();
  state.dispose();
});

it('scales wet spray with measured wheel load and sends the plume rearward in car space', () => {
  const wetFrame = (load: number) => {
    const frame = new Float32Array(HEADER + CAR_STRIDE);
    frame[H.CARS] = 1;
    frame[H.WIND_X] = 0;
    frame[H.WIND_Z] = 0;
    frame[HEADER + F.QW] = 1;
    frame[HEADER + F.SPEED] = 50;
    frame[HEADER + F.VZ] = 50;
    frame[HEADER + F.COMPOUND] = 1;
    for (let wheel = 0; wheel < 4; wheel++) {
      const offset = HEADER + WHEEL_BASE + wheel * WHEEL_STRIDE;
      frame[offset + W.LOAD] = load;
      frame[offset + W.WATER] = 0.5;
      frame[offset + W.SURFACE] = 0;
    }
    return frame;
  };
  const light = new Effects(),
    loaded = new Effects();
  light.update(wetFrame(875), 0.1, true);
  loaded.update(wetFrame(3250), 0.1, true);
  const lightDiagnostics = light.diagnostics(),
    loadedDiagnostics = loaded.diagnostics(),
    sprayKind = PARTICLE_KIND.SPRAY;
  expect(loadedDiagnostics.spawned[sprayKind]).toBeGreaterThan(lightDiagnostics.spawned[sprayKind]);
  expect(loadedDiagnostics.active[sprayKind]).toBeGreaterThan(0);
  expect(loadedDiagnostics.velocityZ[sprayKind]).toBeLessThan(0);
  expect(loadedDiagnostics.spawned.reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(
    loadedDiagnostics.capacity,
  );
});

it('uses distinct screen-space rain streak and expanding spray plume profiles in one bounded pool', () => {
  const effects = new Effects(),
    points = effects.group.children[0] as T.Points,
    material = points.material as T.ShaderMaterial;
  expect(points.geometry.getAttribute('kind').count).toBe(effects.diagnostics().capacity);
  expect(material.vertexShader).toContain('vKind=kind');
  expect(material.fragmentShader).toContain('float plume=');
  expect(material.fragmentShader).toContain('float streak=');
  expect(material.fragmentShader).toContain('vKind>2.5&&vKind<3.5');
  expect(material.fragmentShader).toContain('vKind<.5');
  points.geometry.dispose();
  material.dispose();
});
