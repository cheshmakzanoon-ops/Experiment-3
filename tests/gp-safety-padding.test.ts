import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { clamp, mod } from '../src/core/math.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { VenueKitContext } from '../src/rendering/venue-kit/context.ts';
import { buildBarrierChunk } from '../src/rendering/venue-kit/barriers.ts';
import {
  buildGpSafetyPadding,
  GP_SAFETY_PADDING,
  gpSafetyPaddingGeometry,
  gpSafetyPaddingMaterial,
  gpSafetyPaddingPlan,
} from '../src/rendering/venue-kit/gp-safety-padding.ts';
import { chunks } from '../src/rendering/venue-kit/sweep.ts';
import { WeatherPresentation, weatherSurface } from '../src/rendering/weather-presentation.ts';

/** Texture generation is irrelevant to placement. This lightweight context
 * retains the actual chunk builder, detail registry and other-section guard. */
function context(track: Track) {
  const materials = Object.fromEntries(
    ['concrete', 'saferFoam', 'steel', 'tyreBand', 'tyre', 'rock', 'darkSteel'].map((name) => {
      const material = new T.MeshStandardMaterial();
      material.name = name;
      return [name, material];
    }),
  );
  return Object.assign(Object.create(VenueKitContext.prototype), {
    track,
    meta: track.circuit.catalogue!,
    materials,
    root: new T.Group(),
    cells: [],
    scratch: trackPoint(),
  }) as VenueKitContext;
}

const courseIds = ['poggio-alto', 'cape-wrenna', 'haarveld', 'montejaral'] as const;
function track(id: string) {
  return new Track('clear', false, undefined, circuitDefinition(id));
}

function meshes(root: T.Object3D) {
  const list: T.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof T.Mesh) list.push(o);
  });
  return list;
}

describe('GP covered safety barriers', () => {
  it('uses a closed rounded shell within the original tyre-wall envelope', () => {
    const geometry = gpSafetyPaddingGeometry(),
      p = geometry.getAttribute('position'),
      normal = geometry.getAttribute('normal'),
      pad = GP_SAFETY_PADDING,
      a = new T.Vector3(),
      b = new T.Vector3(),
      c = new T.Vector3(),
      cross = new T.Vector3();
    expect(p.count / 3).toBeLessThanOrEqual(300);
    let volume = 0;
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i);
      b.fromBufferAttribute(p, i + 1);
      c.fromBufferAttribute(p, i + 2);
      volume += a.dot(cross.crossVectors(b, c)) / 6;
      expect(cross.subVectors(b, a).cross(c.clone().sub(a)).length()).toBeGreaterThan(1e-9);
    }
    expect(volume).toBeGreaterThan(2);
    expect(volume).toBeLessThan(pad.depth * pad.height * pad.length);
    for (let i = 0; i < p.count; i++) {
      expect([p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite)).toBe(true);
      expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
    }
    const box = geometry.boundingBox!;
    expect(box.min.x + pad.centreDepth).toBeGreaterThan(-1.31);
    expect(box.max.x + pad.centreDepth).toBeLessThan(0);
    expect(box.min.y).toBeCloseTo(-pad.buried, 6);
    expect(box.max.y).toBeLessThan(pad.height);
    // A ray through a box corner misses the softened shell. A solid block
    // with the same envelope would falsely pass through this witness point.
    const material = new T.MeshBasicMaterial(),
      shell = new T.Mesh(geometry, material),
      witness = new T.Vector3(box.max.x - 0.015, box.max.y - 0.01, 4),
      ray = new T.Raycaster(witness, new T.Vector3(0, 0, -1));
    expect(ray.intersectObject(shell)).toHaveLength(0);
    geometry.dispose();
    material.dispose();
  });

  it.each(courseIds)('keeps %s covers grounded and clear of the race/pit corridors', (id) => {
    const circuit = track(id),
      kit = context(circuit),
      geometry = gpSafetyPaddingGeometry(),
      p = geometry.getAttribute('position'),
      vertices = new Map<string, number>(),
      q = trackPoint(),
      start = trackPoint(),
      end = trackPoint(),
      world = new T.Vector3();
    for (let i = 0; i < p.count; i++) vertices.set(`${p.getX(i)}/${p.getY(i)}/${p.getZ(i)}`, i);
    let count = 0,
      bottomChecks = 0;
    for (const span of kit.meta.dressing.barriers) {
      if (span.kind !== 'tyre') continue;
      for (const [chunkFrom, chunkTo] of chunks(0, circuit.length, 60)) {
        const a = Math.max(chunkFrom, span.from),
          b = Math.min(chunkTo, span.to);
        if (b - a < 0.5) continue;
        for (const [from, to] of chunks(a, b, 20)) {
          const sites = gpSafetyPaddingPlan(kit, from, to, span.side);
          count += sites.length;
          for (const site of sites) {
            expect(site.matrix.determinant()).toBeGreaterThan(0);
            const axes = [0, 1, 2].map((column) =>
              new T.Vector3().setFromMatrixColumn(site.matrix, column),
            );
            expect(Math.abs(axes[0].dot(axes[1]))).toBeLessThan(1e-8);
            expect(Math.abs(axes[0].dot(axes[2]))).toBeLessThan(1e-8);
            expect(Math.abs(axes[1].dot(axes[2]))).toBeLessThan(1e-8);
            expect(axes[2].length() * GP_SAFETY_PADDING.length).toBeLessThan(2.5);
            circuit.at(site.from, start);
            circuit.at(site.to, end);
            for (const i of vertices.values()) {
              world.fromBufferAttribute(p, i).applyMatrix4(site.matrix);
              const lateral = circuit.nearest(world.x, world.z, q),
                alongGap = Math.abs(
                  mod(q.s - site.s + circuit.length / 2, circuit.length) - circuit.length / 2,
                ),
                inset = Math.abs(lateral) - circuit.boundaryAt(q, span.side),
                ground = q.y + q.bank * clamp(lateral, -12, 12);
              expect(alongGap).toBeLessThan(5);
              expect(inset).toBeGreaterThan(-1.31);
              expect(inset).toBeLessThan(-0.07);
              expect(Math.abs(lateral)).toBeGreaterThan(q.width + 4);
              // Adjacent covers share these exact start/end planes. All
              // vertices stay on opposite sides with a 36 mm separation;
              // this also proves no overlaps across 20/60 m chunk joins.
              expect(
                (world.x - start.x) * start.tx + (world.z - start.z) * start.tz,
              ).toBeGreaterThan(0.0179);
              expect((world.x - end.x) * end.tx + (world.z - end.z) * end.tz).toBeLessThan(-0.0179);
              if (Math.abs(p.getY(i) + GP_SAFETY_PADDING.buried) < 1e-6) {
                expect(world.y - ground).toBeGreaterThan(-0.11);
                expect(world.y - ground).toBeLessThan(0.035);
                bottomChecks++;
              }
              if (span.side === circuit.pit.side && circuit.isPitSection(q.s))
                expect(Math.abs(circuit.pitOffset(q.s))).toBeLessThanOrEqual(3);
            }
          }
        }
      }
    }
    if (id === 'cape-wrenna') {
      // This circuit has no tyre-type spans: its armco is preserved.
      expect(kit.meta.dressing.barriers.some((span) => span.kind === 'tyre')).toBe(false);
      expect(count).toBe(0);
    } else {
      expect(count).toBeGreaterThan(10);
      expect(bottomChecks).toBeGreaterThan(20);
    }
    geometry.dispose();
  });

  it('omits pit-side and other-section conflicts using the production clearance guard', () => {
    const circuit = track('poggio-alto'),
      kit = context(circuit);
    let pit = -1;
    for (let s = 10; s < circuit.length - 10; s += 10)
      if (circuit.isPitSection(s) && Math.abs(circuit.pitOffset(s)) > 3) {
        pit = s;
        break;
      }
    expect(pit).toBeGreaterThanOrEqual(0);
    expect(gpSafetyPaddingPlan(kit, pit - 0.4, pit + 0.4, circuit.pit.side)).toHaveLength(0);
    const span = kit.meta.dressing.barriers.find((s) => s.kind === 'tyre')!,
      mid = (span.from + span.to) / 2,
      sites = gpSafetyPaddingPlan(kit, mid - 10, mid + 10, span.side);
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites)
      for (const x of [-0.58, 0.58])
        for (const z of [-1.2, 1.2]) {
          const p = new T.Vector3(x, 0, z).applyMatrix4(site.matrix);
          expect(kit.overOtherSection(p.x, p.z, site.s, 1)).toBe(false);
        }
    const distant = circuit.at(mid + circuit.length / 2, trackPoint());
    expect(kit.overOtherSection(distant.x, distant.z, mid, 1)).toBe(true);
  });

  it('replaces only the four GP venues’ tyre dressings and retains concrete and catch fence', () => {
    const gp = track('poggio-alto'),
      gpKit = context(gp),
      span = gpKit.meta.dressing.barriers.find((s) => s.kind === 'tyre')!,
      from = Math.floor(span.from / 60) * 60,
      to = from + 60,
      // Same track data, unrelated identity: an exact witness for GP gating.
      road = new Track('clear', false, undefined, { ...gp.circuit, id: 'riviera' }),
      roadKit = context(road);
    buildBarrierChunk(gpKit, from, to);
    buildBarrierChunk(roadKit, from, to);
    const revised = meshes(gpKit.root),
      original = meshes(roadKit.root),
      cover = revised.filter((m) => m.name === 'GP rounded protective covers');
    expect(cover).toHaveLength(1);
    expect(cover[0]).toBeInstanceOf(T.InstancedMesh);
    expect(revised.some((m) => m.name === 'Tyre wall')).toBe(false);
    expect(revised.some((m) => m.name.startsWith('tyreBand'))).toBe(false);
    expect(original.some((m) => m.name === 'Tyre wall')).toBe(true);
    expect(original.some((m) => m.name.startsWith('tyreBand'))).toBe(true);
    expect(gpSafetyPaddingPlan(roadKit, span.from, span.to, span.side)).toEqual([]);
    for (const name of ['Venue kit catch fence', 'Catch-fence posts']) {
      const a = revised.find((m) => m.name.startsWith(name))!,
        b = original.find((m) => m.name.startsWith(name))!;
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(Array.from(a.geometry.getAttribute('position').array)).toEqual(
        Array.from(b.geometry.getAttribute('position').array),
      );
    }
    const backing = revised.find((m) => m.name.startsWith('concrete'))!,
      oldBacking = original.find((m) => m.name.startsWith('concrete'))!,
      point = trackPoint();
    const section = (mesh: T.Mesh) => {
      const positions = mesh.geometry.getAttribute('position'),
        uv = mesh.geometry.getAttribute('uv');
      return Array.from({ length: positions.count }, (_, i) => {
        // UVs record source metres / 5. Remove Float32 rounding before
        // resolving a station on an exact two-metre catalogue-cell edge.
        const s = Math.round(uv.getX(i) * 5000) / 1000;
        gp.at(s, point);
        const lateral =
          (positions.getX(i) - point.x) * point.nx + (positions.getZ(i) - point.z) * point.nz;
        return {
          s,
          outward: span.side * lateral - gp.boundaryAt(point, span.side),
          height: positions.getY(i) - point.y - point.bank * clamp(lateral, -12, 12),
        };
      });
    };
    const oldProfile = section(oldBacking),
      newProfile = section(backing),
      stations = [...new Set(newProfile.map((p) => p.s))].sort((a, b) => a - b);
    expect(newProfile.length).toBeGreaterThan(oldProfile.length);
    for (let i = 1; i < stations.length; i++)
      expect(stations[i] - stations[i - 1]).toBeLessThanOrEqual(2.001);
    // Sampling follows the bend more faithfully; the retained profile and
    // its offsets/heights at the physical boundary are otherwise identical.
    for (const p of newProfile)
      expect(
        oldProfile.some(
          (q) => Math.abs(p.outward - q.outward) < 0.002 && Math.abs(p.height - q.height) < 0.002,
        ),
      ).toBe(true);
    // Pads replace both an old belt draw and tyre-instance draw; do not add
    // an always-visible object per individual module.
    expect(revised.length).toBeLessThan(original.length);
    const triangles = (list: T.Mesh[]) =>
      list.reduce(
        (total, mesh) =>
          total +
          ((mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3) *
            (mesh instanceof T.InstancedMesh ? mesh.count : 1),
        0,
      );
    expect(triangles(revised)).toBeLessThan(triangles(original));
    expect(gpKit.root.children[0].name).toContain(`${from}-${to}`);
  });

  it('exposes GP cover faces to race-side rays instead of hiding them behind a concrete chord', () => {
    const circuit = track('poggio-alto'),
      kit = context(circuit),
      span = kit.meta.dressing.barriers.find((s) => s.kind === 'tyre')!,
      baseline = context(
        new Track('clear', false, undefined, { ...circuit.circuit, id: 'riviera' }),
      );
    buildBarrierChunk(kit, span.from, span.to);
    buildBarrierChunk(baseline, span.from, span.to);
    kit.root.updateMatrixWorld(true);
    baseline.root.updateMatrixWorld(true);
    const current = meshes(kit.root),
      cover = current.find((m) => m.name === 'GP rounded protective covers') as T.InstancedMesh,
      backing = current.find((m) => m.name.startsWith('concrete'))!,
      oldBacking = meshes(baseline.root).find((m) => m.name.startsWith('concrete'))!,
      matrix = new T.Matrix4(),
      ray = new T.Raycaster(),
      outward = new T.Vector3(),
      target = new T.Vector3();
    let hiddenBefore = 0;
    for (let i = 0; i < cover.count; i++) {
      cover.getMatrixAt(i, matrix);
      outward.setFromMatrixColumn(matrix, 0).normalize();
      for (const height of [0.25, 0.55, 0.85]) {
        target.set(0, height, 0).applyMatrix4(matrix);
        ray.set(target.clone().addScaledVector(outward, -8), outward);
        ray.far = 10;
        expect(ray.intersectObjects([cover, backing], false)[0]?.object).toBe(cover);
        if (ray.intersectObjects([cover, oldBacking], false)[0]?.object === oldBacking)
          hiddenBefore++;
      }
    }
    // This witness would fail against the former long endpoint chords; it
    // tests actual visibility, not merely that subdivision added vertices.
    expect(hiddenBefore).toBeGreaterThan(cover.count);
  });

  it('shares resources within a venue, owns them separately across scenes, and builds deterministically', () => {
    const kit = context(track('poggio-alto')),
      span = kit.meta.dressing.barriers.find((s) => s.kind === 'tyre')!,
      sites = gpSafetyPaddingPlan(kit, span.from, span.from + 20, span.side),
      a = buildGpSafetyPadding(kit, sites)!,
      b = buildGpSafetyPadding(
        kit,
        gpSafetyPaddingPlan(kit, span.from, span.from + 20, span.side),
      )!,
      other = context(kit.track),
      c = buildGpSafetyPadding(other, sites)!;
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    expect(c.geometry).not.toBe(a.geometry);
    expect(c.material).not.toBe(a.material);
    expect(Array.from(a.instanceMatrix.array)).toEqual(Array.from(b.instanceMatrix.array));
    expect(Array.from(a.instanceColor!.array)).toEqual(Array.from(b.instanceColor!.array));
    expect(a.boundingSphere!.radius).toBeLessThan(24);
    expect(a.count).toBeLessThanOrEqual(30);
    expect((a.geometry.getAttribute('position').count / 3) * a.count).toBeLessThanOrEqual(9000);
    expect(buildGpSafetyPadding(kit, [])).toBeNull();
  });

  it('composes the fabric finish with recorded weather without new maps or uniforms per module', () => {
    const material = gpSafetyPaddingMaterial(),
      weather = new WeatherPresentation(),
      shader = {
        uniforms: {},
        vertexShader: T.ShaderLib.standard.vertexShader,
        fragmentShader: T.ShaderLib.standard.fragmentShader,
      } as T.WebGLProgramParametersWithUniforms;
    expect(weatherSurface(material)).toBe('fabric');
    expect(material.map).toBeNull();
    expect(material.normalMap).toBeNull();
    weather.installMaterial(material);
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.uniforms.aurelSurfaceWeather).toBe(weather.surface);
    expect(shader.fragmentShader).toContain('gpPaddingRelief');
    expect(shader.fragmentShader).toContain('min(1., width / aa)');
    expect(shader.vertexShader).toContain('#include <project_vertex>');
    expect(shader.vertexShader).toContain('#include <defaultnormal_vertex>');
    expect(material.customProgramCacheKey()).toContain('gp-safety-cover-finish-v1');
    weather.dispose();
    material.dispose();
  });
});
