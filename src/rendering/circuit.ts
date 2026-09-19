import * as T from 'three';
import { BuildQueue } from './build-queue.ts';
import wetRoad from '../shaders/wetRoad.frag?raw';
import { kerbHeight } from '../simulation/contact.ts';
import { Track, CELL_ROWS, CELL_COLS, trackPoint } from '../simulation/track.ts';
import { Random, clamp } from '../core/math.ts';
import { batchScene, box, canvasTexture, label, mesh } from './geometry.ts';
interface RibbonOptions {
  start?: number;
  end?: number;
  step?: number;
  offset: (s: number, t: number) => number;
  height?: (s: number, l: number, t: number) => number;
  stripes?: boolean;
  columns?: number;
  road?: boolean;
}
/** All surfaces are constructed from the same metre-valued track queries as physics. */
export class CircuitScene {
  readonly group = new T.Group();
  readonly crowd = new T.Group();
  readonly props = new T.Group();
  readonly vegetationGroup = new T.Group();
  readonly stateTexture: T.DataTexture;
  readonly roadMaterial: T.MeshStandardMaterial;
  readonly stateBytes = new Uint8Array(CELL_ROWS * CELL_COLS * 4);
  readonly startLamps: T.MeshStandardMaterial[] = [];
  private temp = trackPoint();
  readonly construction = new BuildQueue();
  constructor(
    readonly track: Track,
    deferred = false,
  ) {
    this.group.name = 'Aurel circuit';
    this.group.add(this.props, this.crowd, this.vegetationGroup);
    this.stateTexture = new T.DataTexture(this.stateBytes, CELL_COLS, CELL_ROWS, T.RGBAFormat);
    this.stateTexture.magFilter = T.LinearFilter;
    this.stateTexture.minFilter = T.LinearFilter;
    this.updateSurface(track.water, track.rubber, track.marbles);
    const rng = new Random(1887);
    const asphalt = canvasTexture(512, 512, (c) => {
      const image = c.createImageData(512, 512);
      for (let i = 0; i < image.data.length; i += 4) {
        const n = 77 + rng.next() * 28;
        image.data[i] = n;
        image.data[i + 1] = n + 1;
        image.data[i + 2] = n + 3;
        image.data[i + 3] = 255;
      }
      c.putImageData(image, 0, 0);
      for (let i = 0; i < 90; i++) {
        c.fillStyle = 'rgba(19,20,21,.12)';
        c.fillRect(rng.next() * 512, rng.next() * 512, 1, 8 + rng.next() * 60);
      }
    });
    asphalt.wrapS = asphalt.wrapT = T.RepeatWrapping;
    asphalt.anisotropy = 8;
    this.roadMaterial = new T.MeshStandardMaterial({
      map: asphalt,
      color: 0xb2b5b5,
      roughness: 0.91,
      metalness: 0.07,
    });
    this.roadMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.trackState = { value: this.stateTexture };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec2 trackUV; varying vec2 vTrackUV;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTrackUV = trackUV;');
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D trackState; varying vec2 vTrackUV;',
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n' + wetRoad,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,mix(0.23,0.10,puddle),wet);',
      );
    };
    const grass = new T.MeshStandardMaterial({ color: 0x69734d, roughness: 1 });
    const runOff = new T.MeshStandardMaterial({ color: 0x364c44, roughness: 0.93 });
    const gravel = new T.MeshStandardMaterial({ color: 0xb2a591, roughness: 1 });
    this.queueRibbon(grass, {
      offset: (s, t) => {
        track.at(s, this.temp);
        return (t * 2 - 1) * (this.temp.width + 38);
      },
      height: (_s, l) => -0.04 - Math.max(0, Math.abs(l) - 15) * 0.045,
      columns: 6,
    });
    this.queueRibbon(gravel, {
      offset: (s, t) => {
        track.at(s, this.temp);
        return (t * 2 - 1) * (this.temp.width + 10);
      },
      height: () => -0.027,
      columns: 4,
    });
    this.queueRibbon(runOff, {
      offset: (s, t) => {
        track.at(s, this.temp);
        return (t * 2 - 1) * (this.temp.width + 4);
      },
      height: () => -0.008,
      columns: 4,
    });
    this.queueRibbon(this.roadMaterial, {
      offset: (s, t) => {
        track.at(s, this.temp);
        return (t * 2 - 1) * this.temp.width;
      },
      columns: 14,
      road: true,
      step: 1.8,
    });
    const white = new T.MeshStandardMaterial({ color: 0xf1eee0, roughness: 0.75 });
    for (const side of [-1, 1]) {
      this.queueRibbon(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }), {
        offset: (s, t) => {
          track.at(s, this.temp);
          return side * (this.temp.width + t * 1.1);
        },
        height: (s, l, t) => {
          const pit = track.pitOffset(s);
          return track.isPitSection(s) && pit > 3 && Math.abs(l - pit) < 3.6
            ? 0
            : kerbHeight(s, t * 1.1);
        },
        step: 0.16,
        stripes: true,
        columns: 6,
      });
      this.queueRibbon(white, {
        offset: (s, t) => {
          track.at(s, this.temp);
          return side * (this.temp.width - 0.17 + t * 0.14);
        },
        height: () => 0.006,
        step: 2,
      });
    }
    // Smooth pit road ribbon and its marking; no decorative inaccessible lane.
    const pitMat = new T.MeshStandardMaterial({ map: asphalt, color: 0xb6b6b0, roughness: 0.83 });
    for (const [start, end] of [
      [track.length - 220, track.length],
      [0, 330],
    ]) {
      this.queueRibbon(pitMat, {
        start,
        end,
        offset: (s, t) => track.pitOffset(s) + (t * 2 - 1) * 3.6,
        height: () => 0.003,
        columns: 4,
        step: 1,
      });
      for (const side of [-1, 1])
        this.queueRibbon(white, {
          start,
          end,
          offset: (s, t) => track.pitOffset(s) + side * (3.35 + t * 0.12),
          height: () => 0.008,
          step: 1,
        });
    }
    // Surface colour below the horizon: track ribbons cover the actual collision elevation.
    this.construction.add('Distant terrain', 3, () => {
      const terrain = new T.PlaneGeometry(5500, 5500, 96, 96);
      terrain.rotateX(-Math.PI / 2);
      const pos = terrain.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i),
          z = pos.getZ(i),
          dist = Math.hypot(x, z);
        pos.setY(
          i,
          -4 +
            Math.max(0, dist - 680) * 0.033 * (0.3 + 0.7 * Math.sin(x * 0.004 + z * 0.002) ** 2) +
            Math.max(0, dist - 1000) * 0.038 * Math.cos(x * 0.003 - z * 0.004) ** 2,
        );
      }
      terrain.computeVertexNormals();
      mesh(this.group, terrain, new T.MeshStandardMaterial({ color: 0x81836d, roughness: 1 }));
    });
    this.construction.add('Track barriers and fencing', 2, () => this.barriers());
    this.infrastructure();
    this.construction.add('Background vegetation', 3, () => this.vegetation(rng));
    this.construction.add('Grid and finish markings', 0, () => this.grid());
    this.construction.add('Spatial geometry batches', 4, () => batchScene(this.props, new Set()));
    if (!deferred) this.construction.runSynchronously();
  }
  private queueRibbon(material: T.Material, options: RibbonOptions) {
    const start = options.start ?? 0;
    const end = options.end ?? this.track.length;
    const count = Math.ceil((end - start) / 80);
    const priority = options.road || options.stripes || options.start !== undefined ? 0 : 2;
    for (let i = 0; i < count; i++) {
      const part = {
        ...options,
        start: start + ((end - start) * i) / count,
        end: start + ((end - start) * (i + 1)) / count,
      };
      this.construction.add(
        options.road
          ? 'Circuit asphalt'
          : options.stripes
            ? 'Physical kerb geometry'
            : 'Track surface',
        priority,
        () => this.ribbon(material, part),
      );
    }
  }
  ribbon(material: T.Material, options: RibbonOptions): T.Mesh {
    const begin = options.start ?? 0,
      finish = options.end ?? this.track.length;
    if (finish - begin > 80) {
      let first: T.Mesh | undefined;
      const pieces = Math.ceil((finish - begin) / 80);
      for (let i = 0; i < pieces; i++) {
        const part = this.ribbon(material, {
          ...options,
          start: begin + ((finish - begin) * i) / pieces,
          end: begin + ((finish - begin) * (i + 1)) / pieces,
        });
        first ??= part;
      }
      return first!;
    }
    const start = options.start ?? 0,
      end = options.end ?? this.track.length,
      rows = Math.ceil((end - start) / (options.step ?? 2)),
      cols = options.columns ?? 1;
    const vertices: number[] = [],
      uv: number[] = [],
      state: number[] = [],
      colors: number[] = [],
      indices: number[] = [];
    const p = trackPoint();
    for (let i = 0; i <= rows; i++) {
      const s = start + ((end - start) * i) / rows;
      this.track.at(s, p);
      for (let j = 0; j <= cols; j++) {
        const t = j / cols,
          l = options.offset(s, t),
          extra = options.height?.(s, l, t) ?? 0;
        vertices.push(p.x + p.nx * l, p.y + p.bank * clamp(l, -12, 12) + extra, p.z + p.nz * l);
        uv.push(l / 5, s / 5);
        state.push(t, s / this.track.length);
        const c = Math.floor(s / 3) % 2 === 0 ? new T.Color(0xdc553b) : new T.Color(0xe8e3cf);
        colors.push(c.r, c.g, c.b);
      }
    }
    const ascending = options.offset(start, 1) >= options.offset(start, 0);
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const a = i * (cols + 1) + j,
          b = a + cols + 1;
        if (ascending) indices.push(a, b, a + 1, b, b + 1, a + 1);
        else indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('trackUV', new T.Float32BufferAttribute(state, 2));
    if (options.stripes) g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    const o = mesh(this.group, g, material);
    o.castShadow = false;
    return o;
  }
  updateSurface(water: Float32Array, rubber: Float32Array, marbles: Float32Array) {
    const count = CELL_ROWS * CELL_COLS;
    if (
      water.length !== count ||
      rubber.length !== count ||
      marbles.length !== count ||
      !water.every(Number.isFinite) ||
      !rubber.every(Number.isFinite) ||
      !marbles.every(Number.isFinite)
    )
      throw new Error('Invalid rendered track surface');
    for (let i = 0; i < water.length; i++) {
      this.stateBytes[i * 4] = clamp((water[i] / 2) * 255, 0, 255);
      this.stateBytes[i * 4 + 1] = Math.round(clamp(rubber[i], 0, 1) * 255);
      this.stateBytes[i * 4 + 2] = Math.round(clamp(marbles[i], 0, 1) * 255);
      this.stateBytes[i * 4 + 3] = 255;
    }
    this.stateTexture.needsUpdate = true;
  }
  at(s: number, l: number, y = 0) {
    const p = this.track.at(s, trackPoint());
    return new T.Vector3(p.x + p.nx * l, p.y + p.bank * clamp(l, -12, 12) + y, p.z + p.nz * l);
  }
  private instance(
    g: T.BufferGeometry,
    m: T.Material,
    transforms: {
      s: number;
      l: number;
      y: number;
      sx?: number;
      sy?: number;
      sz?: number;
      rotation?: number;
    }[],
    parent = this.props,
  ) {
    const inst = new T.InstancedMesh(g, m, transforms.length),
      dummy = new T.Object3D();
    transforms.forEach((t, i) => {
      const p = this.track.at(t.s, trackPoint());
      dummy.position.copy(this.at(t.s, t.l, t.y));
      dummy.rotation.set(0, Math.atan2(p.tx, p.tz) + (t.rotation ?? 0), 0);
      dummy.scale.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    parent.add(inst);
    return inst;
  }
  private barriers() {
    const barrier = new T.MeshStandardMaterial({ color: 0xe1ded2, roughness: 0.85 }),
      posts = new T.MeshStandardMaterial({ color: 0x878e8c, metalness: 0.6, roughness: 0.55 });
    const blocks: { s: number; l: number; y: number; sz: number }[] = [],
      poles: { s: number; l: number; y: number }[] = [];
    for (let s = 0; s < this.track.length; s += 3.8)
      for (const side of [-1, 1]) {
        const l = side * this.track.boundary(s, side);
        blocks.push({ s, l, y: 0.47, sz: 3.85 });
        poles.push({ s, l: l + side * 0.24, y: 2.1 });
      }
    this.instance(new T.BoxGeometry(0.55, 0.94, 1), barrier, blocks);
    this.instance(new T.CylinderGeometry(0.045, 0.055, 3.2, 6), posts, poles);
    const fenceMap = canvasTexture(64, 64, (c) => {
      c.clearRect(0, 0, 64, 64);
      c.strokeStyle = '#abb6b3';
      c.lineWidth = 2;
      c.beginPath();
      for (let x = -64; x < 128; x += 16) {
        c.moveTo(x, 0);
        c.lineTo(x + 64, 64);
        c.moveTo(x, 0);
        c.lineTo(x - 64, 64);
      }
      c.stroke();
    });
    fenceMap.wrapS = fenceMap.wrapT = T.RepeatWrapping;
    const fence = new T.MeshStandardMaterial({
      map: fenceMap,
      alphaTest: 0.3,
      side: T.DoubleSide,
      roughness: 0.7,
    });
    for (const side of [-1, 1]) {
      const v: number[] = [],
        uv: number[] = [],
        ix: number[] = [];
      const n = Math.ceil(this.track.length / 4);
      for (let i = 0; i <= n; i++) {
        const s = (i / n) * this.track.length,
          l = side * (this.track.boundary(s, side) + 0.25),
          p = this.at(s, l, 0);
        v.push(p.x, p.y + 0.94, p.z, p.x, p.y + 3.4, p.z);
        uv.push(s / 1.2, 0, s / 1.2, 2.4);
      }
      for (let i = 0; i < n; i++) {
        const a = i * 2;
        ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(v, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      g.setIndex(ix);
      g.computeVertexNormals();
      const o = mesh(this.props, g, fence);
      o.castShadow = false;
    }
  }
  private sign(text: string, s: number, l: number, width = 7, height = 1.5) {
    const p = this.track.at(s, trackPoint()),
      g = new T.Group();
    g.position.copy(this.at(s, l, 2.2));
    g.rotation.y = Math.atan2(p.tx, p.tz) + (l < 0 ? Math.PI / 2 : -Math.PI / 2);
    this.props.add(g);
    const m = new T.MeshStandardMaterial({ map: label(text), roughness: 0.72, side: T.DoubleSide });
    mesh(g, new T.PlaneGeometry(width, height), m);
    const metal = new T.MeshStandardMaterial({ color: 0x586463 });
    box(g, metal, -width * 0.35, -1.1, 0.02, 0.08, 2.5, 0.08);
    box(g, metal, width * 0.35, -1.1, 0.02, 0.08, 2.5, 0.08);
  }
  private infrastructure() {
    const concrete = new T.MeshStandardMaterial({ color: 0xc8c7b9, roughness: 0.82 });
    const dark = new T.MeshStandardMaterial({ color: 0x283736, roughness: 0.68 });
    const roof = new T.MeshStandardMaterial({ color: 0xaaa99b, metalness: 0.35, roughness: 0.6 });
    const glass = new T.MeshStandardMaterial({ color: 0x557577, metalness: 0.75, roughness: 0.15 });
    // Paddock follows the main straight. Each garage has a separate bay and service box.
    for (let i = 0; i < 12; i++) {
      this.construction.add(`Garage ${i + 1} / 12`, 2, () => {
        const s = 70 + i * 9,
          p = this.track.at(s, trackPoint()),
          g = new T.Group();
        g.position.copy(this.at(s, 35, 0));
        g.rotation.y = Math.atan2(p.tx, p.tz);
        this.props.add(g);
        box(g, concrete, 0, 3, 0, 13, 6, 8.6);
        box(g, dark, -6.55, 1.5, 0, 0.04, 2.9, 6.3);
        box(g, roof, 0, 6.12, 0, 14, 0.24, 9);
        box(g, glass, -6.59, 4.65, 0, 0.05, 1.6, 7.7);
        const panel = mesh(
          g,
          new T.PlaneGeometry(7.5, 0.9),
          new T.MeshStandardMaterial({ map: label(`AUREL  ${String(i + 1).padStart(2, '0')}`) }),
          -6.62,
          3.5,
          0,
        );
        panel.rotation.y = -Math.PI / 2;
        for (const z of [-3.4, 3.4]) box(g, concrete, -6.8, 3, z, 0.35, 6, 0.3);
        const boxS = 102 + i * 7,
          mark = this.track.at(boxS, trackPoint());
        const painting = new T.Group();
        painting.position.copy(this.at(boxS, 24.1, 0.016));
        painting.rotation.y = Math.atan2(mark.tx, mark.tz);
        this.props.add(painting);
        const yellow = new T.MeshBasicMaterial({ color: 0xe7c969 });
        for (const x of [-1.4, 1.4]) box(painting, yellow, x, 0, 0, 0.08, 0.012, 5);
        box(painting, yellow, 0, 0, 2.5, 2.9, 0.012, 0.08);
      });
    }
    for (const [s, side] of [
      [450, -1],
      [780, 1],
      [1220, -1],
      [1670, 1],
      [2210, -1],
      [2600, 1],
    ]) {
      this.construction.add(`Grandstand at ${s} m`, 3, () => {
        const p = this.track.at(s, trackPoint()),
          g = new T.Group();
        g.position.copy(this.at(s, side * (p.width + 28), 0));
        g.rotation.y = Math.atan2(p.tx, p.tz);
        this.props.add(g);
        for (let row = 0; row < 7; row++) {
          box(g, concrete, side * row * 0.8, row * 0.5, 0, 1, 0.45, 48);
        }
        box(g, roof, side * 2, 5, 0, 10, 0.22, 50);
        for (const z of [-23, 0, 23]) box(g, dark, side * 5, 2.5, z, 0.25, 5, 0.25);
        const people: { s: number; l: number; y: number; sx: number; sy: number; sz: number }[] =
          [];
        for (let row = 0; row < 7; row++)
          for (let col = 0; col < 48; col++) {
            if ((col + row) % 9 === 0) continue;
            people.push({
              s: s + (col - 24) * 0.88,
              l: side * (p.width + 28 + row * 0.8),
              y: row * 0.5 + 0.9,
              sx: 0.2,
              sy: 0.45,
              sz: 0.18,
            });
          }
        const c = this.instance(
          new T.SphereGeometry(1, 6, 4),
          new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
          people,
          this.crowd,
        );
        const random = new Random(s);
        for (let j = 0; j < people.length; j++)
          c.setColorAt(
            j,
            new T.Color().setHSL(
              random.next(),
              0.2 + random.next() * 0.3,
              0.3 + random.next() * 0.45,
            ),
          );
      });
    }
    this.construction.add('Signs, gantry and control tower', 2, () => {
      this.sign('APEX  /  FORMULA', 360, -19, 18, 2);
      this.sign('AUREL MOTORSPORT', 870, 19, 20, 2);
      this.sign('NORTHLINE', 1540, -19, 15, 1.8);
      this.sign('PULSE / ENGINEERING', 2300, 19, 20, 2);
      for (const corner of [570, 1170, 1410, 1640, 2070, 2670])
        for (const distance of [50, 100, 150])
          this.sign(String(distance), corner - distance, -18, 1, 0.9);
      const p = this.track.at(0, trackPoint()),
        gantry = new T.Group();
      gantry.position.copy(this.at(0, 0));
      gantry.rotation.y = Math.atan2(p.tx, p.tz);
      this.props.add(gantry);
      box(gantry, dark, 0, 6, 0, 22, 1.3, 0.5);
      for (const side of [-1, 1]) box(gantry, concrete, side * 10.8, 3, 0, 0.5, 6, 0.5);
      const banner = mesh(
        gantry,
        new T.PlaneGeometry(14, 1),
        new T.MeshStandardMaterial({ map: label('AUREL / GRAND CIRCUIT'), side: T.DoubleSide }),
        0,
        6,
        -0.27,
      );
      banner.rotation.y = Math.PI;
      for (let i = 0; i < 5; i++) {
        const mat = new T.MeshStandardMaterial({
          color: 0x1a0e0c,
          emissive: 0xff210c,
          emissiveIntensity: 0,
        });
        this.startLamps.push(mat);
        const lamp = mesh(
          gantry,
          new T.CylinderGeometry(0.16, 0.16, 0.08, 20),
          mat,
          (i - 2) * 0.45,
          4.95,
          -0.3,
        );
        lamp.rotation.x = Math.PI / 2;
      }
      const tower = new T.Group();
      tower.position.copy(this.at(235, 38));
      this.props.add(tower);
      box(tower, concrete, 0, 8, 0, 7, 16, 7);
      box(tower, glass, 0, 15, 0, 9, 3.5, 9);
      box(tower, roof, 0, 17, 0, 10, 0.25, 10);
    });
  }
  private vegetation(random: Random) {
    const transforms: { s: number; l: number; y: number; sx: number; sy: number; sz: number }[] =
      [];
    for (let i = 0; i < 460; i++) {
      const s = random.next() * this.track.length,
        side = random.next() < 0.5 ? -1 : 1,
        l = side * (40 + random.next() * 135);
      if (s < 300 && l > 0) continue;
      const size = 3 + random.next() * 5;
      transforms.push({ s, l, y: size * 0.5 - 1, sx: size * 0.48, sy: size, sz: size * 0.48 });
    }
    const trees = this.instance(
      new T.IcosahedronGeometry(1, 1),
      new T.MeshStandardMaterial({ color: 0x56623d, roughness: 1 }),
      transforms,
      this.vegetationGroup,
    );
    trees.userData.fullCount = transforms.length;
    for (let i = 0; i < transforms.length; i++)
      trees.setColorAt(
        i,
        new T.Color().setHSL(0.19 + random.next() * 0.035, 0.22, 0.29 + random.next() * 0.12),
      );
  }
  private grid() {
    const paint = new T.MeshBasicMaterial({ color: 0xece9de });
    for (let i = 0; i < 12; i++) {
      const s = this.track.length - 32 - Math.floor(i / 2) * 10,
        l = i % 2 === 0 ? -2.2 : 2.2,
        p = this.track.at(s, trackPoint()),
        g = new T.Group();
      g.position.copy(this.at(s, l, 0.012));
      g.rotation.y = Math.atan2(p.tx, p.tz);
      this.props.add(g);
      for (const x of [-1.1, 1.1]) box(g, paint, x, 0, 0, 0.08, 0.01, 4);
      box(g, paint, 0, 0, 2, 2.3, 0.01, 0.08);
    }
    const finish = canvasTexture(128, 32, (c) => {
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 16; x++) {
          c.fillStyle = (x + y) % 2 ? '#e8e5da' : '#242b29';
          c.fillRect(x * 8, y * 16, 8, 16);
        }
    });
    const p = this.track.at(0, trackPoint()),
      line = mesh(
        this.props,
        new T.PlaneGeometry(p.width * 2, 1.2),
        new T.MeshStandardMaterial({ map: finish, roughness: 0.8 }),
      );
    line.position.copy(this.at(0, 0, 0.015));
    line.rotation.set(-Math.PI / 2, 0, -Math.atan2(p.tx, p.tz));
  }
  update(frame: Float32Array) {
    for (let i = 0; i < 5; i++) this.startLamps[i].emissiveIntensity = i < frame[3] ? 2.5 : 0;
  }
}
