import * as T from 'three';
import { smooth } from '../core/math.ts';

/** Light shafts under the venue floodlights: in a fog bank, a dust storm or a
 * snowfall at night the lamp's beam is visible as it scatters off the
 * particulate. One instanced, open cone per mast (the masts of
 * venue-lighting.ts), additive, no depth write, a function of the presented
 * snapshot's extinction only: none in clear air, none by day.
 *
 * The beam is a cone aimed from the lamp head at a point `aimM` metres toward
 * the circuit and on the ground; a surface seen face-on crosses the most
 * scattering volume (`facing`), a silhouette edge the least, and the cone
 * fades out toward the ground and at the lamp head so no hard end shows. */
export const SHAFTS = Object.freeze({
  /** Radius of the beam on the ground (m). */
  radius: 11,
  /** Horizontal distance (m) from the mast toward the circuit that the beam is aimed at. */
  aimM: 9,
  /** Ceiling of the additive density, so a shaft never blooms a block. */
  ceiling: 0.34,
  /** Extinction (per km) where the beams start to show, and where they are full. */
  onsetPerKm: 1.2,
  fullPerKm: 10,
  /** Lamp colour (linear, slightly cool white) and the dust and snow variants. */
  colour: Object.freeze([0.86, 0.93, 1.0] as const),
  dustColour: Object.freeze([1.0, 0.72, 0.42] as const),
  snowColour: Object.freeze([0.8, 0.9, 1.0] as const),
});

export interface ShaftAir {
  extinctionPerKm: number;
  /** 0 droplets .. 1 mineral dust. */
  dust: number;
  /** Falling snow 0..1. */
  snow: number;
}
/** Density 0..SHAFTS.ceiling of the beams for the air, at lamp strength 0..1. */
export function shaftDensity(air: ShaftAir, strength: number) {
  const ext = Number.isFinite(air.extinctionPerKm) ? Math.max(0, air.extinctionPerKm) : 0;
  const s = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0;
  return SHAFTS.ceiling * smooth(SHAFTS.onsetPerKm, SHAFTS.fullPerKm, ext) * s;
}

const VERTEX = `
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying float vAxial;
  void main() {
    vec4 world = instanceMatrix * vec4(position, 1.0);
    vec4 mv = modelViewMatrix * world;
    vNormalView = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    vViewDir = -mv.xyz;
    // 0 at the lamp head (apex, y = +0.5) .. 1 at the ground end.
    vAxial = 0.5 - position.y;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAGMENT = `
  uniform float density;
  uniform vec3 tint;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying float vAxial;
  void main() {
    float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float edge = pow(facing, 1.6);
    float axial = smoothstep(0.0, 0.12, vAxial) * (1.0 - smoothstep(0.5, 1.0, vAxial));
    float a = density * edge * axial;
    if (a < 0.002) discard;
    gl_FragColor = vec4(tint, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class FogLightShafts {
  readonly mesh: T.InstancedMesh<T.ConeGeometry, T.ShaderMaterial>;
  constructor(
    sites: readonly {
      x: number;
      z: number;
      baseY: number;
      topY: number;
      /** Unit horizontal direction from the mast toward the circuit centre. */
      inward?: readonly [number, number];
    }[],
  ) {
    const geometry = new T.ConeGeometry(1, 1, 18, 1, true);
    const material = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      side: T.DoubleSide,
      uniforms: {
        density: { value: 0 },
        tint: { value: new T.Vector3(...SHAFTS.colour) },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });
    this.mesh = new T.InstancedMesh(geometry, material, Math.max(1, sites.length));
    this.mesh.count = sites.length;
    this.mesh.name = 'Floodlight shafts in fog, dust and snow';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    const apex = new T.Vector3(),
      ground = new T.Vector3(),
      axis = new T.Vector3(),
      down = new T.Vector3(0, -1, 0),
      mid = new T.Vector3(),
      q = new T.Quaternion(),
      m = new T.Matrix4(),
      scale = new T.Vector3();
    sites.forEach((site, i) => {
      const [ix, iz] = site.inward ?? [0, 0];
      apex.set(site.x, site.topY - 0.2, site.z);
      ground.set(site.x + ix * SHAFTS.aimM, site.baseY, site.z + iz * SHAFTS.aimM);
      axis.copy(ground).sub(apex);
      const length = axis.length();
      axis.normalize();
      // ConeGeometry's apex is +Y, its base -Y: aim the base (-Y) along the beam.
      q.setFromUnitVectors(down, axis);
      mid.copy(apex).add(ground).multiplyScalar(0.5);
      scale.set(SHAFTS.radius, length, SHAFTS.radius);
      m.compose(mid, q, scale);
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  /** Set the beams for the present air; they exist only at night (lamp strength > 0). */
  update(air: ShaftAir, strength: number) {
    const density = shaftDensity(air, strength);
    const u = this.mesh.material.uniforms;
    u.density.value = density;
    const dust = Math.min(1, Math.max(0, air.dust)),
      snow = Math.min(1, Math.max(0, air.snow));
    const [r, g, b] = SHAFTS.colour,
      [dr, dg, db] = SHAFTS.dustColour,
      [sr, sg, sb] = SHAFTS.snowColour;
    (u.tint.value as T.Vector3).set(
      r + (dr - r) * dust + (sr - r) * snow * (1 - dust),
      g + (dg - g) * dust + (sg - g) * snow * (1 - dust),
      b + (db - b) * dust + (sb - b) * snow * (1 - dust),
    );
    this.mesh.visible = density > 0.002;
    return density;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
