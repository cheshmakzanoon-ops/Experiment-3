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

/** First migration scene: actual circuit surface and physics poses. Proxy body
 * geometry is deliberately labelled in the UI; it is not asset/visual parity. */
export class BabylonCircuitScene {
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  readonly entrants: TransformNode[] = [];
  private target = new Vector3();
  private desired = new Vector3();
  constructor(engine: AbstractEngine, track: Track, count: number) {
    this.scene = new Scene(engine);
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
        point.y + 0.01,
        point.z - point.nz * half,
        point.x + point.nx * half,
        point.y + 0.01,
        point.z + point.nz * half,
      );
    }
    for (let i = 0; i < track.points.length - 1; i++) {
      const n = i * 2;
      indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
    }
    VertexData.ComputeNormals(positions, indices, normals);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = normals;
    const road = new Mesh('existing-physics-track', this.scene);
    data.applyToMesh(road);
    road.material = material;
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
  }
  render(frame: Float32Array) {
    applySimulationSnapshot(frame, this.entrants);
    const o = carBase(0),
      root = this.entrants[0];
    this.target.copyFrom(root.position);
    this.target.y += 0.7;
    const speed = Math.hypot(frame[o + F.VX], frame[o + F.VZ]);
    const heading = speed > 0.5 ? Math.atan2(frame[o + F.VX], frame[o + F.VZ]) : 0;
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
    this.scene.dispose();
  }
}
