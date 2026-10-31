import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import {
  circuitRibbonData,
  type CircuitRibbonFields,
  type CircuitRibbonOptions,
} from '../assets/circuit-ribbon-data.ts';
import { apexLineAt } from '../assets/circuit-line-profile.ts';
import { indexedRibbonNormals } from '../assets/indexed-ribbon-normals.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { AUREL, VELLAMAR } from '../../simulation/circuits.ts';
import { CircuitPaintFinishPlugin, circuitPaintLinearChannel } from './circuit-paint-finish.ts';

export interface FormulaSurfaceProbeContext {
  discipline: 'formula';
  presentation: 'circuit';
  circuitId: 'aurel' | 'vellamar';
}
/** Source-equivalent Formula surface boundary (asphalt remains diagnostic). Call only
 * under exclusive idle GPU preparation ownership. No borrowed GPU resources.
 * Asphalt remains explicitly diagnostic; grounding/light pools are unported. */
export function createFormulaSurfaceProbe(
  scene: Scene,
  track: Track,
  context: FormulaSurfaceProbeContext,
  range?: { start: number; end: number },
) {
  if (scene.isDisposed || !scene.useRightHandedSystem)
    throw new Error('Surface probe needs a live right-handed scene');
  if (
    context?.discipline !== 'formula' ||
    context.presentation !== 'circuit' ||
    !['aurel', 'vellamar'].includes(context.circuitId) ||
    track.circuit.id !== context.circuitId ||
    track.circuit !== (context.circuitId === 'aurel' ? AUREL : VELLAMAR)
  )
    throw new Error('Surface probe supports only named original Formula paved contexts');
  const start = range?.start ?? 0,
    end = range?.end ?? track.length;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > track.length ||
    start < -track.length ||
    end > track.length * 2
  )
    throw new Error('Invalid surface probe range');
  const meshes: Mesh[] = [],
    roadMeshes: Mesh[] = [],
    paintMeshes: Mesh[] = [];
  const materials: PBRMaterial[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    // Scene owns resources after scene disposal; do not invoke them twice.
    if (scene.isDisposed) return;
    let failure: unknown;
    for (const resource of [...meshes, ...materials]) {
      try {
        resource.dispose(false, false);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) throw failure;
  };
  try {
    const roadMaterial = new PBRMaterial(
      'Diagnostic asphalt — original shader layers unported',
      scene,
    );
    materials.push(roadMaterial);
    roadMaterial.albedoColor = new Color3(0.16, 0.18, 0.2);
    roadMaterial.roughness = 1;
    roadMaterial.metallic = 0;
    const paintMaterial = new PBRMaterial(
      'Original edge paint construction finish — grounding/light pools unported',
      scene,
    );
    materials.push(paintMaterial);
    paintMaterial.albedoColor = new Color3(
      ...([0xe9, 0xe7, 0xe0].map((c) => circuitPaintLinearChannel(c / 255)) as [
        number,
        number,
        number,
      ]),
    );
    paintMaterial.roughness = 0.55;
    paintMaterial.metallic = 0;
    new CircuitPaintFinishPlugin(paintMaterial);
    for (const m of materials) {
      m.sideOrientation = Material.CounterClockWiseSideOrientation;
      m.backFaceCulling = true;
    }
    const unused = () => {
      throw new Error('Unsupported Formula surface field requested');
    };
    const color = (hex: number) => ({
      r: circuitPaintLinearChannel(((hex >> 16) & 255) / 255),
      g: circuitPaintLinearChannel(((hex >> 8) & 255) / 255),
      b: circuitPaintLinearChannel((hex & 255) / 255),
    });
    const fields: CircuitRibbonFields = {
      hasGpDesign: () => false,
      apex: (s, l, out, motorcycle) => apexLineAt(track, s, l, out, motorcycle),
      color: (s) => color(Math.floor(s / 3) % 2 === 0 ? 0xdc553b : 0xe8e3cf),
      kerbStyle: unused,
      runoffStyle: unused,
      usage: unused,
      gpPaint: unused,
      gpGravel: unused,
    };
    const add = (
      options: CircuitRibbonOptions,
      material: PBRMaterial,
      list: Mesh[],
      side: -1 | 0 | 1,
    ) => {
      const begin = options.start ?? start,
        finish = options.end ?? end;
      const pieces = Math.ceil((finish - begin) / 80);
      for (let part = 0; part < pieces; part++) {
        const chunk = {
          ...options,
          start: begin + ((finish - begin) * part) / pieces,
          end: begin + ((finish - begin) * (part + 1)) / pieces,
        };
        // Preserve CircuitScene.ribbon's second split if rounding a queued
        // boundary leaves a chunk microscopically longer than 80 metres.
        if (chunk.end - chunk.start > 80) {
          add(chunk, material, list, side);
          continue;
        }
        const data = circuitRibbonData(track, chunk, fields);
        const positions = new Float32Array(data.vertices);
        const indices = data.indices.some((i) => i >= 65535)
          ? new Uint32Array(data.indices)
          : new Uint16Array(data.indices);
        const vertexData = new VertexData();
        vertexData.positions = positions;
        vertexData.indices = indices;
        vertexData.normals = indexedRibbonNormals(positions, indices);
        vertexData.uvs = new Float32Array(data.uv);
        const mesh = new Mesh(
          `${options.road ? 'original-road' : 'original-edge-paint'}-${list.length}`,
          scene,
        );
        meshes.push(mesh);
        list.push(mesh);
        vertexData.applyToMesh(mesh, false);
        mesh.setVerticesData('trackUV', new Float32Array(data.state), false, 2);
        mesh.setVerticesData('edgeMetres', new Float32Array(data.edge), false, 1);
        if (options.road) {
          mesh.setVerticesData('apexLine', new Float32Array(data.apex), false, 2);
          mesh.setVerticesData('apexBikeBrake', new Float32Array(data.bikeBrake), false, 1);
        }
        mesh.material = material;
        mesh.receiveShadows = true;
        let width = 0;
        const centreline: number[][] = [];
        for (let i = 0; i <= data.rows; i++) {
          const a = i * (data.cols + 1) * 3,
            b = a + data.cols * 3;
          width = Math.max(
            width,
            Math.hypot(
              data.vertices[b] - data.vertices[a],
              data.vertices[b + 2] - data.vertices[a + 2],
            ),
          );
          if (
            i % Math.max(1, Math.round(4 / ((data.end - data.start) / data.rows))) === 0 ||
            i === data.rows
          )
            centreline.push([
              (data.vertices[a] + data.vertices[b]) / 2,
              (data.vertices[a + 1] + data.vertices[b + 1]) / 2,
              (data.vertices[a + 2] + data.vertices[b + 2]) / 2,
            ]);
        }
        mesh.metadata = {
          surface: options.road ? 'road' : 'edge-paint',
          side,
          start: data.start,
          end: data.end,
          ...(width <= 1.5 ? { strip: { width, centreline } } : {}),
        };
      }
    };
    const point = trackPoint();
    add(
      {
        offset: (s, t) => (t * 2 - 1) * track.at(s, point).width,
        columns: 14,
        road: true,
        step: 1.8,
      },
      roadMaterial,
      roadMeshes,
      0,
    );
    for (const side of [-1, 1] as const)
      add(
        {
          offset: (s, t) => side * (track.at(s, point).width - 0.17 + t * 0.14),
          height: () => 0.006,
          step: 2,
        },
        paintMaterial,
        paintMeshes,
        side,
      );
    return { meshes, roadMeshes, paintMeshes, roadMaterial, paintMaterial, dispose };
  } catch (error) {
    try {
      dispose();
    } catch {
      /* Preserve the original construction failure. */
    }
    throw error;
  }
}
