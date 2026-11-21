import * as T from 'three';
import { trackPoint } from '../../simulation/track.ts';
import type { RoadNetwork } from '../../simulation/open-world/road-network.ts';
import type { FestivalMarkings } from '../../simulation/open-world/festival-markings.ts';

const WHITE = 0xffedca,
  BLUE = 0x4c88ff,
  GREEN = 0x32ed85,
  RED = 0xff482e;
const CELL = 320;
interface Lamp {
  matrix: T.Matrix4;
  forward: number;
  back: number;
}
interface Cluster {
  centre: T.Vector3;
  body: T.InstancedMesh;
  lenses: T.InstancedMesh;
  halo: T.Points;
}

/** Low inset fittings, paired directional prisms, and a depth-tested night
 * halo. One position is shared by both colours of each threshold fitting. */
export class AirfieldLights {
  readonly root = new T.Group();
  readonly count: number;
  private readonly clusters: Cluster[] = [];
  private readonly casework = new T.MeshStandardMaterial({
    color: 0x777977,
    roughness: 0.55,
    metalness: 0.66,
  });
  private readonly lens = new T.MeshBasicMaterial({ color: 0xffffff });
  private readonly glow = new T.ShaderMaterial({
    uniforms: { pixelHeight: { value: 720 }, night: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    vertexShader: `
      attribute vec3 frontTint; attribute vec3 backTint; attribute vec2 axis;
      uniform float pixelHeight; varying vec3 tint; varying float signalStrength;
      void main(){
        vec4 mv=modelViewMatrix*vec4(position,1.0);
        vec2 ray=cameraPosition.xz-position.xz;
        float side=dot(ray,axis)/max(0.01,length(ray));
        tint=mix(backTint,frontTint,smoothstep(-0.14,0.14,side));
        float depth=max(0.1,-mv.z);
        gl_PointSize=clamp(2.8+0.34*pixelHeight*projectionMatrix[1][1]/depth,2.8,13.0);
        signalStrength=(1.0-smoothstep(650.0,1720.0,depth))*(0.76+0.24*abs(side));
        gl_Position=projectionMatrix*mv;
      }`,
    fragmentShader: `
      uniform float night; varying vec3 tint; varying float signalStrength;
      void main(){
        vec2 p=gl_PointCoord*2.0-1.0; float r=dot(p,p);
        if(r>1.0)discard;
        float radial=exp(-3.8*r)*(1.0-smoothstep(0.6,1.0,r));
        gl_FragColor=vec4(tint*2.2,night*radial*signalStrength);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  constructor(net: RoadNetwork, markings: FestivalMarkings) {
    this.root.name = 'Kestrel inset aerodrome lights';
    const batches = new Map<string, Lamp[]>();
    const p = trackPoint();
    let count = 0;
    for (const edge of net.edges) {
      const section = markings.airfield[edge.index];
      if (!section) continue;
      const strip = section.strip,
        half = edge.spec.halfWidth;
      const add = (station: number, lateral: number, front: number, back = front) => {
        net.at(edge.offset + station, p);
        const longitudinal = new T.Vector3(p.tx, p.gradient, p.tz).normalize();
        const lateralAxis = new T.Vector3(p.nx, p.bank, p.nz);
        const up = new T.Vector3().crossVectors(longitudinal, lateralAxis).normalize();
        lateralAxis.crossVectors(up, longitudinal).normalize();
        const x = p.x + p.nx * lateral,
          z = p.z + p.nz * lateral;
        const y = net.surfaceHeight(p, lateral, half, edge.spec.crown);
        const matrix = new T.Matrix4()
          .makeBasis(lateralAxis, up, longitudinal)
          .setPosition(x, y + 0.005, z);
        const key = Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
        const lamps = batches.get(key) ?? [];
        if (!batches.has(key)) batches.set(key, lamps);
        lamps.push({ matrix, forward: front, back });
        count++;
      };
      const verges = (from: number, to: number, spacing: number, tint: number) => {
        if (to - from < spacing * 0.5) return;
        const bays = Math.max(1, Math.round((to - from) / spacing));
        for (let i = 0; i < bays; i++) {
          const station = from + ((i + 0.5) * (to - from)) / bays;
          for (const side of [-1, 1]) add(station, side * (half - 0.2), tint);
        }
      };
      const mouth = half + 9,
        from = net.nodes[edge.from].edges.length >= 3 ? mouth : 0;
      const to = edge.length - (net.nodes[edge.to].edges.length >= 3 ? mouth : 0);
      if (strip) {
        verges(from, strip.from, 42, BLUE);
        verges(strip.from, strip.to, 48, WHITE);
        verges(strip.to, to, 42, BLUE);
        for (const side of [-1, 1])
          for (let i = 0; i < 4; i++) {
            const l = side * (half - 0.34 - (i * (half - 0.85)) / 4);
            add(strip.from, l, RED, GREEN);
            add(strip.to, l, GREEN, RED);
          }
      } else verges(from, to, 42, BLUE);
    }
    this.count = count;
    const flange = new T.CylinderGeometry(0.143, 0.156, 0.018, 10).translate(0, 0.005, 0);
    const prism = new T.BoxGeometry(0.113, 0.019, 0.064).rotateX(-0.17).translate(0, 0.024, 0.036);
    const turn = new T.Matrix4().makeRotationY(Math.PI),
      reverse = new T.Matrix4();
    const v = new T.Vector3(),
      axis = new T.Vector3(),
      colour = new T.Color(),
      viewport = new T.Vector4();
    for (const lamps of batches.values()) {
      const body = new T.InstancedMesh(flange, this.casework, lamps.length);
      const lenses = new T.InstancedMesh(prism, this.lens, lamps.length * 2);
      const pos: number[] = [],
        front: number[] = [],
        back: number[] = [],
        axes: number[] = [];
      lamps.forEach((lamp, i) => {
        body.setMatrixAt(i, lamp.matrix);
        lenses.setMatrixAt(2 * i, lamp.matrix);
        lenses.setColorAt(2 * i, colour.setHex(lamp.forward));
        lenses.setMatrixAt(2 * i + 1, reverse.multiplyMatrices(lamp.matrix, turn));
        lenses.setColorAt(2 * i + 1, colour.setHex(lamp.back));
        v.setFromMatrixPosition(lamp.matrix);
        pos.push(v.x, v.y + 0.04, v.z);
        axis.setFromMatrixColumn(lamp.matrix, 2);
        axes.push(axis.x, axis.z);
        front.push(...colour.setHex(lamp.forward).toArray());
        back.push(...colour.setHex(lamp.back).toArray());
      });
      const points = new T.BufferGeometry();
      points.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      points.setAttribute('axis', new T.Float32BufferAttribute(axes, 2));
      points.setAttribute('frontTint', new T.Float32BufferAttribute(front, 3));
      points.setAttribute('backTint', new T.Float32BufferAttribute(back, 3));
      points.computeBoundingSphere();
      const halo = new T.Points(points, this.glow);
      halo.name = 'Aerodrome optical halos';
      halo.visible = false;
      halo.onBeforeRender = (renderer) => {
        this.glow.uniforms.pixelHeight.value = renderer.getCurrentViewport(viewport).w;
      };
      body.name = 'Inset fixture collars';
      lenses.name = 'Bidirectional inset prisms';
      body.computeBoundingSphere();
      lenses.computeBoundingSphere();
      this.root.add(body, lenses, halo);
      this.clusters.push({ body, lenses, halo, centre: points.boundingSphere!.center });
    }
    // An empty/custom world never allocates a WebGL buffer for a fixture.
    if (!count) {
      flange.dispose();
      prism.dispose();
    }
    this.setNight(0);
  }
  setNight(night: number, eye?: T.Vector3) {
    this.lens.color.setScalar(0.5 + night * 2.2);
    this.glow.uniforms.night.value = night;
    for (const c of this.clusters) {
      const distance = eye ? c.centre.distanceTo(eye) : 0;
      c.body.visible = distance < 540;
      c.lenses.visible = distance < 900;
      c.halo.visible = night > 0.015 && distance < 1920;
    }
  }
  /** RoadMeshes owns the shared instance and point geometry. */
  dispose() {
    this.casework.dispose();
    this.lens.dispose();
    this.glow.dispose();
  }
}
