import { afterAll, describe, expect, it } from 'vitest';
import * as T from 'three';
import { Vec3 } from '../src/core/math.ts';
import { StreetIronwork } from '../src/rendering/open-world/street-ironwork.ts';
import { festivalMarkings } from '../src/simulation/open-world/festival-markings.ts';
import { WORLD_SURFACE, OpenWorldTrack } from '../src/simulation/open-world/open-world-track.ts';
import {
  IRON_DIMENSIONS,
  ironGrip,
  streetIronwork,
} from '../src/simulation/open-world/street-ironwork.ts';
import { townCrossings } from '../src/simulation/open-world/town-crossings.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { surfaceSample, trackPoint } from '../src/simulation/track.ts';

const world = openWorld(),
  net = world.network,
  layout = streetIronwork(net),
  model = new StreetIronwork(net);
const dry = new OpenWorldTrack(world, 'clear', undefined, 12),
  wet = new OpenWorldTrack(world, 'rain', undefined, 12);
afterAll(() => model.dispose());

describe('Port Ilse street castings', () => {
  it('aligns every installed fitting with its surveyed town asphalt and keeps the painted carriageway visible', () => {
    const markings = festivalMarkings(net);
    let covers = 0,
      gullies = 0;
    for (const edge of net.edges)
      for (const f of layout.edges[edge.index]) {
        expect(edge.roadClass).toBe('town');
        const p = net.at(edge.offset + f.station, trackPoint());
        const h = net.surfaceHeight(p, f.lateral, edge.spec.halfWidth, edge.spec.crown);
        const contact = dry.sample(
          p.x + p.nx * f.lateral,
          p.z + p.nz * f.lateral,
          surfaceSample(),
          h + 0.4,
        );
        expect(dry.query.surface, edge.id + ' ' + f.station).toBe(WORLD_SURFACE.IRON);
        expect(dry.query.bridge).toBe(false);
        expect(Math.abs(contact.height - h)).toBeLessThan(0.006);
        expect(
          townCrossings(net, edge).every(
            (site) => f.station < site.minPaint - 3 || f.station > site.maxPaint + 3,
          ),
        ).toBe(true);
        const size = IRON_DIMENSIONS[f.kind];
        expect(
          markings.roadPaintCoverage(
            edge.index,
            edge.offset + f.station,
            f.lateral,
            0,
            size.across + 0.02,
          ),
        ).toBe(0);
        if (f.kind === 'cover') covers++;
        else gullies++;
      }
    expect(covers).toBeGreaterThan(35);
    expect(gullies).toBeGreaterThan(covers);
    expect(model.count).toEqual({ cover: covers, gully: gullies });
    let triangles = 0;
    for (const mesh of model.root.children as T.Mesh[]) {
      triangles += mesh.geometry.index!.count / 3;
      const normals = mesh.geometry.getAttribute('normal');
      for (let i = 0; i < normals.count; i++) expect(normals.getY(i)).toBeGreaterThan(0.9);
    }
    expect(triangles).toBe(2 * (covers + gullies));
  });
  it('integrates wheels at arbitrary steering angles over both styles of casting', () => {
    const edge = net.edges.find(
      (e) =>
        layout.edges[e.index].some((f) => f.kind === 'cover') &&
        layout.edges[e.index].some((f) => f.kind === 'gully'),
    )!;
    for (const kind of ['cover', 'gully'] as const) {
      const f = layout.edges[edge.index].find((f) => f.kind === kind)!,
        size = IRON_DIMENSIONS[kind];
      for (const angle of [0, 0.34, 1.36, 2.1]) {
        const ds = 0.15 * Math.sin(angle),
          dl = 0.15 * Math.cos(angle);
        const s = f.station + 0.27,
          l = f.lateral + size.across * 0.75;
        let count = 0;
        for (let i = 0; i < 10000; i++) {
          const t = (i + 0.5) / 5000 - 1,
            x = l + dl * t - f.lateral,
            z = s + ds * t - f.station;
          if (
            kind === 'cover'
              ? Math.hypot(x, z) <= size.along
              : Math.abs(z) <= size.along && Math.abs(x) <= size.across
          )
            count++;
        }
        expect(layout.coverage(edge.index, s, l, ds, dl)).toBeCloseTo(count / 10000, 3);
      }
      const p = net.at(edge.offset + f.station, trackPoint());
      for (const track of [dry, wet]) {
        const toward = -Math.sign(f.lateral);
        const cast = (delta: number) => {
          const l = f.lateral + delta * toward,
            y = net.surfaceHeight(p, l, edge.spec.halfWidth, edge.spec.crown);
          const out = surfaceSample();
          expect(
            Number.isFinite(
              track.castTire(
                new Vec3(p.x + p.nx * l, y + 0.8, p.z + p.nz * l),
                new Vec3(0, -1, 0),
                1.6,
                0.31,
                0.11,
                new Vec3(p.nx, 0, p.nz),
                out,
                new Vec3(),
              ),
            ),
          ).toBe(true);
          return out;
        };
        const centre = cast(0),
          half = cast(size.across),
          off = cast(size.across + 0.2);
        expect(centre.grip).toBeCloseTo(ironGrip(centre.water) * edge.spec.grip, 5);
        expect(half.grip).toBeCloseTo((centre.grip + off.grip) / 2, 2);
        expect(half.rubber).toBeCloseTo(0.04, 2);
        expect(off.grip).toBeGreaterThan(centre.grip);
      }
    }
    expect(ironGrip(1.35)).toBeLessThan(ironGrip(0) - 0.2);
  });
  it('retains cutout, relief and wet specular response within a single town material', () => {
    const mat = model.material;
    const albedo = mat.map!.image.data as Uint8Array,
      normal = mat.normalMap!.image.data as Uint8Array;
    const packed = mat.roughnessMap!.image.data as Uint8Array;
    expect(albedo[3]).toBe(0);
    expect(mat.roughnessMap).toBe(mat.metalnessMap);
    let open = 0,
      slat = 0,
      slopes = 0,
      polished = 0;
    const w = mat.map!.image.width;
    for (let y = 0; y < mat.map!.image.height; y++)
      for (let x = 0; x < w; x++) {
        const k = 4 * (y * w + x);
        if (!albedo[k + 3]) continue;
        if (normal[k + 2] < 245) slopes++;
        if (packed[k + 2] > 203) polished++;
        if (x > w / 2 && albedo[k] < 35) open++;
        if (x > w / 2 && albedo[k] > 75) slat++;
      }
    for (const count of [open, slat, slopes, polished]) expect(count).toBeGreaterThan(900);
    const rough = mat.roughness;
    model.setWet(1);
    expect(mat.roughness).toBeLessThan(rough * 0.6);
    model.update(new T.Vector3(1e5, 0, 1e5));
    expect(model.root.children.some((o) => o.visible)).toBe(false);
  });
});
