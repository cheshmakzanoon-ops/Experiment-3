import { createFormulaSurfaceProbe, type FormulaSurfaceProbeContext } from './formula-surfaces.ts';
import { AUREL, VELLAMAR } from '../../simulation/circuits.ts';
import type { VehicleDefinition } from '../../simulation/vehicles.ts';
import { CircuitPaintFinishPlugin } from './circuit-paint-finish.ts';

import { Scene } from '@babylonjs/core/scene.js';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import { Vector3, Color3, Color4 } from '@babylonjs/core/Maths/math.js';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { applySimulationSnapshot } from './snapshot-bridge.ts';
import type { Track } from '../../simulation/track.ts';
import { F, carBase } from '../../simulation/protocol.ts';

export interface CircuitPresentationContext {
  presentation: string;
  vehicles: readonly Pick<VehicleDefinition, 'classId' | 'dynamicsKind'>[];
}
/** Eligibility is presentation/vehicle AND canonical content identity. Unknown
 * contexts keep the original coarse fallback; eligible failures never fall back. */
export function formulaSurfaceContext(
  track: Track,
  count: number,
  context?: CircuitPresentationContext,
): FormulaSurfaceProbeContext | undefined {
  if (
    context?.presentation !== 'circuit' ||
    count <= 0 ||
    !Array.isArray(context.vehicles) ||
    context.vehicles.length !== count ||
    !context.vehicles.every((v) => v?.classId === 'formula' && v.dynamicsKind === 'four-wheel') ||
    (track.circuit !== AUREL && track.circuit !== VELLAMAR)
  )
    return undefined;
  return {
    discipline: 'formula',
    presentation: 'circuit',
    circuitId: track.circuit === AUREL ? 'aurel' : 'vellamar',
  };
}

/** First migration scene: actual circuit surface and physics poses. Proxy body
 * geometry is deliberately labelled in the UI; it is not asset/visual parity. */
export class BabylonCircuitScene {
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  readonly entrants: TransformNode[] = [];
  private target = new Vector3();
  private desired = new Vector3();
  private heading = 0;
  private surfaces?: ReturnType<typeof createFormulaSurfaceProbe>;
  constructor(
    engine: AbstractEngine,
    track: Track,
    count: number,
    context?: CircuitPresentationContext,
  ) {
    this.scene = new Scene(engine);
    try {
      this.scene.useRightHandedSystem = true;
      this.scene.clearColor = new Color4(0.62, 0.75, 0.85, 1);
      const fill = new HemisphericLight('sky', new Vector3(0, 1, 0), this.scene);
      fill.intensity = 0.7;
      const sun = new DirectionalLight('sun', new Vector3(-0.3, -1, 0.4), this.scene);
      sun.intensity = 1.5;
      this.camera = new UniversalCamera('chase', new Vector3(0, 8, -15), this.scene);
      this.camera.minZ = 0.1;
      this.camera.maxZ = 12000;
      this.camera.fov = Math.PI / 3;
      const surfaceContext = formulaSurfaceContext(track, count, context);
      if (surfaceContext) {
        this.surfaces = createFormulaSurfaceProbe(this.scene, track, surfaceContext);
      } else {
        const material = new StandardMaterial('road', this.scene);
        material.diffuseColor = new Color3(0.16, 0.18, 0.2);
        material.specularColor = new Color3(0.05, 0.05, 0.05);
        material.backFaceCulling = false;
        const positions: number[] = [],
          indices: number[] = [],
          normals: number[] = [];
        for (const point of track.points) {
          // TrackPoint.width is the half-width, as in the production contact solver.
          const half = point.width;
          positions.push(
            point.x - point.nx * half,
            point.y - point.bank * Math.min(half, 12) + 0.01,
            point.z - point.nz * half,
            point.x + point.nx * half,
            point.y + point.bank * Math.min(half, 12) + 0.01,
            point.z + point.nz * half,
          );
        }
        for (let i = 0; i < track.points.length - 1; i++) {
          const n = i * 2;
          indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
        }
        VertexData.ComputeNormals(positions, indices, normals, { useRightHandedSystem: true });
        const data = new VertexData();
        data.positions = positions;
        data.indices = indices;
        data.normals = normals;
        const road = new Mesh('existing-physics-track', this.scene);
        data.applyToMesh(road);
        road.material = material;
      }
      for (let i = 0; i < count; i++) {
        const root = new TransformNode(`entrant-${i}`, this.scene);
        const body = CreateBox(
          `migration-proxy-${i}`,
          { width: 1.7, height: 0.65, depth: 4.5 },
          this.scene,
        );
        body.parent = root;
        body.position.y = 0.4;
        const paint = new StandardMaterial(`paint-${i}`, this.scene);
        paint.diffuseColor = i === 0 ? new Color3(0.95, 0.22, 0.11) : new Color3(0.2, 0.45, 0.8);
        body.material = paint;
        this.entrants.push(root);
      }
    } catch (error) {
      // Constructor failure otherwise leaves an unreachable engine-owned Scene.
      try {
        this.dispose();
      } catch {
        /* Preserve the construction error. */
      }
      throw error;
    }
  }
  get surfaceDiagnostics() {
    const live = this.scene.isDisposed
      ? []
      : this.scene.meshes.filter((m) => !m.isDisposed() && m.isEnabled());
    const road = live.filter((m) => m.metadata?.surface === 'road');
    const paint = live.filter((m) => m.metadata?.surface === 'edge-paint');
    const coarse = live.filter((m) => m.name === 'existing-physics-track');
    const substrate = this.surfaces?.asphaltSubstrate;
    const asphaltRoad =
      substrate?.isValid &&
      this.scene.materials.includes(substrate.material) &&
      substrate.material.pluginManager?.getPlugin('OriginalAsphaltSubstrate') === substrate.plugin
        ? road.filter(
            (mesh) =>
              mesh.material === substrate.material &&
              mesh.subMeshes.length > 0 &&
              mesh.subMeshes.every((submesh) => submesh.getMaterial() === substrate.material),
          )
        : [];
    const attached = new Set(asphaltRoad.flatMap((mesh) => mesh.material!.getActiveTextures()));
    const asphaltTextures =
      substrate && asphaltRoad.length
        ? Object.values(substrate.textures).filter(
            (texture) =>
              attached.has(texture) &&
              this.scene.textures.includes(texture) &&
              texture.getInternalTexture() !== null,
          )
        : [];
    return {
      kind: this.scene.isDisposed ? 'disposed' : this.surfaces ? 'formula-ribbon' : 'coarse',
      roadChunks: road.length,
      paintChunks: paint.length,
      leftPaintChunks: paint.filter((m) => m.metadata?.side === -1).length,
      rightPaintChunks: paint.filter((m) => m.metadata?.side === 1).length,
      coarseMeshes: coarse.length,
      vertices: [...road, ...paint, ...coarse].reduce((n, m) => n + m.getTotalVertices(), 0),
      paintFinishMaterials: new Set(
        paint
          .map((m) => m.material)
          .filter(
            (m) =>
              m?.pluginManager?.getPlugin('OriginalCircuitPaintFinish') instanceof
              CircuitPaintFinishPlugin,
          ),
      ).size,
      // Cached live ownership/binding metadata only: no new GPU query, render,
      // readiness shortcut, or copied target count. Publication waits for the
      // existing completed-presentation boundary in main.
      asphaltSubstrateRoadChunks: asphaltRoad.length,
      asphaltSubstrateMaterials: new Set(asphaltRoad.map((mesh) => mesh.material)).size,
      asphaltSubstrateTextures: new Set(asphaltTextures).size,
      asphaltSubstrateSrgbTextures: asphaltTextures.filter(
        (texture) => texture.getInternalTexture()?._useSRGBBuffer === true,
      ).length,
    };
  }
  render(frame: Float32Array) {
    applySimulationSnapshot(frame, this.entrants);
    const o = carBase(0),
      root = this.entrants[0];
    this.target.copyFrom(root.position);
    this.target.y += 0.7;
    const speed = Math.hypot(frame[o + F.VX], frame[o + F.VZ]);
    if (speed > 0.5) this.heading = Math.atan2(frame[o + F.VX], frame[o + F.VZ]);
    else {
      // The simulation's vehicle nose is local +Z, even in a right-handed
      // Babylon scene. Its horizontal projection defines a parked heading.
      const q = root.rotationQuaternion!;
      const forwardX = 2 * (q.x * q.z + q.w * q.y);
      const forwardZ = 1 - 2 * (q.x * q.x + q.y * q.y);
      if (Math.hypot(forwardX, forwardZ) > 1e-6) this.heading = Math.atan2(forwardX, forwardZ);
    }
    const heading = this.heading;
    this.desired.set(
      this.target.x - Math.sin(heading) * 12,
      this.target.y + 5,
      this.target.z - Math.cos(heading) * 12,
    );
    this.camera.position.copyFrom(this.desired);
    this.camera.setTarget(this.target);
    this.scene.render();
  }
  dispose() {
    let failure: unknown,
      failed = false;
    // Scene callbacks can be skipped; the view remains the authoritative owner.
    // Preserve Scene's first thrown value while still draining our resources.
    for (const cleanup of [() => this.scene.dispose(), () => this.surfaces?.dispose()]) {
      try {
        cleanup();
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
    if (failed) throw failure;
  }
}
