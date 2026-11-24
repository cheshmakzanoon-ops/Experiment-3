import * as T from 'three';
import {
  F,
  H,
  O,
  OFFROAD_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../simulation/protocol.ts';
import { MATERIAL } from '../../simulation/surface-material.ts';

/** Each cone sees the dirt in its own floodlit patch. The rear contact,
 * velocity and measured soil moisture come from the presented race frame,
 * so a paused or reversed replay reconstructs exactly the same shafts. */
export class MxArenaHaze {
  private readonly targets: T.Vector3[] = [];
  private readonly dust = new Float32Array(20);

  beam(lamp: T.Vector3, target: T.Vector3) {
    const index = this.targets.length;
    if (index >= this.dust.length) throw new RangeError('Too many Arena Nord haze shafts');
    this.targets.push(target.clone());
    const axis = target.clone().sub(lamp),
      length = axis.length();
    axis.normalize();
    const g = new T.CylinderGeometry(0.42, 3.1, length, 14, 1, true);
    g.translate(0, -length / 2, 0);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, -1, 0), axis));
    g.translate(lamp.x, lamp.y, lamp.z);
    const count = g.getAttribute('position').count,
      data = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) data.set([axis.x, axis.y, axis.z, index], i * 4);
    g.setAttribute('mxBeam', new T.Float32BufferAttribute(data, 4));
    return g;
  }

  material() {
    return new T.ShaderMaterial({
      name: 'Arena floodlight haze beams',
      uniforms: {
        beamColour: { value: new T.Color(0xeaf4ff) },
        beamStrength: { value: 0.12 },
        beamDust: { value: this.dust },
      },
      vertexShader: /* glsl */ `
        attribute vec4 mxBeam;
        uniform float beamDust[20];
        varying float vAlong, vDust;
        varying vec3 vEye, vNormal, vAxis;
        void main() {
          vAlong = 1. - uv.y;
          vDust = beamDust[int(mxBeam.w+.5)];
          vec4 view = modelViewMatrix * vec4(position,1.);
          vEye = -view.xyz;
          vNormal = normalMatrix * normal;
          vAxis = mat3(modelViewMatrix) * mxBeam.xyz;
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 beamColour;
        uniform float beamStrength;
        varying float vAlong, vDust;
        varying vec3 vEye, vNormal, vAxis;
        void main() {
          vec3 eye = normalize(vEye);
          float facing = abs(dot(normalize(vNormal),eye));
          float chord = facing*facing;
          // A mild forward lobe brightens a bank viewed into the lamp;
          // filming with that bank behind the camera gives softer scatter.
          float mu = dot(normalize(vAxis),eye);
          float phase = .42 + .53 * .8775 / pow(max(.43,1.1225-.70*mu),1.5);
          float spread = 1. / (1. + 6.*vAlong);
          float ends = smoothstep(0.,.08,vAlong) * (1.-smoothstep(.63,1.,vAlong));
          float nearFade = smoothstep(2.,12.,length(vEye));
          // Dust picked up at the wheel increases the lower portion. The
          // cooler suspended haze near the trusses persists between packs.
          float lower = smoothstep(.22,.76,vAlong);
          float density = .62 + .22*lower + 2.4*lower*vDust;
          vec3 tint = mix(beamColour,vec3(1.,.80,.61),lower*vDust*.45);
          gl_FragColor = vec4(tint * (beamStrength*chord*phase*spread*ends*nearFade*density),1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      blending: T.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
  }

  update(frame?: Float32Array) {
    this.dust.fill(0);
    if (!frame) return;
    for (let id = 0; id < frame[H.CARS]; id++) {
      const o = carBase(id),
        rear = o + WHEEL_BASE + 2 * WHEEL_STRIDE;
      if (
        frame[o + F.RETIRED] ||
        frame[o + F.IN_PIT] ||
        frame[o + OFFROAD_BASE + O.AIRBORNE] > 0.5 ||
        !(frame[rear + W.LOAD] > 50)
      )
        continue;
      const material = Math.round(frame[rear + W.SURFACE]);
      if (material !== MATERIAL.DIRT && material !== MATERIAL.SAND && material !== MATERIAL.MUD)
        continue;
      const vx = frame[o + F.VX],
        vz = frame[o + F.VZ],
        speed = Math.hypot(vx, vz);
      if (!(speed > 1.5)) continue;
      const x = frame[o + F.X],
        z = frame[o + F.Z],
        dx = vx / speed,
        dz = vz / speed;
      const dry = 1 - T.MathUtils.clamp(frame[o + OFFROAD_BASE + O.MOISTURE], 0, 1);
      const slip = T.MathUtils.clamp(Math.abs(frame[rear + W.SLIP]) * 3, 0, 1);
      const amount = dry * dry * T.MathUtils.clamp((speed - 1.5) / 21, 0, 1) * (0.32 + 0.68 * slip);
      for (let i = 0; i < this.targets.length; i++) {
        const p = this.targets[i],
          px = p.x - x,
          pz = p.z - z;
        // A broad turbulent wake trails the machine by roughly half a second.
        const along = (px * dx + pz * dz + Math.min(11, speed * 0.48)) / 17;
        const cross = (px * dz - pz * dx) / 9;
        const shape = Math.max(0, 1 - along * along - cross * cross);
        const contribution = amount * shape * shape;
        this.dust[i] += (1 - this.dust[i]) * contribution;
      }
    }
  }
}
