import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { terrainHeight } from '../src/rendering/terrain-profile.ts';
import { vegetationPlan } from '../src/rendering/landscape.ts';
import { BroadcastSightlines } from '../src/rendering/broadcast-sightlines.ts';
import { VenueLighting } from '../src/rendering/venue-lighting.ts';
import {
  LANDMARK,
  landmarkSitePlan,
  inLandmarkFootprint,
  buildVenueLandmark,
  landmarkScreenMaterial,
} from '../src/rendering/venue-landmark.ts';

const dispose = (root: T.Object3D) => {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  root.traverse((o) => {
    if (o instanceof T.InstancedMesh) o.dispose();
    if (o instanceof T.Mesh) {
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    }
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
};
describe('grounded original event hall', () => {
  it('shares a deterministic full-plaza footprint with planting and sampled terrain', () => {
    const track = new Track(),
      site = landmarkSitePlan(track),
      near = trackPoint();
    expect(site).toEqual(landmarkSitePlan(track));
    for (const radius of [0, site.radius * 0.5, site.radius])
      for (let i = 0; i < 144; i++) {
        const x = site.x + Math.sin((i / 144) * Math.PI * 2) * radius;
        const z = site.z + Math.cos((i / 144) * Math.PI * 2) * radius;
        const y = terrainHeight(x, z),
          l = track.nearest(x, z, near);
        expect(site.bottomY).toBeLessThan(y);
        expect(site.deckY).toBeGreaterThanOrEqual(y);
        expect(site.deckY - y).toBeLessThan(0.9);
        expect(Math.abs(l)).toBeGreaterThan(near.width + 42);
      }
    const trees = vegetationPlan(track);
    expect(trees.length).toBeGreaterThan(400);
    expect(trees.every((t) => !inLandmarkFootprint(site, t.x, t.z, 8))).toBe(true);
    expect(inLandmarkFootprint(site, site.x, site.z)).toBe(true);
    expect(inLandmarkFootprint(site, site.x + site.radius + 2, site.z)).toBe(false);
    expect(() => inLandmarkFootprint(site, NaN, 0)).toThrow();
  });
  it('joins actual screen vertices to the bearing drum rather than suspending a full sphere', () => {
    const hall = buildVenueLandmark(new Track()),
      root = new T.Group();
    root.add(hall.structure, hall.display);
    root.updateMatrixWorld(true);
    const positions = hall.display.geometry.getAttribute('position'),
      v = new T.Vector3();
    let low = Infinity,
      high = -Infinity,
      maximumRadius = 0;
    for (let i = 0; i < positions.count; i++) {
      v.fromBufferAttribute(positions, i).applyMatrix4(hall.display.matrixWorld);
      low = Math.min(low, v.y);
      high = Math.max(high, v.y);
      maximumRadius = Math.max(maximumRadius, Math.hypot(v.x - hall.site.x, v.z - hall.site.z));
      expect(v.toArray().every(Number.isFinite)).toBe(true);
    }
    expect(low - hall.site.deckY).toBeCloseTo(LANDMARK.drumTop, 4);
    expect(high - hall.site.deckY).toBeCloseTo(38, 4);
    expect(maximumRadius).toBeLessThanOrEqual(LANDMARK.radius + 0.001);
    const columns = hall.structure.getObjectByName(
      'Twenty-four facade and shell supports',
    ) as T.InstancedMesh;
    expect(columns.count).toBe(24);
    const matrix = new T.Matrix4();
    columns.getMatrixAt(0, matrix);
    expect(matrix.elements[13] - 4.32 / 2).toBeCloseTo(0.04, 5);
    expect(matrix.elements[13] + 4.32 / 2).toBeGreaterThan(4.3);
    let draws = 0,
      triangles = 0;
    root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      draws++;
      triangles +=
        ((o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3) *
        (o instanceof T.InstancedMesh ? o.count : 1);
    });
    expect(draws).toBeLessThanOrEqual(8);
    expect(triangles).toBeLessThan(7000);
    expect(hall.solids).toHaveLength(4);
    dispose(root);
  });
  it('registers the actual building only once with conservative broadcast sightlines', () => {
    const venue = new VenueLighting(new Track()),
      sightlines = new BroadcastSightlines();
    const site = venue.landmarkSite;
    venue.registerSightlines(sightlines);
    venue.registerSightlines(sightlines);
    expect(sightlines.count).toBe(4);
    expect(
      sightlines.blocked(
        new T.Vector3(site.x - 45, site.deckY + 12, site.z),
        new T.Vector3(site.x + 45, site.deckY + 12, site.z),
      ),
    ).toBe(true);
    expect(
      sightlines.blocked(
        new T.Vector3(site.x - 45, site.deckY + 12, site.z + 45),
        new T.Vector3(site.x + 45, site.deckY + 12, site.z + 45),
      ),
    ).toBe(false);
    dispose(venue.root);
  });

  it('uses the physical material pipeline with derivative-filtered seams and reversible emission', () => {
    const m = landmarkScreenMaterial();
    const shader = {
      uniforms: {},
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
    } as T.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.fragmentShader).toContain('fwidth(grid)');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance*=hallPattern()');
    expect(shader.fragmentShader).toContain('#include <lights_fragment_begin>');
    expect(m.emissiveIntensity).toBeLessThan(0.02);
    m.dispose();
    const venue = new VenueLighting(new Track()),
      anchor = new T.Vector3();
    const original = venue.diagnostics().landmark;
    venue.update(true, anchor, 0.5);
    expect(venue.diagnostics().landmark.emission).toBeCloseTo(0.8);
    expect(venue.diagnostics().nearbyLights).toBe(4);
    venue.update(false, anchor);
    expect(venue.diagnostics().landmark).toEqual(original);
    expect(venue.diagnostics().nearbyLights).toBe(0);
    dispose(venue.root);
  });
});
