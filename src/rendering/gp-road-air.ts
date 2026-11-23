import * as T from 'three';
import { clamp, mod, smooth } from '../core/math.ts';
import { isGpCourse } from '../simulation/gp-corner-shape.ts';
import { H } from '../simulation/protocol.ts';
import { trackPoint, type Track } from '../simulation/track.ts';

const LIMIT = 7;
const STATION_OFFSETS = [0, 1, -1, 2, -2, 3, -3, 4, -4] as const;
/** Optical boundary layer above the road. These relative strengths are
 * presentation values driven by air temperature, moisture and direct light. */
export function gpRoadAirStrength(frame: Float32Array, day: boolean) {
  if (!day) return 0;
  const temperature = frame[H.AMBIENT],
    cloud = frame[H.CLOUD],
    rain = frame[H.RAIN];
  const water = frame[H.WATER],
    wind = Math.hypot(frame[H.WIND_X], frame[H.WIND_Z]);
  if (!Number.isFinite(temperature + cloud + rain + water + wind)) return 0;
  const sun = (1 - smooth(0.18, 0.8, cloud)) * (1 - smooth(0.12, 1.8, frame[H.EXTINCTION] || 0));
  const dry = (1 - smooth(0.005, 0.16, water)) * (1 - smooth(0.015, 0.7, rain));
  return smooth(16, 35, temperature) * sun * dry * (1 - 0.68 * smooth(2, 12, wind));
}

export function roadAirUniforms() {
  const vectors = () => Array.from({ length: LIMIT }, () => new T.Vector4());
  return {
    gpRoadAirCount: { value: 0 },
    gpRoadAirGain: { value: 0 },
    // Origin in view space plus surveyed station, then two unit axes and
    // inverse half extents. The third unit axis comes from their cross product.
    gpRoadAirCentre: { value: vectors() },
    gpRoadAirAlong: { value: vectors() },
    gpRoadAirUp: { value: vectors() },
    gpRoadAirFlow: { value: vectors() },
  };
}

/** Fixed stations keep the turbulent pattern attached to the asphalt when
 * the camera changes, rewinds or the leading rider crosses the timing line. */
export class GpRoadAir {
  readonly uniforms = roadAirUniforms();
  private readonly point = trackPoint();
  private readonly centre = new T.Vector3();
  private readonly up = new T.Vector3();
  private readonly forward = new T.Vector3();
  clear() {
    this.uniforms.gpRoadAirCount.value = 0;
    this.uniforms.gpRoadAirGain.value = 0;
  }
  update(
    track: Track | undefined,
    station: number,
    frame: Float32Array,
    camera: T.PerspectiveCamera,
    day: boolean,
  ) {
    this.clear();
    if (!track || !isGpCourse(track) || !Number.isFinite(station)) return;
    const gain = gpRoadAirStrength(frame, day);
    if (gain < 0.02) return;
    const u = this.uniforms,
      p = this.point,
      view = camera.matrixWorldInverse;
    const count = Math.max(1, Math.round(track.length / 34)),
      step = track.length / count;
    const near = Math.round(mod(station, track.length) / step);
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    u.gpRoadAirGain.value = gain;
    let used = 0;
    // A broadcast camera can face either way. Inspect the same fixed stations
    // on both sides of the followed rider, then reject those outside its lens.
    for (const offset of STATION_OFFSETS) {
      const s = mod((near + offset) * step, track.length);
      track.at(s, p);
      // Turn off at sharp hairpins where one planar lens would span grass.
      const bend = clamp(1 - Math.abs(p.curvature) * 12, 0.26, 1);
      this.up
        .set(-p.tx * p.gradient - p.nx * p.bank, 1, -p.tz * p.gradient - p.nz * p.bank)
        .normalize();
      this.centre.set(p.x, p.y, p.z).addScaledVector(this.up, 0.44).applyMatrix4(view);
      const distance = -this.centre.z;
      if (
        distance < 17 ||
        distance > 210 ||
        Math.abs(this.centre.x) > tan * camera.aspect * distance + 30 ||
        Math.abs(this.centre.y) > tan * distance + 9
      )
        continue;
      this.forward.set(p.tx, p.gradient, p.tz).normalize().transformDirection(view);
      this.up.transformDirection(view);
      u.gpRoadAirCentre.value[used].set(this.centre.x, this.centre.y, this.centre.z, s);
      u.gpRoadAirAlong.value[used].set(
        this.forward.x,
        this.forward.y,
        this.forward.z,
        1 / (step * 0.63 * bend),
      );
      u.gpRoadAirUp.value[used].set(this.up.x, this.up.y, this.up.z, 1 / 0.42);
      const gap = Math.abs(mod(s - station + track.length / 2, track.length) - track.length / 2);
      u.gpRoadAirFlow.value[used].set(
        1 / Math.max(1, p.width - 0.65),
        frame[H.WIND_X] * p.tx + frame[H.WIND_Z] * p.tz,
        frame[H.WIND_X] * p.nx + frame[H.WIND_Z] * p.nz,
        1 - smooth(77, 120, gap),
      );
      if (++used === LIMIT) break;
    }
    u.gpRoadAirCount.value = used;
  }
}

/** Intersect each ray with a low ellipsoid above an actual piece of asphalt.
 * The depth buffer clips the optical path at a near tyre, kerb or barrier. */
export const GP_ROAD_AIR_GLSL = /* glsl */ `
#define GP_ROAD_AIR_MAX ${LIMIT}
uniform int gpRoadAirCount;
uniform float gpRoadAirGain;
uniform vec4 gpRoadAirCentre[GP_ROAD_AIR_MAX], gpRoadAirAlong[GP_ROAD_AIR_MAX], gpRoadAirUp[GP_ROAD_AIR_MAX];
uniform vec4 gpRoadAirFlow[GP_ROAD_AIR_MAX];
vec2 gpRoadRefraction(vec3 ray,float surface) {
  vec2 delta=vec2(0.);
  if (surface<25.) return delta;
  for(int i=0;i<GP_ROAD_AIR_MAX;i++){
    if(i>=gpRoadAirCount) break;
    vec3 c=gpRoadAirCentre[i].xyz, t=gpRoadAirAlong[i].xyz, n=gpRoadAirUp[i].xyz;
    vec3 w=cross(n,t);
    vec3 inv=vec3(gpRoadAirAlong[i].w,gpRoadAirUp[i].w,gpRoadAirFlow[i].x);
    vec3 start=-vec3(dot(c,t),dot(c,n),dot(c,w))*inv;
    vec3 axis=vec3(dot(ray,t),dot(ray,n),dot(ray,w))*inv;
    float a=max(dot(axis,axis),1.e-7), mid=-dot(start,axis)/a;
    vec3 miss=start+axis*mid; float d2=dot(miss,miss);
    if (d2>=1. || mid<0.) continue;
    float halfPath=sqrt((1.-d2)/a);
    float entry=max(25.,mid-halfPath), leave=min(surface,mid+halfPath);
    if(leave<=entry) continue;
    vec3 local=ray*((entry+leave)*.5)-c;
    vec2 p=vec2(gpRoadAirCentre[i].w+dot(local,t), dot(local,w));
    // The large cells drift slowly down the straight. Shorter waves travel
    // at a different speed under crosswind; no pixel hash or frame counter.
    float t0=hazeTime;
    p-=gpRoadAirFlow[i].yz*t0*.24;
    float drift=t0*.9;
    vec2 q=vec2(.42*p.x+.79*p.y-drift,.81*p.x-.54*p.y+.64*drift);
    float layer=.57*sin(q.x+.61*sin(q.y))+.30*sin(2.4*q.y-.83*t0)+.13*sin(3.2*q.x+.83*q.y);
    float coverage=gpRoadAirFlow[i].w*(1.-smoothstep(.56,1.,d2))*min(1.,(leave-entry)/17.);
    vec2 vertical=n.xy/max(.4,length(n.xy));
    delta+=coverage*(vertical*layer + vec2(vertical.y,-vertical.x)*.23*sin(q.y+.5*q.x));
  }
  return delta*gpRoadAirGain*.81;
}
`;
