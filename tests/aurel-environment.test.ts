import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { drainStations } from '../src/simulation/surface-drainage.ts';
import { buildDistrictArchitecture } from '../src/rendering/venue-architecture.ts';
import { districtPlan, type DistrictSite } from '../src/rendering/venue-districts.ts';
import { districtPlazaGeometry, plazaHeight } from '../src/rendering/venue-plaza.ts';
import {
  installVenueFinish,
  venueMaterials,
  type VenueFinish,
} from '../src/rendering/venue-materials.ts';
import { BroadcastSightlines } from '../src/rendering/broadcast-sightlines.ts';
import { batchScene } from '../src/rendering/geometry.ts';
import { terrainHeight } from '../src/rendering/terrain-profile.ts';
import { LocalAtmosphere } from '../src/rendering/local-atmosphere.ts';
import { grassApronOffset } from '../src/rendering/ground-profile.ts';
import {
  drainGratingGeometry,
  trackInfrastructurePlan,
} from '../src/rendering/track-infrastructure.ts';

const kinds = ['club', 'terrace', 'works', 'concourse'] as const;
function architecture(kind: DistrictSite['kind']) {
  const root = new T.Group(),
    materials = venueMaterials(),
    sightlines = new BroadcastSightlines();
  buildDistrictArchitecture(root, kind, materials, sightlines);
  root.updateMatrixWorld(true);
  return { root, materials, sightlines };
}
function dispose(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    geometries.add(o.geometry);
    for (const material of Array.isArray(o.material) ? o.material : [o.material])
      materials.add(material);
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}
function geometryDigest(root: T.Group) {
  const hash = createHash('sha256');
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    hash.update(o.name).update(JSON.stringify(o.matrixWorld.elements));
    for (const a of Object.values((o.geometry as T.BufferGeometry).attributes))
      hash.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength));
    if (o.geometry.index) hash.update(Buffer.from(o.geometry.index.array.buffer));
  });
  return hash.digest('hex');
}
function metrics(root: T.Object3D) {
  let draws = 0,
    triangles = 0,
    bytes = 0;
  const seen = new Set<T.BufferGeometry>();
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    draws++;
    triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3;
    if (seen.has(o.geometry)) return;
    seen.add(o.geometry);
    for (const a of Object.values((o.geometry as T.BufferGeometry).attributes))
      bytes += a.array.byteLength;
    bytes += o.geometry.index?.array.byteLength ?? 0;
  });
  return { draws, triangles, bytes };
}
function named(root: T.Object3D, name: string) {
  const found: T.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof T.Mesh && o.name === name) found.push(o);
  });
  return found;
}

describe('27H.4 constructed Aurel districts', () => {
  it.each(kinds)('%s has bounded, finite, deterministic authored geometry', (kind) => {
    const a = architecture(kind),
      b = architecture(kind);
    expect(geometryDigest(a.root)).toBe(geometryDigest(b.root));
    expect(a.root.userData.architecture).toEqual({
      revision: '27H.4-constructed-venue-v1',
      kind,
      finalArtApproved: false,
    });
    let invalid = 0;
    a.root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      if (!o.visible || !o.frustumCulled || o.scale.toArray().some((v) => v <= 0) || !o.name)
        invalid++;
      const p = o.geometry.getAttribute('position'),
        n = o.geometry.getAttribute('normal');
      for (const attribute of Object.values((o.geometry as T.BufferGeometry).attributes))
        if (!attribute.array.every(Number.isFinite)) invalid++;
      for (let i = 0; i < n.count; i++)
        if (Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) > 1e-4) invalid++;
      if (o.geometry.index && !o.geometry.index.array.every((i: number) => i >= 0 && i < p.count))
        invalid++;
      if (!o.geometry.getAttribute('uv')) invalid++;
    });
    expect(invalid).toBe(0);
    const bounds = new T.Box3().setFromObject(a.root);
    expect(bounds.min.x).toBeGreaterThan(-19);
    expect(bounds.max.x).toBeLessThan(19);
    expect(bounds.min.z).toBeGreaterThan(-15);
    expect(bounds.max.z).toBeLessThan(15);
    // Slender diagonal trestles intentionally enter the deck by their radius.
    expect(bounds.min.y).toBeGreaterThan(-0.04);
    expect(bounds.max.y).toBeLessThan(10);
    expect(a.sightlines.count).toBeGreaterThan(0);
    expect(a.sightlines.count).toBeLessThan(32);
    dispose(a.root);
    dispose(b.root);
  });
  it.each(kinds)('%s preserves geometry and bounds through the production batcher', (kind) => {
    const { root } = architecture(kind);
    root.position.set(173, -3.88, -217);
    root.rotation.y = 0.57;
    root.updateMatrixWorld(true);
    const before = metrics(root),
      bounds = new T.Box3().setFromObject(root, true);
    batchScene(root, new Set());
    const after = metrics(root),
      batchedBounds = new T.Box3().setFromObject(root, true);
    expect(after.triangles).toBe(before.triangles);
    expect(after.draws).toBeLessThanOrEqual(32);
    expect(after.triangles).toBeLessThan(30000);
    expect(after.bytes).toBeLessThan(3_000_000);
    expect(bounds.min.distanceTo(batchedBounds.min)).toBeLessThan(0.0001);
    expect(bounds.max.distanceTo(batchedBounds.max)).toBeLessThan(0.0001);
    expect(root.userData.architecture.finalArtApproved).toBe(false);
    dispose(root);
  });
  it('keeps the terrace stair clear and seats the actual rail bases on each tier', () => {
    const { root } = architecture('terrace');
    const steps = named(root, 'Terrace / unobstructed central stair');
    expect(steps).toHaveLength(16);
    const heights = steps.map((o) => new T.Box3().setFromObject(o).max.y);
    for (let i = 1; i < heights.length; i++)
      expect(heights[i] - heights[i - 1]).toBeCloseTo(i < 4 ? 0.15 : 0.1625, 5);
    const tiers = named(root, 'Terrace / split stone seating tier');
    expect(tiers).toHaveLength(8);
    for (const tier of tiers) {
      const bounds = new T.Box3().setFromObject(tier);
      expect(bounds.min.x > 1.27 || bounds.max.x < -1.27).toBe(true);
    }
    const ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0, -1, 0));
    for (const base of named(root, 'Terrace / guardrail baseplate')) {
      ray.set(new T.Vector3(base.position.x, 20, base.position.z), new T.Vector3(0, -1, 0));
      const hit = ray.intersectObjects([...tiers, ...steps])[0];
      expect(hit, `unsupported guardrail at ${base.position.toArray()}`).toBeDefined();
      expect(Math.abs(hit.point.y - (base.position.y - 0.025))).toBeLessThan(0.002);
    }
    for (const support of named(root, 'Terrace / stair-mounted handrail support')) {
      const endpoint = new T.Vector3(
        0,
        -(support.geometry as T.CylinderGeometry).parameters.height / 2,
        0,
      ).applyMatrix4(support.matrixWorld);
      ray.set(new T.Vector3(endpoint.x, 20, endpoint.z), new T.Vector3(0, -1, 0));
      expect(Math.abs(ray.intersectObjects(steps)[0].point.y - endpoint.y)).toBeLessThan(0.002);
    }
    dispose(root);
  });
  it('gives the club, workshop and concourse their own complete structures', () => {
    const expectations = {
      club: [
        ['Club / continuous folded standing-seam roof', 1],
        ['Club / folded-roof front infill', 1],
        ['Club / folded-roof rear infill', 1],
      ],
      works: [
        ['Works / sawtooth roof plane', 6],
        ['Works / sawtooth gable infill', 12],
        ['Works / north-light clerestory', 6],
      ],
      concourse: [
        ['Concourse / deep shade canopy', 3],
        ['Concourse / sloping side clerestory ribbon', 6],
        ['Concourse / bench support crossbar', 8],
      ],
    } as const;
    for (const kind of ['club', 'works', 'concourse'] as const) {
      const { root } = architecture(kind);
      for (const [name, count] of expectations[kind]) expect(named(root, name)).toHaveLength(count);
      dispose(root);
    }
  });
  it('rejects unknown architecture without approving fallback geometry', () => {
    const root = new T.Group(),
      m = venueMaterials();
    expect(() =>
      buildDistrictArchitecture(
        root,
        'unknown' as DistrictSite['kind'],
        m,
        new BroadcastSightlines(),
      ),
    ).toThrow();
    expect(root.children).toHaveLength(0);
    Object.values(m).forEach((material) => material.dispose());
  });
});

describe('plaza-to-terrain transitions', () => {
  it.each(kinds)('%s returns every perimeter vertex to the actual terrain', (kind) => {
    const site = districtPlan(new Track()).find((s) => s.kind === kind)!;
    const g = districtPlazaGeometry(site),
      p = g.getAttribute('position'),
      n = g.getAttribute('normal');
    let edgeCount = 0,
      interiorCount = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        z = p.getZ(i),
        y = p.getY(i) + site.y;
      const distance = Math.min(site.width / 2 - Math.abs(x), site.length / 2 - Math.abs(z));
      if (distance < 0.00001) {
        const wx = site.x + Math.cos(site.yaw) * x + Math.sin(site.yaw) * z;
        const wz = site.z - Math.sin(site.yaw) * x + Math.cos(site.yaw) * z;
        expect(y).toBeCloseTo(terrainHeight(wx, wz) + 0.008, 5);
        edgeCount++;
      } else if (distance >= 3) {
        expect(y).toBeCloseTo(site.y, 5);
        interiorCount++;
      }
      expect(n.getY(i)).toBeGreaterThan(0.98);
      expect(y).toBeCloseTo(plazaHeight(site, x, z), 5);
    }
    expect(edgeCount).toBe(160);
    expect(interiorCount).toBeGreaterThan(1000);
    expect(g.index!.count / 3).toBe(3168);
    g.dispose();
  });
  it('does not mutate the selected site and rejects unbounded samples', () => {
    const site = districtPlan(new Track())[0],
      before = JSON.stringify(site);
    districtPlazaGeometry(site).dispose();
    expect(JSON.stringify(site)).toBe(before);
    expect(() => plazaHeight(site, 23, 0)).toThrow();
    expect(() => plazaHeight({ ...site, y: NaN }, 0, 0)).toThrow();
    expect(() => districtPlazaGeometry({ ...site, width: 100000 })).toThrow();
  });
});

describe('physical drainage station presentation', () => {
  it('keeps all original drain stations and conforms every vertex to the actual grade', () => {
    const track = new Track(),
      plan = trackInfrastructurePlan(track),
      p = trackPoint();
    expect(plan.drains.map((s) => s.s)).toEqual(drainStations(track.length).map((s) => s.s));
    let checked = 0;
    for (const site of plan.drains) {
      const { grate, bed } = drainGratingGeometry(track, site);
      for (const [geometry, minimum, maximum] of [
        [grate, 0.0039, 0.0221],
        [bed, -0.0011, 0.0071],
      ] as const) {
        const positions = geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i),
            z = positions.getZ(i);
          const wx = site.x + Math.cos(site.yaw) * x + Math.sin(site.yaw) * z;
          const wz = site.z - Math.sin(site.yaw) * x + Math.cos(site.yaw) * z;
          const lateral = track.nearest(wx, wz, p);
          const ground =
            p.y +
            p.bank * Math.min(12, Math.max(-12, lateral)) +
            grassApronOffset(track, p.s, lateral);
          const above = positions.getY(i) + site.y - ground;
          expect(above).toBeGreaterThanOrEqual(minimum);
          expect(above).toBeLessThanOrEqual(maximum);
          checked++;
        }
      }
      expect(grate.index!.count / 3).toBe(216);
      grate.dispose();
      bed.dispose();
    }
    expect(checked).toBeGreaterThan(10000);
  });
  it('uses open slots between actual crossbars rather than a solid cover', () => {
    const track = new Track(),
      site = trackInfrastructurePlan(track).drains[0];
    const { grate, bed } = drainGratingGeometry(track, site);
    const part = new T.Mesh(grate, new T.MeshBasicMaterial({ side: T.DoubleSide }));
    part.updateMatrixWorld(true);
    const ray = new T.Raycaster(new T.Vector3(0, 1, -0.742), new T.Vector3(0, -1, 0));
    expect(ray.intersectObject(part).length).toBeGreaterThan(0);
    ray.set(new T.Vector3(0, 1, -0.742 + 1.484 / 26), new T.Vector3(0, -1, 0));
    expect(ray.intersectObject(part)).toHaveLength(0);
    expect(() => drainGratingGeometry(track, { ...site, kind: 'camera' })).toThrow();
    expect(() => drainGratingGeometry(track, { ...site, x: Infinity })).toThrow();
    grate.dispose();
    bed.dispose();
    part.material.dispose();
  });
});

describe('metric venue material integration', () => {
  it('chains the new finish with regional weather after spatial batching', () => {
    const { root } = architecture('club');
    batchScene(root, new Set());
    const atmosphere = new LocalAtmosphere(new Track());
    atmosphere.install(root);
    const material = (
      root.children.find(
        (o) => o instanceof T.Mesh && o.material.userData.venueFinish === 'stone',
      ) as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>
    ).material;
    const shader = {
      uniforms: {},
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
    } as T.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.fragmentShader).toContain('venueFinishResponse()');
    expect(shader.fragmentShader).toContain('apexLocalDensity');
    expect(shader.uniforms.apexLocalSigma).toBeDefined();
    const key = material.customProgramCacheKey();
    atmosphere.install(root);
    expect(material.customProgramCacheKey()).toBe(key);
    dispose(root);
  });

  it.each(['stone', 'timber', 'metal', 'paving'] as const)(
    '%s retains PBR, previous hooks, and a deterministic shader identity',
    (finish) => {
      const m = new T.MeshStandardMaterial();
      m.customProgramCacheKey = () => 'previous-hook-v1';
      m.onBeforeCompile = (shader) => {
        shader.vertexShader = '// retained earlier hook\n' + shader.vertexShader;
      };
      installVenueFinish(m, finish);
      const shader = {
        uniforms: {},
        vertexShader: T.ShaderLib.standard.vertexShader,
        fragmentShader: T.ShaderLib.standard.fragmentShader,
      } as T.WebGLProgramParametersWithUniforms;
      m.onBeforeCompile(shader, {} as T.WebGLRenderer);
      expect(shader.vertexShader.startsWith('// retained earlier hook')).toBe(true);
      expect(shader.vertexShader).toContain('instanceMatrix * venuePosition');
      expect(shader.vertexShader).toContain('#include <project_vertex>');
      expect(shader.fragmentShader).toContain('#include <lights_fragment_begin>');
      expect(shader.fragmentShader).toContain('fwidth(grid)');
      expect(shader.fragmentShader).toContain('roughnessFactor=clamp');
      expect(Object.keys(shader.uniforms)).toHaveLength(0);
      expect(m.customProgramCacheKey()).toContain('previous-hook-v1:aurel-metric-finish-v1');
      expect(() => installVenueFinish(m, finish)).toThrow();
      m.dispose();
    },
  );
  it('separates shader cache keys and adds no transmission or texture pass', () => {
    const materials = venueMaterials();
    expect(
      new Set(
        [materials.stone, materials.timber, materials.steel, materials.paving].map((m) =>
          m.customProgramCacheKey(),
        ),
      ).size,
    ).toBe(4);
    expect(materials.glass.transmission).toBe(0);
    for (const material of Object.values(materials)) {
      expect(material.map).toBeNull();
      expect(material.roughness).toBeGreaterThan(0);
      material.dispose();
    }
    const material = new T.MeshStandardMaterial();
    expect(() => installVenueFinish(material, 'invalid' as VenueFinish)).toThrow();
    expect(() => installVenueFinish(material, '__proto__' as VenueFinish)).toThrow();
    material.dispose();
  });
});
