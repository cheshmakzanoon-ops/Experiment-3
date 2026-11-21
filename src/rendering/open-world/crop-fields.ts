import * as T from 'three';
import { FARM_FIELDS, tramlineCoverage, TRAMLINE, type FarmField } from '../../simulation/open-world/farm-fields.ts';
import { hash01 } from '../../simulation/open-world/noise.ts';
import type { QualityPreset } from '../options.ts';

type Ground = (x: number, z: number) => number | null;
export const CROP_RANGE = Object.freeze({ low: 32, medium: 54, high: 74, ultra: 86 });
const CHUNK = 22;
interface FieldChunk {
  field: FarmField;
  i: number;
  j: number;
  cx: number;
  cz: number;
  mesh: T.InstancedMesh | null;
}

/** One short group of cereal culms. The ears taper at both ends, and flag
 * leaves break the otherwise vertical silhouette. Harvested ground keeps
 * only broken straw. No transparent texture or per-stalk draw. */
export function cropGeometry(harvested: boolean) {
  const pos: number[] = [], rgb: number[] = [];
  const vertex = (x: number, y: number, z: number, k: number) => {
    pos.push(x, y, z); rgb.push(k * 0.91, k * 0.93, k * 0.72);
  };
  for (let i = 0; i < 7; i++) {
    const h = hash01(i, 7, 0x7302), angle = h * 6.283;
    const x = -0.45 + i * 0.15, z = (i % 2 - 0.5) * 0.24 + (h - 0.5) * 0.07;
    const top = harvested ? 0.12 + 0.11 * h : 0.47 + h * 0.22;
    const bx = x + Math.cos(angle) * 0.065, bz = z + Math.sin(angle) * 0.036;
    const rx = (0.008 + h * 0.004) * Math.cos(angle), rz = 0.010 * Math.sin(angle);
    vertex(x - rx, 0, z - rz, 0.51); vertex(x + rx, 0, z + rz, 0.56); vertex(bx, top, bz, 0.91);
    if (harvested) continue;
    const mid = top * 0.65;
    vertex(x, mid * 0.6, z, 0.65); vertex(bx + 0.021, mid, bz + 0.014, 0.81);
    vertex(bx + Math.cos(angle) * 0.15, mid + 0.038, bz - Math.sin(angle) * 0.10, 0.98);
    // Two angled glumes give the sun a distinct facet from either side.
    vertex(bx, top - 0.07, bz, 0.82); vertex(bx + 0.019, top + 0.012, bz, 1);
    vertex(bx + 0.035, top + 0.108, bz - 0.011, 1.12);
    vertex(bx + 0.035, top + 0.108, bz - 0.011, 1.12);
    vertex(bx - 0.009, top + 0.016, bz + 0.017, 0.90); vertex(bx, top - 0.07, bz, 0.82);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(rgb, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export class CropFields {
  readonly root = new T.Group();
  readonly standing = cropGeometry(false);
  readonly stubble = cropGeometry(true);
  readonly material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.91, side: T.DoubleSide });
  private readonly chunks: FieldChunk[] = [];
  private readonly wind = { value: 0 };
  private readonly range = { value: 0 };
  private readonly vehicle = { value: new T.Vector3(0, -1000, 0) };
  private readonly frustum = new T.Frustum();
  private readonly vp = new T.Matrix4();
  private readonly sphere = new T.Sphere(new T.Vector3(), CHUNK * 0.78 + 2);
  private readonly transform = new T.Object3D();
  private readonly paint = new T.Color();
  constructor(private readonly ground: Ground, fields: readonly FarmField[] = FARM_FIELDS) {
    this.root.name = 'Saltmarsh and Plateau crop rows';
    for (const field of fields) {
      for (let i = 0; i * CHUNK < 2 * field.length; i++) {
        const u = Math.min(field.length, (i + 0.5) * CHUNK - field.length);
        for (let j = 0; j * CHUNK < 2 * field.width; j++) {
          const v = Math.min(field.width, (j + 0.5) * CHUNK - field.width);
          this.chunks.push({ field, i, j, cx: field.x + u * field.dx - v * field.dz,
            cz: field.z + u * field.dz + v * field.dx, mesh: null });
        }
      }
    }
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.fieldTime = this.wind;
      shader.uniforms.fieldRange = this.range;
      shader.uniforms.fieldVehicle = this.vehicle;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float fieldTime;\nuniform float fieldRange;\nuniform vec3 fieldVehicle;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 base = instanceMatrix[3].xyz;
float fade = 1.0 - smoothstep(fieldRange * 0.76, fieldRange, distance(base, cameraPosition));
float gust = sin(dot(base.xz, vec2(0.34, 0.19)) + fieldTime * 2.3) + 0.42 * sin(base.x * 0.11 - fieldTime * 1.4);
vec2 away = base.xz - fieldVehicle.xz;
float crush = (1.0 - smoothstep(0.78, 2.4, length(away))) * (1.0 - smoothstep(0.8, 2.0, abs(base.y - fieldVehicle.y)));
transformed.x += position.y * position.y * (gust * 0.085 + 0.65 * crush);
transformed.y *= fade * (1.0 - 0.8 * crush);
`);
    };
    this.material.customProgramCacheKey = () => 'solvane-cereal-v1';
  }

  private build(c: FieldChunk) {
    const f = c.field, u0 = -f.length + CHUNK * c.i, v0 = -f.width + CHUNK * c.j;
    const u1 = Math.min(f.length, u0 + CHUNK), v1 = Math.min(f.width, v0 + CHUNK);
    const stride = f.spacing * 4;
    const points: number[] = [];
    const seed = Math.round(f.x + f.z);
    for (let row = Math.ceil(v0 / stride); row * stride < v1; row++) {
      const across = row * stride;
      for (let stem = Math.ceil(u0 / 1.06); stem * 1.06 < u1; stem++) {
        const jitter = hash01(row, stem, seed), along = stem * 1.06 + (jitter - 0.5) * 0.09;
        const border = Math.min(f.length - Math.abs(along), f.width - Math.abs(across));
        if (border < TRAMLINE.headland + 0.6 || tramlineCoverage(along, across, f) > 0.10) continue;
        const x = f.x + along * f.dx - across * f.dz, z = f.z + along * f.dz + across * f.dx;
        const y = this.ground(x, z);
        // Never leave a partially planted chunk after a cold tile request.
        if (y === null) return null;
        points.push(x, y - 0.018, z, jitter);
      }
    }
    const mesh = new T.InstancedMesh(f.crop === 'stubble' ? this.stubble : this.standing, this.material, points.length / 4);
    mesh.name = `Solvane ${f.crop} row section`;
    mesh.receiveShadow = true;
    this.transform.rotation.y = -Math.atan2(f.dz, f.dx);
    for (let i = 0; i < mesh.count; i++) {
      const k = i * 4, shade = points[k + 3];
      this.transform.position.set(points[k], points[k + 1], points[k + 2]);
      this.transform.scale.set(1, 0.76 + 0.34 * shade, 1);
      this.transform.updateMatrix();
      mesh.setMatrixAt(i, this.transform.matrix);
      this.paint.setHex(f.crop === 'barley' ? 0xb0ac64 : f.crop === 'wheat' ? 0xd7b675 : 0xbeaa83);
      mesh.setColorAt(i, this.paint.multiplyScalar(0.82 + 0.25 * shade));
    }
    mesh.computeBoundingSphere();
    mesh.boundingSphere!.radius += 0.54;
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
    return mesh;
  }

  update(camera: T.Camera, preset: QualityPreset, time: number, vehicle: T.Vector3 | null) {
    const range = CROP_RANGE[preset];
    this.range.value = range;
    this.wind.value = time;
    if (vehicle) this.vehicle.value.copy(vehicle);
    else this.vehicle.value.set(0, -1000, 0);
    this.frustum.setFromProjectionMatrix(this.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    let builds = 0;
    for (const c of this.chunks) {
      const dx = camera.position.x - c.cx, dz = camera.position.z - c.cz, squared = dx * dx + dz * dz;
      if (squared > (range + this.sphere.radius) ** 2) {
        if (c.mesh) {
          c.mesh.visible = false;
          if (squared > (range + 82) ** 2) {
            c.mesh.removeFromParent(); c.mesh.dispose(); c.mesh = null;
          }
        }
        continue;
      }
      const y = this.ground(c.cx, c.cz);
      if (y === null) { if (c.mesh) c.mesh.visible = false; continue; }
      this.sphere.center.set(c.cx, y + 0.3, c.cz);
      const visible = this.frustum.intersectsSphere(this.sphere);
      if (visible && !c.mesh && builds < 2) {
        c.mesh = this.build(c);
        builds++;
      }
      if (c.mesh) c.mesh.visible = visible;
    }
  }

  dispose() {
    for (const c of this.chunks) c.mesh?.dispose();
    this.chunks.length = 0;
    this.root.clear();
    this.root.removeFromParent();
    this.standing.dispose();
    this.stubble.dispose();
    this.material.dispose();
  }
}
