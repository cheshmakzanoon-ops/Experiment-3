import * as T from 'three';
import { trackPoint, type Track } from '../simulation/track.ts';
import { clamp } from '../core/math.ts';
import { grassApronOffset } from './ground-profile.ts';
import { inStandFootprint } from './grandstand.ts';
import { tracksideRigs } from './trackside.ts';


export interface VenueLampSite { s: number; side: number; x: number; z: number; baseY: number; topY: number }

/** Keep floodlight columns out of the racing/pit corridor and the authored
 * broadcast sightlines. Position choices are deterministic, not camera-dependent
 * teleportation; feet use the same ground query as nearby infrastructure. */
export function venueLampPlan(track: Track): readonly VenueLampSite[] {
  const count = Math.ceil(track.length / 90), rigs = tracksideRigs(track), sites: VenueLampSite[] = [];
  const point = trackPoint(), target = trackPoint();
  for (let i = 0; i < count; i++) {
    let best: VenueLampSite | null = null, bestScore = -Infinity;
    for (const [shift, flip] of [0, 12, -12, 24, -24].flatMap((shift) => [[shift, 1], [shift, -1]])) {
      const side = (i % 2 ? -1 : 1) * flip;
      const s = ((i / count * track.length + shift) % track.length + track.length) % track.length;
      track.at(s, point);
      const offset = side * (track.boundary(s, side) + 7);
      const x = point.x + point.nx * offset, z = point.z + point.nz * offset;
      if (inStandFootprint(track, x, z, 1.5)) continue;
      let clearance = Infinity;
      for (const rig of rigs) for (const look of [-0.26, 0, 0.26]) {
        track.at(rig.centerS + rig.coverageM * look, target);
        const dx = target.x - rig.position.x, dz = target.z - rig.position.z;
        const t = clamp(((x - rig.position.x) * dx + (z - rig.position.z) * dz) / (dx * dx + dz * dz), 0, 1);
        clearance = Math.min(clearance, Math.hypot(x - rig.position.x - t * dx, z - rig.position.z - t * dz));
      }
      const baseY = point.y + point.bank * clamp(offset, -12, 12) + grassApronOffset(track, s, offset);
      const score = clearance - Math.abs(shift) * 0.001 - (flip < 0 ? 0.001 : 0);
      if (score > bestScore) {
        best = { s, side, x, z, baseY, topY: point.y + 14 }; bestScore = score;
      }
      if (clearance >= 2) break;
    }
    if (!best || bestScore < 1) throw new Error(`No clear floodlight site ${i}`);
    sites.push(best);
  }
  return sites;
}

/** Original circuit illumination. Four fixed-count nearby light sources bound
 * fragment-light cost; visible mast heads remain instanced along the circuit.
 * This is an art-directed night view, not a time-of-day/weather simulation. */
export class VenueLighting {
  readonly root = new T.Group();
  readonly lamps: T.InstancedMesh;
  readonly sites: readonly VenueLampSite[];
  readonly lights: T.PointLight[];
  readonly nightBackground = new T.Color(0x030711);
  private locations: T.Vector3[] = [];
  private nearest = new Int32Array(4).fill(-1);
  private distances = new Float64Array(4);
  private display: T.Mesh;
  private lampMaterial = new T.MeshBasicMaterial({ color: 0x62666b, toneMapped: false });
  constructor(track: Track) {
    this.root.name = 'Original floodlit circuit and LED sphere · references 039 079 080 087';
    this.sites = venueLampPlan(track);
    const count = this.sites.length;
    const poles = new T.InstancedMesh(
      new T.CylinderGeometry(0.12, 0.21, 1, 8),
      new T.MeshStandardMaterial({ color: 0x8d959e, metalness: 0.72, roughness: 0.4 }),
      count,
    );
    this.lamps = new T.InstancedMesh(new T.BoxGeometry(3.2, 0.2, 1.3), this.lampMaterial, count);
    const p = trackPoint(),
      transform = new T.Object3D();
    for (const [i, site] of this.sites.entries()) {
      track.at(site.s, p);
      const height = site.topY - site.baseY;
      transform.position.set(site.x, site.baseY + height * 0.5, site.z);
      transform.rotation.set(0, Math.atan2(p.tx, p.tz), 0);
      transform.scale.set(1, height, 1); transform.updateMatrix();
      poles.setMatrixAt(i, transform.matrix);
      transform.position.y = site.topY; transform.scale.set(1, 1, 1); transform.updateMatrix();
      this.lamps.setMatrixAt(i, transform.matrix);
      this.locations.push(new T.Vector3(site.x, site.topY - 2, site.z));
    }
    poles.castShadow = false;
    poles.receiveShadow = true;
    poles.computeBoundingSphere();
    this.lamps.computeBoundingSphere();
    this.lights = Array.from({ length: 4 }, () => new T.PointLight(0xd9e8ff, 0, 135, 2));
    this.root.add(poles, this.lamps, ...this.lights);
    track.at(track.length * 0.13, p);
    this.display = new T.Mesh(
      new T.SphereGeometry(21, 48, 24),
      new T.MeshBasicMaterial({ color: 0x428da5 }),
    );
    this.display.name = 'Original LED venue landmark (not a recreation of a licensed building)';
    this.display.position.set(p.x + p.nx * 72, p.y + 28, p.z + p.nz * 72);
    const material = this.display.material as T.MeshBasicMaterial;
    material.onBeforeCompile = (shader) => {
      shader.vertexShader =
        'varying vec3 vLedPosition;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvLedPosition = position;',
        );
      shader.fragmentShader =
        'varying vec3 vLedPosition;\n' +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
        float bands = smoothstep(.28,.32,fract(vLedPosition.y*.115+vLedPosition.x*.035));
        float dots = .78+.22*step(.25,fract(vLedPosition.y*3.0));
        diffuseColor.rgb *= mix(vec3(.2,.65,1.),vec3(1.,.35,.13),bands)*dots;
      `,
        );
    };
    material.customProgramCacheKey = () => 'apex-original-led-bands-v1';
    this.root.add(this.display);
  }
  update(night: boolean, anchor: T.Vector3) {
    this.lampMaterial.color.setHex(night ? 0xebf5ff : 0x62666b);
    this.distances.fill(Infinity);
    this.nearest.fill(-1);
    this.locations.forEach((position, index) => {
      const distance = position.distanceToSquared(anchor);
      for (let rank = 0; rank < 4; rank++)
        if (distance < this.distances[rank]) {
          for (let r = 3; r > rank; r--) {
            this.distances[r] = this.distances[r - 1];
            this.nearest[r] = this.nearest[r - 1];
          }
          this.distances[rank] = distance;
          this.nearest[rank] = index;
          break;
        }
    });
    this.lights.forEach((light, index) => {
      const position = this.locations[this.nearest[index]];
      if (position) light.position.copy(position);
      light.intensity = night && position ? 450 : 0;
      light.visible = night && !!position;
    });
    (this.display.material as T.MeshBasicMaterial).color.setScalar(night ? 2.2 : 0.6);
  }
  diagnostics() {
    return {
      masts: this.locations.length,
      nearbyLights: this.lights.filter((light) => light.intensity > 0).length,
    };
  }
}
