import * as T from 'three';
import { Random, clamp } from '../core/math.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../simulation/protocol.ts';
/** One fixed particle pool. Emitters consume actual wheel/contact state. */
export class Effects {
  readonly group = new T.Group();
  private count = 1800;
  private cursor = 0;
  private positions = new Float32Array(this.count * 3);
  private velocities = new Float32Array(this.count * 3);
  private life = new Float32Array(this.count);
  private maxLife = new Float32Array(this.count);
  private sizes = new Float32Array(this.count);
  private colors = new Float32Array(this.count * 3);
  private alpha = new Float32Array(this.count);
  private gravity = new Float32Array(this.count);
  private geometry = new T.BufferGeometry();
  private random = new Random(65012);
  private v = new T.Vector3();
  private q = new T.Quaternion();
  private emission = new Float32Array(12 * 4);
  enabled = true;
  constructor() {
    this.geometry.setAttribute(
      'position',
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'size',
      new T.BufferAttribute(this.sizes, 1).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'color',
      new T.BufferAttribute(this.colors, 3).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'opacity',
      new T.BufferAttribute(this.alpha, 1).setUsage(T.DynamicDrawUsage),
    );
    const material = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      vertexShader: `attribute float size; attribute float opacity; varying float vOpacity; varying vec3 vColor; void main(){vOpacity=opacity;vColor=color;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(size*650./max(1.,-mv.z),1.,100.);}`,
      fragmentShader:
        `varying float vOpacity;varying vec3 vColor;void main(){vec2 p=gl_PointCoord*2.-1.;float a=exp(-dot(p,p)*3.)*(1.-smoothstep(.6,1.,length(p)))*vOpacity;if(a<.008)discard;gl_FragColor=vec4(vColor,a);#include <tonemapping_fragment>\n#include <colorspace_fragment>}`.replace(
          ';#include',
          ';\n#include',
        ),
    });
    const points = new T.Points(this.geometry, material);
    points.frustumCulled = false;
    this.group.add(points);
  }
  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, kind: number) {
    const i = this.cursor++ % this.count,
      p = i * 3,
      r = this.random;
    this.positions[p] = x;
    this.positions[p + 1] = y;
    this.positions[p + 2] = z;
    this.velocities[p] = vx + (r.next() - 0.5) * 2;
    this.velocities[p + 1] = vy;
    this.velocities[p + 2] = vz + (r.next() - 0.5) * 2;
    this.life[i] = this.maxLife[i] = kind === 2 ? 0.35 + r.next() * 0.3 : 1 + r.next() * 0.7;
    this.sizes[i] = kind === 2 ? 0.07 : kind === 3 ? 0.04 : 0.18;
    this.gravity[i] = kind === 2 ? -8 : kind === 3 ? -13 : 0.7;
    const color =
      kind === 0
        ? [0.65, 0.73, 0.73]
        : kind === 1
          ? [0.52, 0.43, 0.28]
          : kind === 2
            ? [2.5, 0.9, 0.12]
            : kind === 3
              ? [0.65, 0.74, 0.77]
              : [0.77, 0.77, 0.73];
    this.colors.set(color, p);
  }
  update(frame: Float32Array, dt: number, emit = true) {
    this.group.visible = this.enabled;
    if (!this.enabled) return;
    const r = this.random;
    if (emit)
      for (let id = 0; id < frame[H.CARS]; id++) {
        const o = carBase(id),
          speed = frame[o + F.SPEED];
        this.q.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
        for (let wheel = 0; wheel < 4; wheel++) {
          const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
          const water = frame[p + W.WATER],
            surface = frame[p + W.SURFACE],
            slip = Math.abs(frame[p + W.SLIP]);
          let rate = 0,
            kind = 4;
          if (water > 0.04 && speed > 5) {
            rate = Math.min(130, speed * water * 2);
            kind = 0;
          } else if (surface >= 3 && surface <= 4 && speed > 4) {
            rate = speed * 1.7;
            kind = 1;
          } else if (slip > 0.27 && speed > 10) {
            rate = Math.min(80, slip * speed);
            kind = 4;
          }
          this.emission[id * 4 + wheel] += rate * dt;
          while (this.emission[id * 4 + wheel] >= 1) {
            this.emission[id * 4 + wheel]--;
            this.v
              .set(wheel % 2 === 0 ? -0.83 : 0.83, -0.37, wheel < 2 ? 1.82 : -1.62)
              .applyQuaternion(this.q);
            this.spawn(
              frame[o] + this.v.x,
              frame[o + 1] + this.v.y,
              frame[o + 2] + this.v.z,
              frame[o + F.VX] * 0.25,
              1 + r.next(),
              frame[o + F.VZ] * 0.25,
              kind,
            );
          }
        }
        if (frame[o + F.BOTTOM_ENERGY] > 300 && r.next() < dt * 100) {
          this.spawn(
            frame[o],
            frame[o + 1] - 0.42,
            frame[o + 2],
            frame[o + F.VX] * 0.6,
            1.5,
            frame[o + F.VZ] * 0.6,
            2,
          );
        }
      }
    if (emit && frame[H.RAIN] > 0) {
      const o = carBase(0);
      for (let i = 0; i < Math.floor(frame[H.RAIN] * dt * 40); i++)
        this.spawn(
          frame[o] + (r.next() - 0.5) * 40,
          frame[o + 1] + 4 + r.next() * 18,
          frame[o + 2] + (r.next() - 0.5) * 40,
          -1,
          -15,
          1,
          3,
        );
    }
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const p = i * 3;
      this.velocities[p + 1] += this.gravity[i] * dt;
      this.positions[p] += this.velocities[p] * dt;
      this.positions[p + 1] += this.velocities[p + 1] * dt;
      this.positions[p + 2] += this.velocities[p + 2] * dt;
      this.alpha[i] = clamp(this.life[i] / this.maxLife[i], 0, 1) * 0.35;
      if (this.gravity[i] > 0.1) this.sizes[i] += dt * 0.6;
    }
    for (const attr of ['position', 'size', 'color', 'opacity'])
      this.geometry.getAttribute(attr).needsUpdate = true;
  }
  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.emission.fill(0);
  }
}
