import * as T from 'three';
import { DriverRig } from './driver.ts';
import { serviceWheelOffset } from './pit-crew.ts';
import { drawSteeringDisplay, shiftLight, SteeringDisplayClock } from './steering-display.ts';
import { carbonMaterial, treadMaterial } from './materials.ts';
import { ReducedCar, carLod } from './lod.ts';
import {
  box,
  canvasTexture,
  label,
  loft,
  cockpitShell,
  mergeStatic,
  mesh,
  rod,
  tube,
} from './geometry.ts';
import { COMPOUNDS, LIVERIES } from '../simulation/config.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE } from '../simulation/protocol.ts';
import { WHEEL_POSITIONS } from '../simulation/vehicle.ts';
import { clamp, lerp } from '../core/math.ts';
export class FormulaCar {
  readonly root = new T.Group();
  readonly mirrors: T.Mesh[] = [];
  readonly staticBody = new T.Group();
  private highDetail = new T.Group();
  private reduced: ReducedCar[] = [];
  lodLevel = 0;
  readonly frontWing = new T.Group();
  readonly rearWing = new T.Group();
  readonly wheelPivots: T.Group[] = [];
  readonly wheelSpins: T.Group[] = [];
  readonly discs: T.MeshStandardMaterial[] = [];
  readonly treads: ReturnType<typeof treadMaterial>[] = [];
  readonly rings: T.MeshBasicMaterial[] = [];
  readonly links: { mesh: T.Object3D; anchor: T.Vector3; wheel: number; dy: number }[] = [];
  private suspension: T.InstancedMesh;
  readonly steering = new T.Group();
  readonly driver: DriverRig;
  readonly helmet = new T.Group();
  readonly rainLight: T.MeshStandardMaterial;
  readonly display: T.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private displayClock = new SteeringDisplayClock();
  private shiftLeds: T.MeshBasicMaterial[] = [];
  readonly paint: T.MeshPhysicalMaterial;
  private qa = new T.Quaternion();
  private qb = new T.Quaternion();
  private v = new T.Vector3();
  private up = new T.Vector3(0, 1, 0);
  constructor(readonly id: number) {
    this.root.name = `Formula ${id + 1}`;
    this.root.add(this.staticBody, this.frontWing, this.rearWing);
    const s = this.staticBody;
    this.paint = new T.MeshPhysicalMaterial({
      color: LIVERIES[id % LIVERIES.length],
      metalness: 0.32,
      roughness: 0.25,
      clearcoat: 1,
      clearcoatRoughness: 0.16,
    });
    const carbon = carbonMaterial();
    const dark = new T.MeshStandardMaterial({ color: 0x101416, roughness: 0.75 });
    const metal = new T.MeshStandardMaterial({ color: 0x7c8589, metalness: 0.88, roughness: 0.3 });
    const ivory = new T.MeshPhysicalMaterial({
      color: 0xe7e1d2,
      roughness: 0.3,
      metalness: 0.18,
      clearcoat: 1,
    });
    // Venturi floor, sculpted monocoque, narrow nose and smoothly undercut sidepods.
    mesh(
      s,
      loft([
        [-2.1, -0.395, 0.42, 0.024],
        [-1.7, -0.385, 0.89, 0.033],
        [-0.65, -0.38, 0.93, 0.035],
        [0.25, -0.38, 0.78, 0.03],
        [0.9, -0.35, 0.36, 0.02],
      ]),
      carbon,
    );
    mesh(
      s,
      loft([
        [0.4, 0.025, 0.3, 0.17],
        [0.52, 0.025, 0.29, 0.16],
        [1.15, -0.025, 0.23, 0.12],
        [1.9, -0.14, 0.115, 0.075],
        [2.45, -0.235, 0.075, 0.025],
        [2.55, -0.24, 0.004, 0.005],
      ]),
      this.paint,
    );
    mesh(s, cockpitShell(), this.paint);
    box(s, dark, 0, -0.24, -0.14, 0.5, 0.08, 1.02);
    box(s, dark, 0, -0.02, -0.6, 0.44, 0.45, 0.09);
    for (const sign of [-1, 1]) {
      const pod = mesh(
        s,
        loft([
          [-1.75, -0.19, 0.07, 0.12],
          [-1.35, -0.08, 0.18, 0.24],
          [-0.8, -0.045, 0.29, 0.235],
          [-0.2, -0.02, 0.31, 0.19],
          [0.28, -0.02, 0.25, 0.13],
          [0.37, -0.03, 0.16, 0.085],
        ]),
        this.paint,
        sign * 0.53,
        0,
        0,
      );
      pod.rotation.z = sign * -0.08;
      const inlet = mesh(s, new T.SphereGeometry(1, 24, 12), dark, sign * 0.55, 0.005, 0.373);
      inlet.scale.set(0.225, 0.075, 0.014);
      for (let j = 0; j < 8; j++)
        box(s, carbon, sign * 0.66, 0.145, -0.25 - j * 0.09, 0.2, 0.008, 0.025).rotation.z =
          sign * 0.14;
      tube(
        s,
        carbon,
        [
          [sign * 0.85, -0.355, 0.4],
          [sign * 0.92, -0.34, -0.4],
          [sign * 0.89, -0.31, -1.25],
          [sign * 0.67, -0.3, -1.8],
        ],
        0.012,
      );
      for (let j = 0; j < 5; j++)
        box(s, carbon, sign * (0.15 + j * 0.12), -0.32, -2.01, 0.018, 0.17, 0.42).rotation.x =
          -0.18;
    }
    mesh(
      s,
      loft([
        [-2.15, -0.11, 0.01, 0.03],
        [-1.65, 0.02, 0.15, 0.15],
        [-1.0, 0.16, 0.235, 0.36],
        [-0.72, 0.3, 0.17, 0.43],
        [-0.55, 0.36, 0.09, 0.27],
      ]),
      this.paint,
    );
    const intake = mesh(s, new T.TorusGeometry(0.105, 0.035, 12, 32), carbon, 0, 0.61, -0.65);
    intake.scale.set(0.78, 1, 1);
    box(s, carbon, 0, 0.3, -1.22, 0.018, 0.42, 1.05);
    // Open cockpit surround and halo. The centre post is a real mesh, not a HUD overlay.
    tube(
      s,
      carbon,
      [
        [-0.29, 0.14, 0.36],
        [-0.34, 0.2, 0],
        [-0.32, 0.23, -0.5],
        [0, 0.27, -0.65],
        [0.32, 0.23, -0.5],
        [0.34, 0.2, 0],
        [0.29, 0.14, 0.36],
      ],
      0.05,
    );
    tube(
      s,
      carbon,
      [
        [-0.31, 0.24, -0.55],
        [-0.33, 0.51, -0.28],
        [-0.25, 0.57, 0.31],
        [0, 0.55, 0.66],
        [0.25, 0.57, 0.31],
        [0.33, 0.51, -0.28],
        [0.31, 0.24, -0.55],
      ],
      0.033,
    );
    rod(s, carbon, new T.Vector3(0, 0.15, 0.63), new T.Vector3(0, 0.55, 0.66), 0.03);
    for (const sign of [-1, 1]) {
      rod(
        s,
        carbon,
        new T.Vector3(sign * 0.29, 0.13, 0.36),
        new T.Vector3(sign * 0.59, 0.29, 0.46),
        0.012,
      );
      const mirror = mesh(s, new T.SphereGeometry(1, 24, 12), this.paint, sign * 0.64, 0.3, 0.46);
      mirror.scale.set(0.12, 0.05, 0.075);
      const glass = mesh(
        this.root,
        new T.PlaneGeometry(0.195, 0.069),
        new T.MeshBasicMaterial({ color: 0xd4dde0 }),
        sign * 0.64,
        0.3,
        0.377,
      );
      glass.rotation.y = Math.PI;
      glass.name = sign < 0 ? 'Right rear-view mirror' : 'Left rear-view mirror';
      glass.castShadow = false;
      this.mirrors.push(glass);
    }
    rod(s, metal, new T.Vector3(0.055, 0.13, 0.93), new T.Vector3(0.055, 0.52, 0.93), 0.004);
    // Multi-element curved wings with endplates and supports.
    for (let j = 0; j < 4; j++) {
      const wing = mesh(
        this.frontWing,
        loft([
          [-0.13, -0.012, 0.004, 0.002],
          [-0.1, 0.018, 0.76, 0.015],
          [0, 0.015, 0.96, 0.018],
          [0.13, -0.014, 0.97, 0.012],
          [0.18, -0.018, 0.005, 0.001],
        ]),
        j === 3 ? this.paint : carbon,
        0,
        -0.32 + j * 0.037,
        2.28 + j * 0.11,
      );
      wing.rotation.x = -0.11;
    }
    for (const sign of [-1, 1]) {
      const plate = mesh(
        this.frontWing,
        loft([
          [-0.35, 0, 0.012, 0.08],
          [0, 0.035, 0.012, 0.09],
          [0.27, 0.04, 0.012, 0.055],
        ]),
        this.paint,
        sign * 0.975,
        -0.3,
        2.42,
      );
      plate.rotation.y = sign * 0.06;
    }
    for (let j = 0; j < 3; j++)
      mesh(
        this.rearWing,
        loft([
          [-0.16, -0.025, 0.01, 0.001],
          [-0.13, 0.006, 0.81, 0.012],
          [0.07, 0.018, 0.83, 0.023],
          [0.19, -0.015, 0.82, 0.007],
          [0.2, -0.017, 0.01, 0.001],
        ]),
        j === 2 ? this.paint : carbon,
        0,
        0.45 + j * 0.078,
        -2.05 + j * 0.04,
      );
    for (const sign of [-1, 1]) {
      box(this.rearWing, this.paint, sign * 0.84, 0.4, -2.03, 0.035, 0.47, 0.56);
      rod(
        this.rearWing,
        carbon,
        new T.Vector3(sign * 0.24, -0.28, -1.9),
        new T.Vector3(sign * 0.24, 0.45, -2.06),
        0.035,
      );
    }
    box(s, carbon, 0, -0.16, -2.05, 1.42, 0.025, 0.26);
    const rain = new T.MeshStandardMaterial({
      color: 0x710000,
      emissive: 0xff1b0a,
      emissiveIntensity: 0.4,
    });
    this.rainLight = rain;
    box(s, rain, 0, -0.23, -2.28, 0.095, 0.065, 0.02);
    // Original car identity and livery: small, deliberate markings on bodywork.
    const logo = new T.MeshBasicMaterial({
      map: label(`APEX / ${String(id + 7).padStart(2, '0')}`, '#182126', '#f4eddf'),
      transparent: false,
    });
    const decal = mesh(s, new T.PlaneGeometry(0.35, 0.105), logo, 0, 0.176, 0.74);
    decal.rotation.x = -Math.PI / 2;
    for (const sign of [-1, 1]) {
      const stripe = box(s, ivory, sign * 0.32, 0.04, 0.4, 0.024, 0.04, 0.9);
      stripe.rotation.y = sign * 0.09;
    }
    // Wheels use articulated pivots; tire geometry follows load-compression telemetry.
    WHEEL_POSITIONS.forEach((p, i) => {
      const pivot = new T.Group(),
        spin = new T.Group();
      pivot.position.set(p[0], -0.183, p[2]);
      pivot.add(spin);
      this.root.add(pivot);
      this.wheelPivots.push(pivot);
      this.wheelSpins.push(spin);
      const half = i < 2 ? 0.155 : 0.19,
        profile = [
          new T.Vector2(0.245, -half),
          new T.Vector2(0.306, -half),
          new T.Vector2(0.331, -half + 0.025),
          new T.Vector2(0.335, -half + 0.065),
          new T.Vector2(0.335, half - 0.065),
          new T.Vector2(0.331, half - 0.025),
          new T.Vector2(0.306, half),
          new T.Vector2(0.245, half),
        ];
      const tread = treadMaterial();
      this.treads.push(tread);
      const tire = mesh(spin, new T.LatheGeometry(profile, 48), tread.material);
      tire.rotation.z = Math.PI / 2;
      const wheel = mesh(
        spin,
        new T.CylinderGeometry(0.246, 0.246, half * 2 + 0.002, 40, 1, true),
        dark,
      );
      wheel.rotation.z = Math.PI / 2;
      const ringMaterial = new T.MeshBasicMaterial({ color: COMPOUNDS.medium.color });
      this.rings.push(ringMaterial);
      for (const side of [-1, 1]) {
        const ring = mesh(
          spin,
          new T.TorusGeometry(0.287, 0.005, 6, 48),
          ringMaterial,
          side * (half + 0.001),
          0,
          0,
        );
        ring.rotation.y = Math.PI / 2;
        const rim = mesh(
          spin,
          new T.TorusGeometry(0.24, 0.011, 8, 40),
          metal,
          side * (half + 0.002),
          0,
          0,
        );
        rim.rotation.y = Math.PI / 2;
        const hub = mesh(
          spin,
          new T.CylinderGeometry(0.046, 0.052, 0.027, 12),
          metal,
          side * (half + 0.008),
          0,
          0,
        );
        hub.rotation.z = Math.PI / 2;
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          rod(
            spin,
            metal,
            new T.Vector3(side * (half + 0.001), Math.sin(a) * 0.052, Math.cos(a) * 0.052),
            new T.Vector3(
              side * (half + 0.001),
              Math.sin(a + 0.13) * 0.23,
              Math.cos(a + 0.13) * 0.23,
            ),
            0.008,
          );
        }
      }
      const discMaterial = new T.MeshStandardMaterial({
        color: 0x4b4a45,
        metalness: 0.6,
        roughness: 0.6,
        emissive: 0xff4d08,
      });
      this.discs.push(discMaterial);
      const disc = mesh(
        pivot,
        new T.CylinderGeometry(0.21, 0.21, 0.014, 40),
        discMaterial,
        0,
        0,
        0,
      );
      disc.rotation.z = Math.PI / 2;
      box(pivot, dark, 0, 0.05, -0.19, 0.11, 0.14, 0.055);
      for (const dy of [-0.075, 0.055])
        for (const dz of [-0.3, 0.3]) {
          const anchor = new T.Vector3(Math.sign(p[0]) * 0.26, dy + 0.03, p[2] + dz),
            end = new T.Vector3(p[0], -0.183 + dy, p[2]);
          const link = new T.Object3D();
          link.position.copy(end);
          this.links.push({ mesh: link, anchor, wheel: i, dy });
        }
      // Merge spokes and tire sections while preserving the spin transform.
      mergeStatic(spin);
    });
    this.suspension = new T.InstancedMesh(
      new T.CylinderGeometry(0.015, 0.015, 1, 8),
      carbon,
      this.links.length,
    );
    this.suspension.castShadow = true;
    this.root.add(this.suspension);
    // Driver and steering assembly; hands are attached to the rotating wheel.
    this.root.add(this.steering, this.helmet);
    this.steering.position.set(0, 0.115, 0.22);
    this.steering.rotation.x = 0.12;
    const steeringMaterial = new T.MeshStandardMaterial({ color: 0x25292b, roughness: 0.78 });
    tube(
      this.steering,
      steeringMaterial,
      [
        [-0.17, 0.045, 0],
        [-0.19, -0.055, 0],
        [-0.1, -0.095, 0],
        [0.1, -0.095, 0],
        [0.19, -0.055, 0],
        [0.17, 0.045, 0],
      ],
      0.022,
    );
    box(this.steering, carbon, 0, 0, 0, 0.29, 0.11, 0.04);
    this.display = canvasTexture(512, 256, (c) => {
      c.fillStyle = '#0c1212';
      c.fillRect(0, 0, 512, 256);
    });
    this.display.userData.dynamic = true;
    this.canvas = this.display.image as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    const screen = mesh(
      this.steering,
      new T.PlaneGeometry(0.17, 0.084),
      new T.MeshBasicMaterial({ map: this.display }),
      0,
      0.01,
      -0.025,
    );
    screen.rotation.y = Math.PI;
    for (let j = 0; j < 10; j++) {
      const material = new T.MeshBasicMaterial({
        color: j < 5 ? 0x6fec9b : j < 8 ? 0xed6540 : 0xaabef8,
      });
      this.shiftLeds.push(material);
      box(this.steering, material, -0.071 + j * 0.016, 0.065, -0.018, 0.01, 0.007, 0.003);
    }
    for (const sign of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const b = mesh(
          this.steering,
          new T.CylinderGeometry(0.009, 0.009, 0.009, 12),
          new T.MeshStandardMaterial({ color: [0xe65739, 0x56b8a6, 0xe6c254][k] }),
          sign * (0.11 + (k % 2) * 0.026),
          0.018 - k * 0.029,
          -0.027,
        );
        b.rotation.x = Math.PI / 2;
      }
    }
    this.driver = new DriverRig(this.steering);
    this.root.add(this.driver.root);

    const head = mesh(this.helmet, new T.SphereGeometry(0.137, 32, 24), ivory, 0, 0.29, -0.38);
    head.scale.set(1, 1.08, 0.99);
    const visor = mesh(
      this.helmet,
      new T.SphereGeometry(0.14, 32, 12, 0, Math.PI, Math.PI * 0.32, Math.PI * 0.28),
      new T.MeshPhysicalMaterial({ color: 0x253b45, metalness: 0.88, roughness: 0.08 }),
      0,
      0.3,
      -0.374,
    );
    visor.rotation.y = Math.PI / 2;
    mergeStatic(s);
    mergeStatic(this.frontWing);
    mergeStatic(this.rearWing);
    const highChildren = [...this.root.children];
    this.root.add(this.highDetail);
    this.highDetail.add(...highChildren);
    for (const level of [1, 2] as const) {
      const reduced = new ReducedCar(level, this.paint, carbon, dark);
      this.reduced.push(reduced);
      reduced.root.visible = false;
      this.root.add(reduced.root);
    }
  }
  setLod(distance: number, quality: 'low' | 'medium' | 'high', player: boolean) {
    this.lodLevel = carLod(distance, this.lodLevel, quality, player);
    this.highDetail.visible = this.lodLevel === 0;
    this.reduced.forEach((car, index) => (car.root.visible = this.lodLevel === index + 1));
  }
  update(
    a: Float32Array,
    b: Float32Array,
    o: number,
    t: number,
    _dt: number,
    time: number,
    cockpit: boolean,
  ) {
    this.root.position.set(
      lerp(a[o + F.X], b[o + F.X], t),
      lerp(a[o + F.Y], b[o + F.Y], t),
      lerp(a[o + F.Z], b[o + F.Z], t),
    );
    this.qa.set(a[o + F.QX], a[o + F.QY], a[o + F.QZ], a[o + F.QW]);
    this.qb.set(b[o + F.QX], b[o + F.QY], b[o + F.QZ], b[o + F.QW]);
    this.root.quaternion.copy(this.qa).slerp(this.qb, t);
    if (this.lodLevel > 0) {
      const reduced = this.reduced[this.lodLevel - 1];
      for (let i = 0; i < 4; i++) {
        const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
        reduced.wheels[i].position.y = 0.05 - (b[p + W.LENGTH] || 0.25);
        reduced.wheels[i].scale.set(
          1,
          (b[p + W.RADIUS] || 0.335) / 0.335,
          (b[p + W.RADIUS] || 0.335) / 0.335,
        );
        reduced.wheels[i].rotation.y = i < 2 ? b[o + F.STEER] : 0;
        reduced.spins[i].rotation.x = b[p + W.ROTATION];
      }
      reduced.front.visible = b[o + F.FRONT_HEALTH] > 0.08;
      reduced.rear.visible = b[o + F.REAR_HEALTH] > 0.08;
      return;
    }
    this.steering.rotation.z = -b[o + F.STEER] * 2.2;
    this.driver.update(time, b[o + F.GEAR], b[o + F.ERS_MODE]);
    this.helmet.visible = !cockpit;
    const compound = Object.values(COMPOUNDS)[Math.round(b[o + F.COMPOUND])] ?? COMPOUNDS.medium;
    for (let i = 0; i < 4; i++) {
      const p = o + WHEEL_BASE + i * WHEEL_STRIDE,
        pivot = this.wheelPivots[i];
      pivot.position.y = 0.05 - (b[p + W.LENGTH] || 0.25);
      pivot.rotation.y =
        (i < 2 ? b[o + F.STEER] : 0) + b[p + W.SUSPENSION_DAMAGE] * 0.07 * (i % 2 ? 1 : -1);
      this.wheelSpins[i].rotation.x = b[p + W.ROTATION];
      this.wheelSpins[i].position.x =
        Math.sign(WHEEL_POSITIONS[i][0]) *
        serviceWheelOffset(b[o + F.PIT_PHASE], b[o + F.PIT_CLOCK], b[p + W.LOAD]);
      this.discs[i].emissiveIntensity = clamp((b[p + W.DISC_TEMP] - 500) / 450, 0, 2);
      this.rings[i].color.setHex(compound.color);
      this.treads[i].condition.value.set(
        b[p + W.DIRT],
        b[p + W.WEAR],
        b[p + W.BLISTERING],
        b[p + W.GRAINING],
      );
      const radius = (b[p + W.RADIUS] || 0.335) / 0.335;
      pivot.scale.z = radius;
      pivot.scale.y =
        radius * (1 - 0.025 * clamp(b[p + W.LOAD] / 7000, 0, 1) - b[p + W.FLAT] * 0.02);
    }
    for (let j = 0; j < this.links.length; j++) {
      const link = this.links[j];
      this.v.copy(this.wheelPivots[link.wheel].position);
      this.v.y += link.dy;
      const length = this.v.distanceTo(link.anchor);
      link.mesh.position.copy(this.v).add(link.anchor).multiplyScalar(0.5);
      link.mesh.quaternion.setFromUnitVectors(this.up, this.v.sub(link.anchor).normalize());
      link.mesh.scale.y = length;
      link.mesh.updateMatrix();
      this.suspension.setMatrixAt(j, link.mesh.matrix);
    }
    this.suspension.instanceMatrix.needsUpdate = true;
    this.frontWing.visible = b[o + F.FRONT_HEALTH] > 0.08;
    this.rearWing.visible = b[o + F.REAR_HEALTH] > 0.08;
    this.frontWing.scale.x = 0.35 + 0.65 * b[o + F.FRONT_HEALTH];
    this.frontWing.rotation.z = (1 - b[o + F.FRONT_HEALTH]) * 0.12;
    this.rearWing.rotation.z = (1 - b[o + F.REAR_HEALTH]) * 0.09;
    this.rainLight.emissiveIntensity =
      b[o + F.BRAKE] > 0.1 ? 2.5 : Math.sin(time * 12) > 0 ? 1.4 : 0.1;
    if (this.id === 0 && this.displayClock.due(b[H.TIME], b[o + F.GEAR])) {
      drawSteeringDisplay(this.ctx, b, o);
      for (let j = 0; j < this.shiftLeds.length; j++)
        this.shiftLeds[j].color.setHex(
          shiftLight(b[o + F.RPM], j) ? (j < 5 ? 0x6fec9b : j < 8 ? 0xed6540 : 0xaabef8) : 0x20292a,
        );
      this.display.needsUpdate = true;
    }
  }
}
