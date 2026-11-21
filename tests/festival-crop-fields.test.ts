import * as T from 'three';
import { expect, it } from 'vitest';
import { CropFields, cropGeometry, CROP_RANGE } from '../src/rendering/open-world/crop-fields.ts';
import { terrainMaterial } from '../src/rendering/open-world/terrain-material.ts';
import { FARM_FIELDS, fieldAt, tramlineCoverage, TRAMLINE, type FarmField } from '../src/simulation/open-world/farm-fields.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { OpenWorldTrack, WORLD_SURFACE } from '../src/simulation/open-world/open-world-track.ts';
import { regionStructures, StructureGrid } from '../src/simulation/open-world/placement.ts';
import { surfaceSample, trackPoint } from '../src/simulation/track.ts';

const at = (f: FarmField, u: number, v: number): [number, number] =>
  [f.x + u * f.dx - v * f.dz, f.z + u * f.dz + v * f.dx];

it('keeps eight working parcels clear of roads, buildings and the river, and aligns both pressure tracks with the soil', () => {
  const w = openWorld(), grid = new StructureGrid(regionStructures(w)), p = trackPoint();
  const track = new OpenWorldTrack(w);
  for (const f of FARM_FIELDS) {
    expect(fieldAt(...at(f, 0, 0))).toBe(f);
    expect(fieldAt(...at(f, f.length + 1, 0))).not.toBe(f);
    for (let i = -1; i <= 1; i += 0.25) for (let j = -1; j <= 1; j += 0.25) {
      const [x, z] = at(f, i * f.length, j * f.width);
      const d = Math.abs(w.network.nearest(x, z, p)), edge = w.network.edges[w.network.edgeOf[w.network.lastSegment]];
      expect(d).toBeGreaterThan(edge.spec.halfWidth + edge.spec.shoulder + 2);
      expect(grid.blocks(x, z, 0.75)).toBe(false);
      expect(w.field.valleyAt(x, z).distance).toBeGreaterThan(w.region.valley.channel + 2);
    }
    expect(tramlineCoverage(0, TRAMLINE.wheel, f)).toBe(1);
    expect(tramlineCoverage(0, -TRAMLINE.wheel - TRAMLINE.pitch, f)).toBe(1);
    expect(tramlineCoverage(0, 0, f)).toBe(0);
    expect(tramlineCoverage(f.length - 1, TRAMLINE.wheel, f)).toBe(0);
    track.wetness = 0;
    const centre = track.sample(...at(f, 0, 0), surfaceSample());
    const dry = track.sample(...at(f, 0, TRAMLINE.wheel), surfaceSample());
    expect(track.query.surface).toBe(WORLD_SURFACE.FARMLAND);
    expect(dry.grip).toBeGreaterThan(centre.grip);
    expect(dry.resistance).toBeLessThan(centre.resistance);
    track.wetness = 1.8;
    const damp = track.sample(...at(f, 0, 0), surfaceSample());
    const wet = track.sample(...at(f, 0, TRAMLINE.wheel), surfaceSample());
    expect(wet.water).toBeGreaterThan(damp.water);
    expect(wet.grip).toBeLessThan(damp.grip);
  }
});

it('waits for exact ground and seats every culm outside headlands and both tractor wheelways', () => {
  const f = FARM_FIELDS[0];
  let ready = false;
  const ground = (x: number, z: number) => 32 + (x - f.x) * 0.062 + (z - f.z) * 0.024;
  const crops = new CropFields((x, z) => ready ? ground(x, z) : null, [f]);
  const c = new T.PerspectiveCamera(78, 1.7, 0.05, 3000);
  c.position.set(f.x - 5, 44, f.z - 44); c.lookAt(f.x, 31, f.z); c.updateMatrixWorld();
  crops.update(c, 'high', 3, c.position);
  expect(crops.root.children).toHaveLength(0);
  ready = true;
  for (let i = 0; i < 20; i++) crops.update(c, 'high', 3 + i / 30, c.position);
  expect(crops.root.children.length).toBeGreaterThan(6);
  const m = new T.Matrix4(), v = new T.Vector3();
  let count = 0;
  for (const node of crops.root.children) {
    const mesh = node as T.InstancedMesh;
    for (let i = 0; i < mesh.count; i += 5) {
      mesh.getMatrixAt(i, m); v.setFromMatrixPosition(m);
      const x = v.x - f.x, z = v.z - f.z, u = x * f.dx + z * f.dz, across = z * f.dx - x * f.dz;
      expect(v.y).toBeCloseTo(ground(v.x, v.z) - 0.018, 3);
      expect(Math.min(f.length - Math.abs(u), f.width - Math.abs(across))).toBeGreaterThan(TRAMLINE.headland);
      expect(tramlineCoverage(u, across, f)).toBeLessThan(0.101);
      count++;
    }
  }
  expect(count).toBeGreaterThan(200);
  const geometry = cropGeometry(true);
  expect(geometry.getAttribute('position').count).toBeLessThan(crops.standing.getAttribute('position').count / 2);
  c.position.x += CROP_RANGE.high + 370; c.updateMatrixWorld();
  crops.update(c, 'high', 4, null);
  expect(crops.root.children).toHaveLength(0);
  geometry.dispose(); crops.dispose();
});

it('compiles the same row bearings and wheel gauge onto the distant terrain', () => {
  const mat = terrainMaterial(), shader = { uniforms: {}, vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader } as T.WebGLProgramParametersWithUniforms;
  mat.onBeforeCompile(shader, {} as T.WebGLRenderer);
  for (const f of FARM_FIELDS) expect(shader.fragmentShader).toContain(f.dx.toFixed(6));
  expect(shader.fragmentShader).toContain(TRAMLINE.wheel.toFixed(6));
  expect(shader.fragmentShader).toContain('owFieldLayer(p, dFdx(p), dFdy(p)');
  mat.dispose();
});
