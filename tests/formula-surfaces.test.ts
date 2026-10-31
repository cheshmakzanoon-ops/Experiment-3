import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Scene } from '@babylonjs/core/scene.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import { PBRMaterialDefines } from '@babylonjs/core/Materials/PBR/pbrBaseMaterial.js';
import {
  MaterialPluginEvent,
  type MaterialPluginGetDefineNames,
} from '@babylonjs/core/Materials/materialPluginEvent.js';
import * as T from 'three';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { AUREL, VELLAMAR } from '../src/simulation/circuits.ts';
import {
  createFormulaSurfaceProbe,
  type FormulaSurfaceProbeContext,
} from '../src/engine/babylon/formula-surfaces.ts';
import {
  CircuitPaintFinishPlugin,
  CIRCUIT_PAINT_NOISE,
} from '../src/engine/babylon/circuit-paint-finish.ts';
import { renderRibbonCase } from './fixtures/circuit-ribbon-cases.ts';
const bytes = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const context = { discipline: 'formula', presentation: 'circuit', circuitId: 'aurel' } as const;
function setup() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  return { engine, scene };
}
for (const circuit of [AUREL, VELLAMAR])
  describe(circuit.id, () => {
    it('matches original road and both edge ribbons: all attributes, chunks, strip metadata, original datum', () => {
      const { scene, engine } = setup();
      const track = new Track('clear', false, undefined, circuit);
      const original = JSON.stringify(track.points);
      const start = track.length - 80,
        end = track.length + 80;
      const built = createFormulaSurfaceProbe(
        scene,
        track,
        { ...context, circuitId: circuit.id as 'aurel' | 'vellamar' },
        { start, end },
      );
      try {
        const p = trackPoint();
        const options = [
          {
            start,
            end,
            offset: (s: number, t: number) => (t * 2 - 1) * track.at(s, p).width,
            columns: 14,
            road: true,
            step: 1.8,
          },
          ...[-1, 1].map((side) => ({
            start,
            end,
            offset: (s: number, t: number) => side * (track.at(s, p).width - 0.17 + t * 0.14),
            height: () => 0.006,
            step: 2,
          })),
        ];
        const actual = [
          built.roadMeshes,
          built.paintMeshes.slice(0, 2),
          built.paintMeshes.slice(2),
        ];
        for (let k = 0; k < options.length; k++) {
          const legacy = renderRibbonCase({ name: 'surface', track, options: options[k] });
          try {
            expect(actual[k]).toHaveLength(legacy.meshes.length);
            legacy.meshes.forEach((m, i) => {
              const b = actual[k][i];
              expect(b.getVerticesDataKinds().sort()).toEqual(
                Object.keys(m.geometry.attributes).sort(),
              );
              for (const [name, attribute] of Object.entries(m.geometry.attributes)) {
                const data = b.getVerticesData(name)!;
                expect(bytes(new Float32Array(data)).equals(bytes(attribute.array)), name).toBe(
                  true,
                );
              }
              expect(Array.from(b.getIndices()!)).toEqual(Array.from(m.geometry.index!.array));
              expect(b.material).toBe(k === 0 ? built.roadMaterial : built.paintMaterial);
              expect(b.metadata.side).toBe(k === 0 ? 0 : k === 1 ? -1 : 1);
              expect(b.metadata.strip ?? null).toEqual(
                m.userData.strip
                  ? {
                      width: m.userData.strip.width,
                      centreline: m.userData.strip.centreline.map((v: T.Vector3) => v.toArray()),
                    }
                  : null,
              );
            });
          } finally {
            legacy.meshes.forEach((m) => m.geometry.dispose());
            legacy.material.dispose();
          }
        }
        expect(JSON.stringify(track.points)).toBe(original);
        const c = new T.Color(0xe9e7e0);
        expect(built.paintMaterial.albedoColor.asArray()).toEqual([c.r, c.g, c.b]);
        expect(built.paintMaterial.roughness).toBe(0.55);
        expect(built.paintMaterial.metallic).toBe(0);
        expect(scene.textures).toEqual([scene.environmentBRDFTexture]);
        expect(built.paintMaterial.albedoTexture).toBeNull();
        expect(built.paintMaterial.bumpTexture).toBeNull();
      } finally {
        built.dispose();
        scene.dispose();
        engine.dispose();
      }
    });
  });
it('rejects GP/MX/open-world/unknown/non-Formula before resources are created', () => {
  const { scene, engine } = setup(),
    track = new Track('clear');
  try {
    for (const patch of [
      { discipline: 'gp' },
      { discipline: 'mx' },
      { discipline: 'touring' },
      { presentation: 'open-world' },
      { circuitId: 'unknown' },
      { circuitId: 'vellamar' },
    ])
      expect(() =>
        createFormulaSurfaceProbe(scene, track, {
          ...context,
          ...patch,
        } as FormulaSurfaceProbeContext),
      ).toThrow();
    expect(() =>
      createFormulaSurfaceProbe(scene, track, context, { start: 1e20, end: 1e20 + 16384 }),
    ).toThrow();
    const fake = new Track('clear', false, undefined, { ...AUREL });
    expect(() => createFormulaSurfaceProbe(scene, fake, context)).toThrow();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.materials).toHaveLength(0);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
it('owns and disposes only its meshes/materials once, including scene-first teardown', () => {
  for (const sceneFirst of [false, true]) {
    const { scene, engine } = setup();
    const borrowed = new PBRMaterial('unrelated', scene);
    const built = createFormulaSurfaceProbe(scene, new Track('clear'), context, {
      start: 0,
      end: 160,
    });
    const spies = [...built.meshes, built.roadMaterial, built.paintMaterial].map((x) =>
      vi.spyOn(x, 'dispose'),
    );
    if (sceneFirst) scene.dispose();
    built.dispose();
    built.dispose();
    spies.forEach((s) => expect(s).toHaveBeenCalledTimes(1));
    if (!sceneFirst) expect(scene.materials).toContain(borrowed);
    scene.dispose();
    engine.dispose();
  }
});
it('retains exact original noise and paint expressions without claiming other layers', () => {
  const source = readFileSync('src/rendering/circuit-finish.ts', 'utf8');
  expect(source).toContain(CIRCUIT_PAINT_NOISE.trim());
  const { scene, engine } = setup();
  try {
    const material = new PBRMaterial('paint', scene),
      plugin = new CircuitPaintFinishPlugin(material);
    const code = plugin
      .getCustomCode('fragment')!
      .CUSTOM_FRAGMENT_UPDATE_ALBEDO.replaceAll('vPositionW', 'vFinishWorld')
      .replaceAll('surfaceAlbedo', 'diffuseColor');
    for (const line of code.trim().split('\n')) expect(source).toContain(line.trim());
    expect(plugin.getCustomCode('vertex')).toBeNull();
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
it('keeps a persistent paint shader key when composed with a later plugin', () => {
  class Output extends MaterialPluginBase {
    constructor(m: PBRMaterial) {
      super(m, 'output', 300, {}, true, true);
    }
    getClassName() {
      return 'Output';
    }
  }
  const { scene, engine } = setup();
  try {
    const paint = new PBRMaterial('paint', scene),
      control = new PBRMaterial('control', scene);
    new CircuitPaintFinishPlugin(paint);
    new Output(paint);
    new Output(control);
    const key = (material: PBRMaterial) => {
      const info: MaterialPluginGetDefineNames = { defineNames: {} };
      material._callbackPluginEventGeneric(MaterialPluginEvent.GetDefineNames, info);
      return new PBRMaterialDefines(info.defineNames).toString();
    };
    const paintedKey = key(paint),
      controlKey = key(control);
    expect(paintedKey).toContain('#define ORIGINAL_CIRCUIT_PAINT_FINISH_V1');
    expect(controlKey).not.toContain('ORIGINAL_CIRCUIT_PAINT_FINISH_V1');
    expect(paintedKey).not.toBe(controlKey);
    const reversed = new PBRMaterial('output-then-paint', scene);
    new Output(reversed);
    new CircuitPaintFinishPlugin(reversed);
    expect(key(reversed)).toContain('#define ORIGINAL_CIRCUIT_PAINT_FINISH_V1');
    expect(key(reversed)).not.toBe(controlKey);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

it('cleans partial construction and retains explicit validated live integration', () => {
  const { scene, engine } = setup();
  const error = new Error('injected buffer upload failure');
  const upload = vi.spyOn(Mesh.prototype, 'setVerticesData').mockImplementationOnce(() => {
    throw error;
  });
  try {
    expect(() =>
      createFormulaSurfaceProbe(scene, new Track('clear'), context, { start: 0, end: 80 }),
    ).toThrow(error);
    expect(scene.meshes).toHaveLength(0);
    expect(scene.materials).toHaveLength(0);
    expect(scene.textures).toEqual([scene.environmentBRDFTexture]);
    const owner = readFileSync('src/engine/babylon/circuit-scene.ts', 'utf8');
    expect(owner).toContain('formulaSurfaceContext(track, count, context)');
    expect(owner).toContain('if (surfaceContext)');
  } finally {
    upload.mockRestore();
    scene.dispose();
    engine.dispose();
  }
});
