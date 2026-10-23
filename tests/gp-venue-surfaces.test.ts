import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { installWetRoad } from '../src/rendering/materials.ts';
import {
  GP_SCANNED_ASPHALT,
  installScannedAsphalt,
} from '../src/rendering/ground/scanned-ground.ts';
import { GP_GRAVEL, GP_TURF } from '../src/rendering/ground/gp-ground.ts';
import { GP_VENUE_ROAD, installRoadDetail } from '../src/rendering/studio/road-detail.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';
import { surfaceMaterial } from '../src/rendering/surface-detail.ts';
import {
  GP_VENUE_STREAKS,
  TyreMarkPresentation,
  gpVenueStreaks,
  tyreMarkZones,
} from '../src/rendering/tyre-marks.ts';
import { venueKitMaterials } from '../src/rendering/venue-kit/materials.ts';
import { VENUE_THEMES } from '../src/rendering/venue-kit/theme.ts';
import { queueGround } from '../src/rendering/venue-kit/ground.ts';
import { VenueKitContext } from '../src/rendering/venue-kit/context.ts';
import { isGpCourse } from '../src/simulation/gp-corner-shape.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { SURFACE, Track, trackPoint } from '../src/simulation/track.ts';
import { BuildQueue } from '../src/rendering/build-queue.ts';
import { installCircuitFinish } from '../src/rendering/circuit-finish.ts';
import {
  FAR,
  GP_FAR,
  TERRAIN_FINISH_HOOK,
  installTerrainFinish,
} from '../src/rendering/studio/terrain-finish.ts';

class Canvas {
  width = 300;
  height = 150;
  getContext() {
    return new Proxy(
      { canvas: this },
      {
        get: (t, k) =>
          k === 'createImageData'
            ? (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
            : (Reflect.get(t, k) ?? (() => {})),
      },
    );
  }
}
const stubCanvas = () => vi.stubGlobal('document', { createElement: () => new Canvas() });
afterEach(() => vi.unstubAllGlobals());

const compile = (material: T.Material) => {
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
  } as unknown as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
};
const track = (id: keyof typeof CIRCUITS) => new Track('clear', false, undefined, CIRCUITS[id]);
const GP = ['poggio-alto', 'cape-wrenna', 'haarveld', 'montejaral'] as const;

describe('GP venue rubber history', () => {
  it.each(GP)('%s: dense, deterministic streaks stay on the asphalt', (id) => {
    const t = track(id),
      p = trackPoint(),
      marks = gpVenueStreaks(t);
    expect(gpVenueStreaks(t)).toEqual(marks);
    const zones = tyreMarkZones(t, true);
    const braking = zones.filter((z) => z.kind === 'braking').length;
    expect(marks.length).toBeGreaterThanOrEqual(braking * GP_VENUE_STREAKS.brakingPasses[0]);
    let crossing = 0;
    for (const mark of marks) {
      expect(mark.width).toBeGreaterThanOrEqual(GP_VENUE_STREAKS.width[0]);
      expect(mark.width).toBeLessThanOrEqual(GP_VENUE_STREAKS.width[1]);
      expect(mark.alpha[0]).toBe(0);
      expect(Math.max(...mark.alpha)).toBeLessThanOrEqual(GP_VENUE_STREAKS.strength[1]);
      for (let i = 0; i < mark.s.length; i++) {
        t.at(mark.s[i], p);
        expect(Math.abs(mark.lateral[i]) + mark.width! / 2).toBeLessThan(p.width);
      }
      const drift = Math.abs(mark.lateral[mark.s.length - 1] - mark.lateral[0]);
      if (drift > 1.2) crossing++;
    }
    // Curving and crossing passes, not parallel copies of the line.
    expect(crossing).toBeGreaterThan(marks.length * 0.08);
  });

  it('builds the venue layer only at GP venues and keeps it through family switches', () => {
    stubCanvas();
    for (const id of ['poggio-alto', 'parco-reale', 'aurel'] as const) {
      const t = track(id),
        state = new T.DataTexture(new Uint8Array(4), 1, 1),
        presentation = new TyreMarkPresentation(t, state);
      presentation.build(new T.Group());
      const venue = presentation.root.children.find((c) => c.name === 'GP venue rubber history');
      expect(!!venue).toBe(isGpCourse(t));
      if (venue) {
        for (let i = 0; i < 12; i++) presentation.setMotorcycle(i % 3 !== 0, i % 3 === 2);
        expect(venue.visible).toBe(true);
        expect(presentation.diagnostics().venueMeshes).toBe(venue.children.length);
        const materials = new Set<T.Material>();
        presentation.root.traverse((o) => {
          if (o instanceof T.Mesh) materials.add(o.material as T.Material);
        });
        // One shared mark material (one program) for every layer.
        expect(materials.size).toBe(1);
      } else expect(presentation.diagnostics().venueMeshes).toBe(0);
      state.dispose();
    }
  });
});

describe('GP venue asphalt', () => {
  const road = (gp: boolean) => {
    stubCanvas();
    const material = surfaceMaterial('asphalt', undefined, true);
    installWetRoad(material, new T.DataTexture(new Uint8Array(4), 1, 1), true);
    installRoadDetail(material, 5245, { value: 1 }, undefined, { value: 1 }, undefined, gp);
    installScannedAsphalt(material, gp);
    return material;
  };
  it('compiles the polish band, off-line dust and anti-tiling terms only for GP venues', () => {
    const gp = road(true),
      plain = road(false);
    expect(studioHookKeys(gp)).toEqual(['road-detail-v7-gp-venue-v1', 'scanned-asphalt-gp-v1']);
    expect(studioHookKeys(plain)).toEqual(['road-detail-v7', 'scanned-asphalt-v1']);
    const g = compile(gp).fragmentShader,
      p = compile(plain).fragmentShader;
    for (const term of ['venueBand', 'venueLane', 'venueDrift']) {
      expect(g).toContain(term);
      expect(p).not.toContain(term);
    }
    expect(g).toContain(GP_SCANNED_ASPHALT.stains.toFixed(4));
    expect(g).toContain(GP_VENUE_ROAD.dustWidth.toFixed(5));
    // Derivatives of the lane field are taken in uniform control flow.
    const lane = g.indexOf('venueLaneAA');
    expect(g.lastIndexOf('if (', lane)).toBeLessThan(g.lastIndexOf('{', lane));
  });
});

describe('GP verge turf and gravel', () => {
  it('installs the GP turf and gravel hooks only on the GP palette', () => {
    stubCanvas();
    const style = VENUE_THEMES['tuscan-hills'];
    const gp = venueKitMaterials(style, true),
      plain = venueKitMaterials(style);
    expect(studioHookKeys(gp.gravel)).toContain('gp-gravel-v1');
    expect(studioHookKeys(gp.ground)).toContain('gp-turf-v1');
    expect(studioHookKeys(plain.gravel)).not.toContain('gp-gravel-v1');
    expect(studioHookKeys(plain.ground)).not.toContain('gp-turf-v1');
    const f = compile(gp.gravel).fragmentShader;
    expect(compile(gp.gravel).vertexShader).toContain('attribute float gravelCover');
    expect(f).toContain('discard');
    // The discard is gated on the extension cover: inside the trap nothing is cut.
    expect(f.indexOf('vGravelCover < 0.999')).toBeLessThan(f.indexOf('discard'));
    expect(compile(gp.ground).fragmentShader).toContain(GP_TURF.saturation.toFixed(4));
    expect(GP_GRAVEL.tint[0]).toBeGreaterThan(1);
  });

  it('extends GP gravel ribbons one quad into the grass with a cover attribute', () => {
    stubCanvas();
    for (const id of ['poggio-alto', 'parco-reale'] as const) {
      const t = track(id),
        kit = new VenueKitContext(t),
        meshes: { material: T.Material; geometry: T.BufferGeometry }[] = [];
      const scene = Object.assign(Object.create(CircuitScene.prototype) as CircuitScene, {
        track: t,
        surfaces: new T.Group(),
      });
      const host = {
        construction: new BuildQueue(),
        ribbon: (material: T.Material, options: Parameters<CircuitScene['ribbon']>[1]) => {
          const mesh = scene.ribbon(material, options);
          meshes.push({ material, geometry: mesh.geometry });
          return mesh;
        },
      };
      queueGround(kit, host);
      host.construction.runSynchronously();
      const gravel = meshes.filter((m) => m.material === kit.materials.gravel);
      expect(gravel.length).toBeGreaterThan(0);
      const covered = gravel.filter((m) => m.geometry.getAttribute('gravelCover'));
      if (!isGpCourse(t)) {
        expect(covered).toHaveLength(0);
        continue;
      }
      expect(covered).toHaveLength(gravel.length);
      const p = trackPoint();
      let partial = 0;
      for (const { geometry } of covered) {
        const cover = geometry.getAttribute('gravelCover'),
          uv = geometry.getAttribute('uv');
        for (let i = 0; i < cover.count; i++) {
          const s = uv.getY(i) * 5,
            l = uv.getX(i) * 5;
          const physical = t.runoffSurface(t.at(s, p), l) === SURFACE.GRAVEL ? 1 : 0;
          expect(cover.getX(i)).toBe(physical);
          if (!physical) partial++;
        }
      }
      // Each trap end contributes a feathered quad over the grass.
      expect(partial).toBeGreaterThan(0);
    }
  });
});

describe('GP venue hills', () => {
  it('lays the canopy carpet nearer the circuit only at GP venues', () => {
    const terrain = (gp: boolean) => {
      const material = new T.MeshStandardMaterial();
      installCircuitFinish(material, 'terrain');
      installTerrainFinish(material, gp);
      return material;
    };
    const gp = terrain(true),
      plain = terrain(false);
    expect(studioHookKeys(plain)).toEqual([TERRAIN_FINISH_HOOK]);
    expect(studioHookKeys(gp)).toEqual(['terrain-finish-gp-v1']);
    const near = `smoothstep( ${GP_FAR.forestFrom.toFixed(4)}, ${GP_FAR.forestFull.toFixed(4)}, vTrackDistance )`;
    const far = `smoothstep( ${FAR.forestFrom.toFixed(4)}, ${FAR.forestFull.toFixed(4)}, vTrackDistance )`;
    expect(compile(gp).fragmentShader).toContain(near);
    expect(compile(plain).fragmentShader).toContain(far);
    expect(compile(plain).fragmentShader).not.toContain(near);
    expect(GP_FAR.forestFull).toBeLessThan(FAR.forestFrom);
  });
});
