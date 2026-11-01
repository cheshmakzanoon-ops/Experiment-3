import { describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type * as T from 'three';
import { BabylonCircuitScene } from '../src/engine/babylon/circuit-scene.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { AUREL, VELLAMAR, CIRCUITS } from '../src/simulation/circuits.ts';
import { FORMULA_APX01 } from '../src/simulation/vehicles.ts';
import { renderRibbonCase } from './fixtures/circuit-ribbon-cases.ts';

const context = { presentation: 'circuit', vehicles: [FORMULA_APX01] };
function engineWithAsphaltCapabilities() {
  const engine = new NullEngine();
  // Explicit capability simulation, not a real-GPU or native readiness claim.
  Object.defineProperty(engine, 'webGLVersion', { value: 2 });
  Object.assign(engine.getCaps(), { supportSRGBBuffers: true, standardDerivatives: true });
  return engine;
}
const bytes = (array: ArrayBufferView) =>
  Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const surfaces = (view: BabylonCircuitScene, kind: string, side?: number) =>
  view.scene.meshes.filter(
    (mesh) =>
      mesh.metadata?.surface === kind && (side === undefined || mesh.metadata?.side === side),
  );

for (const [circuit, chunks, vertices] of [
  [AUREL, 38, 31882],
  [VELLAMAR, 50, 42700],
] as const)
  describe(`live original ${circuit.id} Formula surface`, () => {
    it('replaces the coarse road with full-lap source-equivalent road and both authored paint bands', () => {
      const engine = engineWithAsphaltCapabilities();
      const track = new Track('clear', false, undefined, circuit);
      const before = JSON.stringify(track.points);
      const view = new BabylonCircuitScene(engine, track, 1, context);
      try {
        expect(view.scene.getMeshByName('existing-physics-track')).toBeNull();
        expect(view.surfaceDiagnostics).toEqual({
          kind: 'formula-ribbon',
          roadChunks: chunks,
          paintChunks: chunks * 2,
          leftPaintChunks: chunks,
          rightPaintChunks: chunks,
          coarseMeshes: 0,
          vertices,
          paintFinishMaterials: 1,
          asphaltSubstrateRoadChunks: chunks,
          asphaltSubstrateMaterials: 1,
          asphaltSubstrateTextures: 3,
          asphaltSubstrateSrgbTextures: 1,
        });
        const point = trackPoint();
        const options = [
          {
            offset: (s: number, t: number) => (t * 2 - 1) * track.at(s, point).width,
            columns: 14,
            road: true,
            step: 1.8,
          },
          ...[-1, 1].map((side) => ({
            offset: (s: number, t: number) => side * (track.at(s, point).width - 0.17 + t * 0.14),
            height: () => 0.006,
            step: 2,
          })),
        ];
        const actual = [
          surfaces(view, 'road'),
          surfaces(view, 'edge-paint', -1),
          surfaces(view, 'edge-paint', 1),
        ];
        const paintMaterials = new Set([...actual[1], ...actual[2]].map((m) => m.material));
        expect(paintMaterials.size).toBe(1);
        for (let group = 0; group < options.length; group++) {
          const legacy = renderRibbonCase({ name: 'full-lap', track, options: options[group] });
          try {
            expect(actual[group]).toHaveLength(legacy.meshes.length);
            legacy.meshes.forEach((original, index) => {
              const mesh = actual[group][index];
              expect(mesh).toBeInstanceOf(Mesh);
              if (!(mesh instanceof Mesh)) throw new Error('Expected an owned ribbon Mesh');
              expect(mesh.getVerticesDataKinds().sort()).toEqual(
                Object.keys(original.geometry.attributes).sort(),
              );
              for (const [name, attribute] of Object.entries(original.geometry.attributes))
                expect(
                  bytes(new Float32Array(mesh.getVerticesData(name)!)).equals(
                    bytes(attribute.array),
                  ),
                  `${group}/${index}/${name}`,
                ).toBe(true);
              expect(Array.from(mesh.getIndices()!)).toEqual(
                Array.from(original.geometry.index!.array),
              );
              expect(mesh.metadata.side).toBe(group === 0 ? 0 : group === 1 ? -1 : 1);
              expect(mesh.metadata.strip ?? null).toEqual(
                original.userData.strip
                  ? {
                      width: original.userData.strip.width,
                      centreline: original.userData.strip.centreline.map((v: T.Vector3) =>
                        v.toArray(),
                      ),
                    }
                  : null,
              );
            });
          } finally {
            legacy.meshes.forEach((m) => m.geometry.dispose());
            legacy.material.dispose();
          }
        }
        expect(JSON.stringify(track.points)).toBe(before);
        // Counts are actual live-resource observations, not copied target constants.
        actual[1][0].dispose();
        expect(view.surfaceDiagnostics.leftPaintChunks).toBe(chunks - 1);
        expect(view.surfaceDiagnostics.paintChunks).toBe(chunks * 2 - 1);
      } finally {
        view.dispose();
        engine.dispose();
      }
    });
  });

it('retains the original coarse +.010 road for absent, non-Formula, noncanonical and unsupported presentation contexts', () => {
  const engine = new NullEngine();
  const entries = [
    { track: new Track('clear'), context: undefined },
    { track: new Track('clear'), context: { ...context, presentation: 'open-world' } },
    {
      track: new Track('clear'),
      context: {
        ...context,
        vehicles: [{ classId: 'touring' as const, dynamicsKind: 'four-wheel' as const }],
      },
    },
    {
      track: new Track('clear'),
      context: {
        ...context,
        vehicles: [{ classId: 'formula' as const, dynamicsKind: 'bike' as const }],
      },
    },
    { track: new Track('clear'), context: { ...context, vehicles: [] } },
    {
      track: new Track('clear'),
      context: { ...context, vehicles: [FORMULA_APX01, FORMULA_APX01] },
    },
    { track: new Track('clear', false, undefined, { ...AUREL }), context },
    { track: new Track('clear', false, undefined, CIRCUITS['poggio-alto']), context },
    { track: new Track('clear', false, undefined, CIRCUITS['valley-ridge-mx']), context },
  ];
  try {
    for (const entry of entries) {
      const view = new BabylonCircuitScene(engine, entry.track, 1, entry.context);
      try {
        const d = view.surfaceDiagnostics;
        expect(d.kind).toBe('coarse');
        expect(d.coarseMeshes).toBe(1);
        expect(
          d.roadChunks +
            d.paintChunks +
            d.leftPaintChunks +
            d.rightPaintChunks +
            d.paintFinishMaterials +
            d.asphaltSubstrateRoadChunks +
            d.asphaltSubstrateMaterials +
            d.asphaltSubstrateTextures +
            d.asphaltSubstrateSrgbTextures,
        ).toBe(0);
        expect(surfaces(view, 'road')).toHaveLength(0);
        expect(surfaces(view, 'edge-paint')).toHaveLength(0);
        const road = view.scene.getMeshByName('existing-physics-track')!;
        expect(road).not.toBeNull();
        const positions = road.getVerticesData('position')!;
        expect(positions).toHaveLength(entry.track.points.length * 6);
        entry.track.points.forEach((p, i) => {
          const offset = i * 6;
          expect(positions[offset + 1]).toBeCloseTo(p.y - p.bank * Math.min(p.width, 12) + 0.01, 4);
          expect(positions[offset + 4]).toBeCloseTo(p.y + p.bank * Math.min(p.width, 12) + 0.01, 4);
        });
      } finally {
        view.dispose();
      }
    }
  } finally {
    engine.dispose();
  }
});

it('cleans the unreachable scene after an eligible-path constructor failure instead of silently falling back', () => {
  const engine = engineWithAsphaltCapabilities();
  const before = engine.scenes.length;
  const failure = new Error('injected original surface upload failure');
  const upload = vi.spyOn(Mesh.prototype, 'setVerticesData').mockImplementationOnce(() => {
    throw failure;
  });
  try {
    expect(() => new BabylonCircuitScene(engine, new Track('clear'), 1, context)).toThrow(failure);
    expect(engine.scenes).toHaveLength(before);
  } finally {
    upload.mockRestore();
    engine.dispose();
  }
});

it('lets scene disposal own every surface resource exactly once, including scene-first shutdown', () => {
  for (const sceneFirst of [false, true]) {
    const engine = engineWithAsphaltCapabilities();
    const view = new BabylonCircuitScene(engine, new Track('clear'), 1, context);
    const meshes: AbstractMesh[] = [...surfaces(view, 'road'), ...surfaces(view, 'edge-paint')];
    const materials = [...new Set(meshes.map((m) => m.material!))];
    const textures = view.scene.textures.filter((t) => t !== view.scene.environmentBRDFTexture);
    expect(textures).toHaveLength(3);
    const spies = [...meshes, ...materials, ...textures].map((resource) =>
      vi.spyOn(resource, 'dispose'),
    );
    if (sceneFirst) view.scene.dispose();
    view.dispose();
    view.dispose();
    spies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    expect(view.surfaceDiagnostics).toEqual({
      kind: 'disposed',
      roadChunks: 0,
      paintChunks: 0,
      leftPaintChunks: 0,
      rightPaintChunks: 0,
      coarseMeshes: 0,
      vertices: 0,
      paintFinishMaterials: 0,
      asphaltSubstrateRoadChunks: 0,
      asphaltSubstrateMaterials: 0,
      asphaltSubstrateTextures: 0,
      asphaltSubstrateSrgbTextures: 0,
    });
    engine.dispose();
  }
});
