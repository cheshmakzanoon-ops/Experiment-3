import { MarshalStaffView } from './marshal-staff.ts';
import { districtPlan, buildDistricts } from './venue-districts.ts';
import { BroadcastSightlines } from './broadcast-sightlines.ts';
import { serviceSitePlan } from './venue-service-plan.ts';
import { buildServiceAreas } from './venue-service.ts';
import type { CrowdCluster } from './crowd.ts';
import { APRON_COLUMNS, grassApronLateral, grassApronOffset } from './ground-profile.ts';
import { barrierMaterials, buildBarrierChunk } from './circuit-barriers.ts';
import { installCircuitFinish } from './circuit-finish.ts';
import { GRANDSTANDS, standMaterials, buildGrandstand } from './grandstand.ts';
import { buildGarageBay, paddockMaterials } from './paddock-detail.ts';
import { buildVegetation, terrainHeight } from './landscape.ts';
import {
  buildTrackInfrastructure,
  trackInfrastructurePlan as makeTrackInfrastructurePlan,
  updateSafetyPanel,
  type TrackInfrastructurePlan,
} from './track-infrastructure.ts';
import { surfaceMaterial } from './surface-detail.ts';
import * as T from 'three';
import { BuildQueue } from './build-queue.ts';
import { installWetRoad } from './materials.ts';
import { kerbHeight } from '../simulation/contact.ts';
import { Track, CELL_ROWS, CELL_COLS, trackPoint } from '../simulation/track.ts';
import { H } from '../simulation/protocol.ts';
import { clamp } from '../core/math.ts';
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
  include?: (s: number, lateral: number) => boolean;
}
/** All surfaces are constructed from the same metre-valued track queries as physics. */
export class CircuitScene {
  readonly group = new T.Group();
  readonly crowd = new T.Group();
  readonly crowdClusters: CrowdCluster[] = [];
  readonly staff: MarshalStaffView;
  readonly props = new T.Group();
  readonly sightlines = new BroadcastSightlines();
  readonly vegetationGroup = new T.Group();
  readonly stateTexture: T.DataTexture;
  readonly roadMaterial: T.MeshStandardMaterial;
  readonly stateBytes = new Uint8Array(CELL_ROWS * CELL_COLS * 4);
  readonly startLamps: T.MeshStandardMaterial[] = [];
  readonly trackInfrastructure: TrackInfrastructurePlan;
  readonly serviceSites: ReturnType<typeof serviceSitePlan>;
  readonly districts: ReturnType<typeof districtPlan>;
  readonly safetyPanel = new T.MeshStandardMaterial({
    color: 0x2a5636,
    emissive: 0x2a5636,
    emissiveIntensity: 0.18,
    roughness: 0.38,
    metalness: 0.12,
  });
  private temp = trackPoint();
  readonly construction = new BuildQueue();
  constructor(
    readonly track: Track,
    deferred = false,
  ) {
    this.group.name = 'Aurel circuit';
    this.trackInfrastructure = makeTrackInfrastructurePlan(track);
    this.staff = new MarshalStaffView(this.trackInfrastructure.marshalPosts);
    this.serviceSites = serviceSitePlan(track);
    this.districts = districtPlan(track, this.serviceSites);
    this.group.add(this.props, this.crowd, this.vegetationGroup);
    // Dynamic trackside staff geometry exists immediately, but it must enter the
    // scene through the same cooperative construction queue as every other
    // circuit mesh. This keeps a deferred CircuitScene genuinely empty until
    // construction starts while preserving identical final synchronous output.
    this.construction.add('Trackside marshal staff', 1, () => this.crowd.add(this.staff.root));
    this.stateTexture = new T.DataTexture(this.stateBytes, CELL_COLS, CELL_ROWS, T.RGBAFormat);
    this.stateTexture.magFilter = T.LinearFilter;
    this.stateTexture.minFilter = T.LinearFilter;
    this.updateSurface(track.water, track.rubber, track.marbles);
    this.roadMaterial = surfaceMaterial('asphalt', undefined, true);
    installWetRoad(this.roadMaterial, this.stateTexture, true);
    const grass = surfaceMaterial('grass');
    const runOff = surfaceMaterial('asphalt', 'paint');
    runOff.color.setHex(0x8aa58d);
    const gravel = surfaceMaterial('gravel');
    this.queueRibbon(grass, {
      offset: (s, t) => {
        track.at(s, this.temp);
        return grassApronLateral(track, s, t, this.temp.width);
      },
      height: (s, l) => grassApronOffset(track, s, l),
      columns: APRON_COLUMNS,
    });
    this.queueRibbon(gravel, {
      offset: (s, t) => {
        track.at(s, this.temp);
        return (t * 2 - 1) * (this.temp.width + 10);
      },
      height: () => -0.027,
      columns: 12,
      include: (s, lateral) => {
        track.at(s, this.temp);
        return Math.abs(lateral) > this.temp.width + 4 && this.temp.curvature * lateral < -0.009;
      },
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
    installCircuitFinish(white, 'paint');
    const kerb = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    installCircuitFinish(kerb, 'kerb');
    for (const side of [-1, 1]) {
      this.queueRibbon(kerb, {
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
    const pitMat = surfaceMaterial('asphalt', undefined, true);
    installWetRoad(pitMat, this.stateTexture, false);
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
      const pos = terrain.getAttribute('position'),
        terrainUV = terrain.getAttribute('uv');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i),
          z = pos.getZ(i);
        pos.setY(i, terrainHeight(x, z));
        // Match the apron's metre-scaled original grass and world-space finish,
        // instead of a flat beige horizon with a hard material boundary.
        terrainUV.setXY(i, x / 5, z / 5);
      }
      terrain.computeVertexNormals();
      mesh(this.group, terrain, grass);
    });
    const barriers = barrierMaterials();
    const spans = Math.ceil(track.length / 80);
    for (let i = 0; i < spans; i++)
      this.construction.add('Profiled barriers and filtered catch fencing', 2, () =>
        buildBarrierChunk(
          track,
          this.group,
          (track.length * i) / spans,
          (track.length * (i + 1)) / spans,
          barriers,
        ),
      );
    this.infrastructure();
    this.construction.add('Drainage, marshal and replay-camera infrastructure', 3, () =>
      buildTrackInfrastructure(track, this.props, this.safetyPanel, this.trackInfrastructure),
    );
    this.construction.add('Authored service areas', 2, () =>
      buildServiceAreas(this.props, this.serviceSites, this.sightlines),
    );
    this.construction.add('Four authored Aurel districts', 3, () =>
      buildDistricts(this.props, this.districts, this.sightlines),
    );
    this.construction.add('Rule-placed layered foliage', 3, () =>
      buildVegetation(track, this.vegetationGroup, this.serviceSites),
    );
    this.construction.add('Grid and finish markings', 0, () => this.grid());
    this.construction.add('Spatial geometry batches', 4, () => batchScene(this.props, new Set()));
    if (!deferred) this.construction.runSynchronously();
  }
  /** Read-only identity of constructed groups, not planned sites or an art approval.
   * Groups survive static batching; no mesh traversal or GPU readback is needed. */
  environmentDiagnostics() {
    const districts = this.props.children
      .filter((group) => group.userData.architecture !== undefined)
      .map((group) => ({
        name: group.name,
        kind: String(group.userData.architecture.kind),
        revision: String(group.userData.architecture.revision),
        position: group.position.toArray(),
        finalArtApproved: false,
      }));
    return { source: 'constructed-runtime-groups', districts, finalArtApproved: false };
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
        state.push(clamp((l / p.width) * 0.5 + 0.5, 0, 1), s / this.track.length);
        const c = Math.floor(s / 3) % 2 === 0 ? new T.Color(0xdc553b) : new T.Color(0xe8e3cf);
        colors.push(c.r, c.g, c.b);
      }
    }
    const ascending = options.offset(start, 1) >= options.offset(start, 0);
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const centreS = start + ((end - start) * (i + 0.5)) / rows;
        if (options.include && !options.include(centreS, options.offset(centreS, (j + 0.5) / cols)))
          continue;
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
    const paddock = paddockMaterials();
    const { concrete, steel: dark, cladding: roof, glass } = paddock;
    // Paddock follows the main straight. Each garage has a separate bay and service box.
    for (let i = 0; i < 12; i++) {
      this.construction.add(`Garage ${i + 1} / 12`, 2, () => {
        const s = 70 + i * 9,
          p = this.track.at(s, trackPoint()),
          g = new T.Group();
        g.position.copy(this.at(s, 35, 0));
        g.rotation.y = Math.atan2(p.tx, p.tz);
        this.props.add(g);
        buildGarageBay(g, paddock, i);
        const panel = mesh(
          g,
          new T.PlaneGeometry(7.5, 0.9),
          new T.MeshStandardMaterial({ map: label(`AUREL  ${String(i + 1).padStart(2, '0')}`) }),
          -6.62,
          3.5,
          0,
        );
        panel.rotation.y = -Math.PI / 2;
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
    const stands = standMaterials();
    for (const site of GRANDSTANDS)
      this.construction.add(`Detailed grandstand at ${site.s} m`, 3, () =>
        buildGrandstand(
          this.track,
          this.props,
          this.crowd,
          site,
          stands,
          this.crowdClusters,
          this.sightlines,
        ),
      );
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
    for (let i = 0; i < 5; i++)
      this.startLamps[i].emissiveIntensity = i < frame[H.LIGHTS] ? 2.5 : 0;
    updateSafetyPanel(this.safetyPanel, frame);
  }
}
