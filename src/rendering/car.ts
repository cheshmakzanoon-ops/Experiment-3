import { addTailMechanicalDetail, addWheelMechanicalDetail, buildHelmet, openFrontCap, addSidepodDuct } from './car-mechanical-detail.ts';
import { addMirrorHousing, apertureGeometry, CockpitControls } from './cockpit.ts';
import { sculptedLoft, wingElement, aeroPlate } from './bodywork.ts';
import { flankLivery, repaintFlank } from './car-livery.ts';
import { validateLivery, type Livery } from '../storage/livery.ts';
import { TireCarcass } from './tire-carcass.ts';
import { wheelPhase, wheelTravel } from './wheel-pose.ts';
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
  readonly carcasses: TireCarcass[] = [];
  readonly discs: T.MeshStandardMaterial[] = [];
  readonly treads: ReturnType<typeof treadMaterial>[] = [];
  readonly rings: T.MeshBasicMaterial[] = [];
  readonly links: { mesh: T.Object3D; anchor: T.Vector3; wheel: number; dy: number }[] = [];
  private suspension: T.InstancedMesh;
  readonly steering = new T.Group();
  readonly cockpitControls: CockpitControls;
  readonly driver: DriverRig;
  readonly helmet = new T.Group();
  readonly rainLight: T.MeshStandardMaterial;
  readonly display: T.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private displayClock = new SteeringDisplayClock();
  readonly shiftLeds: T.InstancedMesh;
  readonly wheelButtons: T.InstancedMesh;
  private indicatorColor = new T.Color();
  readonly paint: T.MeshPhysicalMaterial;
  readonly accent: T.MeshPhysicalMaterial;
  readonly identityTexture: T.CanvasTexture;
  readonly reflectivePaint: T.MeshPhysicalMaterial[] = [];
  private qa = new T.Quaternion();
  private qb = new T.Quaternion();
  private v = new T.Vector3();
  private up = new T.Vector3(0, 1, 0);
  setLivery(value: Livery) {
    const livery = validateLivery(value);
    this.paint.color.set(livery.primary);
    this.accent.color.set(livery.accent);
    for (const material of this.reflectivePaint) repaintFlank(material, this.id, livery);
    const canvas = this.identityTexture.image as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#f4eddf';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#182126';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = `800 ${Math.round(canvas.height * 0.54)}px Arial`;
      context.fillText(
        `${livery.sponsor} / ${String(livery.number).padStart(2, '0')}`,
        canvas.width / 2,
        canvas.height / 2,
        canvas.width * 0.92,
      );
      this.identityTexture.needsUpdate = true;
    }
  }
  constructor(readonly id: number) {
    this.root.name = `Formula ${id + 1}`;
    this.root.add(this.staticBody, this.frontWing, this.rearWing);
    const s = this.staticBody;
    this.paint = new T.MeshPhysicalMaterial({
      color: LIVERIES[id % LIVERIES.length],
      metalness: 0.2,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.16,
    });
    this.reflectivePaint.push(this.paint);
    const carbon = carbonMaterial();
    const dark = new T.MeshStandardMaterial({ color: 0x101416, roughness: 0.75 });
    const metal = new T.MeshStandardMaterial({ color: 0x7c8589, metalness: 0.88, roughness: 0.3 });
    const ivory = new T.MeshPhysicalMaterial({
      color: 0xe7e1d2,
      roughness: 0.3,
      metalness: 0.18,
      clearcoat: 1,
    });
    this.accent = ivory;
    // Venturi floor, sculpted monocoque, narrow nose and smoothly undercut sidepods.
    mesh(
      s,
      sculptedLoft([
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
      sculptedLoft([
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
      const livery = flankLivery(this.paint, sign, id);
      this.reflectivePaint.push(livery);
      const pod = mesh(
        s,
        openFrontCap(sculptedLoft(
          [
            [-1.75, -0.22, 0.065, 0.08],
            [-1.35, -0.17, 0.175, 0.145],
            [-0.8, -0.095, 0.29, 0.17],
            [-0.2, -0.025, 0.31, 0.17],
            [0.25, 0.005, 0.28, 0.135],
            [0.39, 0.025, 0.225, 0.075],
          ],
          0.42,
          0.65,
        )),
        livery,
        sign * 0.53,
        0,
        0,
      );
      pod.rotation.z = sign * -0.08;
      addSidepodDuct(s, sign, { carbon, dark, metal, paint: this.paint });
      for (let j = 0; j < 4; j++) {
        const bolt = mesh(
          s,
          new T.CylinderGeometry(0.003, 0.003, 0.002, 6),
          metal,
          sign * (0.41 + j * 0.09),
          0.119,
          0.235,
        );
        bolt.rotation.x = 0.08;
      }
      for (let j = 0; j < 8; j++)
        box(
          s,
          carbon,
          sign * 0.66,
          0.135 - j * 0.009,
          -0.25 - j * 0.09,
          0.18,
          0.008,
          0.025,
        ).rotation.z = sign * 0.14;
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
      sculptedLoft([
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
      const glass = addMirrorHousing(s, this.paint, carbon, sign);
      // Batch the lit shell/bezel with the body, but keep the rear-camera feed
      // independently owned. attach preserves its housing-space placement.
      this.root.attach(glass);
      this.mirrors.push(glass);
    }
    rod(s, metal, new T.Vector3(0.055, 0.13, 0.93), new T.Vector3(0.055, 0.52, 0.93), 0.004);
    // Swept thin airfoils, open slots and bevelled endplates. The entire wing
    // remains owned by its existing damage articulation group.
    for (let j = 0; j < 4; j++) {
      mesh(
        this.frontWing,
        wingElement(1.94 - j * 0.018, j === 0 ? 0.34 : 0.2, 0.025 + j * 0.007, 0.015, 0.08, 0.028),
        j === 3 ? this.paint : carbon,
        0,
        -0.325 + j * 0.043,
        2.48 - j * 0.14,
      );
    }
    for (const sign of [-1, 1]) {
      mesh(
        this.frontWing,
        aeroPlate(
          [
            [2.04, -0.36],
            [2.64, -0.36],
            [2.68, -0.22],
            [2.51, -0.18],
            [2.11, -0.21],
            [2.02, -0.29],
          ],
          0.018,
        ),
        this.paint,
        sign * 0.973,
      );
      // Slotted cascade brackets at each outboard flap.
      for (let j = 0; j < 3; j++)
        box(
          this.frontWing,
          carbon,
          sign * 0.73,
          -0.285 + j * 0.043,
          2.37 - j * 0.14,
          0.012,
          0.072,
          0.08,
        );
    }
    mesh(
      this.rearWing,
      wingElement(1.65, 0.42, 0.048, 0.022, 0.025, 0.015),
      carbon,
      0,
      0.49,
      -1.99,
    );
    mesh(
      this.rearWing,
      wingElement(1.64, 0.22, 0.045, 0.016, 0.02, 0.012),
      this.paint,
      0,
      0.65,
      -2.18,
    );
    for (const sign of [-1, 1]) {
      mesh(
        this.rearWing,
        aeroPlate(
          [
            [-2.34, 0.2],
            [-1.94, 0.18],
            [-1.75, 0.39],
            [-1.77, 0.63],
            [-1.98, 0.72],
            [-2.31, 0.72],
          ],
          0.024,
        ),
        this.paint,
        sign * 0.839,
      );
      rod(
        this.rearWing,
        carbon,
        new T.Vector3(sign * 0.24, -0.28, -1.9),
        new T.Vector3(sign * 0.24, 0.48, -2.04),
        0.028,
      );
      for (let j = 0; j < 3; j++)
        box(this.rearWing, carbon, sign * 0.858, 0.34 + j * 0.047, -2.12, 0.012, 0.009, 0.17);
    }
    mesh(s, wingElement(1.41, 0.23, 0.018, 0.011, 0.015, 0.008), carbon, 0, -0.12, -2.06);
    mesh(s, wingElement(1.36, 0.17, 0.018, 0.009, 0.02, 0.009), carbon, 0, -0.05, -2.18);
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
    this.identityTexture = logo.map as T.CanvasTexture;
    this.identityTexture.userData.dynamic = true;
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
      const half = i < 2 ? 0.155 : 0.19;
      const tread = treadMaterial();
      this.treads.push(tread);
      const wheel = mesh(
        spin,
        new T.CylinderGeometry(0.246, 0.246, half * 2 + 0.002, 40, 1, true),
        dark,
      );
      wheel.rotation.z = Math.PI / 2;
      const ringMaterial = new T.MeshBasicMaterial({ color: COMPOUNDS.medium.color });
      this.rings.push(ringMaterial);
      for (const side of [-1, 1]) {
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
      const carrierDetails = new T.Group();
      pivot.add(carrierDetails);
      const disc = mesh(
        carrierDetails,
        new T.CylinderGeometry(0.21, 0.21, 0.014, 40),
        discMaterial,
        0,
        0,
        0,
      );
      disc.rotation.z = Math.PI / 2;
      box(carrierDetails, dark, 0, 0.05, -0.19, 0.11, 0.14, 0.055);
      for (const dy of [-0.075, 0.055])
        for (const dz of [-0.3, 0.3]) {
          const anchor = new T.Vector3(Math.sign(p[0]) * 0.26, dy + 0.03, p[2] + dz),
            end = new T.Vector3(p[0], -0.183 + dy, p[2]);
          const link = new T.Object3D();
          link.position.copy(end);
          this.links.push({ mesh: link, anchor, wheel: i, dy });
        }
      // Rigid aero cover and machined hub detail spin with the rim, never with
      // the deforming contact patch. The compound rings remain on the carcass.
      const outside = Math.sign(p[0]);
      const cover = mesh(
        spin,
        new T.RingGeometry(0.052, 0.228, 48, 3),
        carbon,
        outside * (half + 0.007),
        0,
        0,
      );
      cover.rotation.y = (outside * Math.PI) / 2;
      const centreRing = mesh(
        spin,
        new T.TorusGeometry(0.049, 0.006, 8, 32),
        metal,
        outside * (half + 0.009),
        0,
        0,
      );
      centreRing.rotation.y = Math.PI / 2;
      for (let j = 0; j < 10; j++) {
        const angle = (j / 10) * Math.PI * 2;
        const fastener = mesh(
          spin,
          new T.CylinderGeometry(0.004, 0.004, 0.004, 6),
          metal,
          outside * (half + 0.012),
          Math.cos(angle) * 0.193,
          Math.sin(angle) * 0.193,
        );
        fastener.rotation.z = Math.PI / 2;
      }
      addWheelMechanicalDetail(carrierDetails, spin, outside, half, { carbon, dark, metal, paint: this.paint });
      mergeStatic(carrierDetails);
      // Batch only the rigid wheel. Rubber must remain independently deformable.
      mergeStatic(spin);
      const carcass = new TireCarcass(half, tread.material, ringMaterial);
      this.carcasses.push(carcass);
      spin.add(carcass.root);
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
    this.cockpitControls = new CockpitControls(this.steering, carbon);
    this.display = canvasTexture(512, 256, (c) => {
      c.fillStyle = '#0c1212';
      c.fillRect(0, 0, 512, 256);
    });
    this.display.userData.dynamic = true;
    this.canvas = this.display.image as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    const screen = mesh(
      this.steering,
      apertureGeometry(0.182, 0.09, 0.004),
      new T.MeshBasicMaterial({ map: this.display }),
      0,
      0.014,
      -0.028,
    );
    screen.rotation.y = Math.PI;
    // Identical controls share geometry/material submissions, not state. Each
    // LED retains its own linear-space colour and each button its exact pose.
    this.shiftLeds = new T.InstancedMesh(
      new T.BoxGeometry(0.01, 0.005, 0.003), new T.MeshBasicMaterial(), 10,
    );
    this.shiftLeds.name = 'Individual RPM LEDs (one submission)';
    this.wheelButtons = new T.InstancedMesh(
      new T.CylinderGeometry(0.009, 0.009, 0.009, 12), new T.MeshStandardMaterial(), 6,
    );
    this.wheelButtons.name = 'Original wheel buttons (one submission)';
    const indicator = new T.Object3D();
    for (let j = 0; j < 10; j++) {
      indicator.position.set(-0.071 + j * 0.016, 0.074, -0.018);
      indicator.updateMatrix();
      this.shiftLeds.setMatrixAt(j, indicator.matrix);
      this.shiftLeds.setColorAt(j, this.indicatorColor.setHex(j < 5 ? 0x6fec9b : j < 8 ? 0xed6540 : 0xaabef8));
    }
    this.shiftLeds.instanceColor!.setUsage(T.DynamicDrawUsage);
    let button = 0;
    indicator.rotation.x = Math.PI / 2;
    for (const sign of [-1, 1]) for (let k = 0; k < 3; k++) {
      indicator.position.set(sign * (0.117 + (k % 2) * 0.026), 0.037 - k * 0.028, -0.027);
      indicator.updateMatrix();
      this.wheelButtons.setMatrixAt(button, indicator.matrix);
      this.wheelButtons.setColorAt(button++, this.indicatorColor.setHex([0xe65739, 0x56b8a6, 0xe6c254][k]));
    }
    for (const controls of [this.shiftLeds, this.wheelButtons]) {
      controls.castShadow = true;
      controls.receiveShadow = true;
      controls.computeBoundingBox(); controls.computeBoundingSphere();
      this.steering.add(controls);
    }
    this.driver = new DriverRig(this.steering);
    this.root.add(this.driver.root);

    buildHelmet(this.helmet, { carbon, dark, metal, paint: ivory });
    addTailMechanicalDetail(s, { carbon, dark, metal, paint: this.paint });
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
        reduced.wheels[i].position.y = 0.05 - wheelTravel(a, b, p, t);
        const radius = (lerp(a[p + W.RADIUS], b[p + W.RADIUS], t) || 0.335) / 0.335;
        // The reduced cylinder's axle is local Y; neither rim nor hub scales.
        reduced.tires[i].scale.set(radius, 1, radius);
        reduced.wheels[i].rotation.y = lerp(a[p + W.STEER], b[p + W.STEER], t);
        reduced.wheels[i].rotation.z = -lerp(a[p + W.CAMBER], b[p + W.CAMBER], t);
        reduced.spins[i].rotation.x = wheelPhase(a, b, o, p, t);
      }
      reduced.front.visible = b[o + F.FRONT_HEALTH] > 0.08;
      reduced.rear.visible = b[o + F.REAR_HEALTH] > 0.08;
      return;
    }
    this.steering.rotation.z = -lerp(a[o + F.STEER], b[o + F.STEER], t) * 2.2;
    this.driver.update(time, b[o + F.GEAR], b[o + F.ERS_MODE],
      lerp(a[o + F.G_LAT], b[o + F.G_LAT], t),
      lerp(a[o + F.G_LONG], b[o + F.G_LONG], t),
      lerp(a[o + F.G_VERT], b[o + F.G_VERT], t));
    this.helmet.rotation.set(this.driver.headPitch, 0, this.driver.headRoll);
    this.cockpitControls.update(b, o);
    this.helmet.visible = !cockpit;
    const compound = Object.values(COMPOUNDS)[Math.round(b[o + F.COMPOUND])] ?? COMPOUNDS.medium;
    for (let i = 0; i < 4; i++) {
      const p = o + WHEEL_BASE + i * WHEEL_STRIDE,
        pivot = this.wheelPivots[i];
      pivot.position.y = 0.05 - wheelTravel(a, b, p, t);
      pivot.rotation.y = lerp(a[p + W.STEER], b[p + W.STEER], t);
      // Tire-force camber is signed about the rolling direction; the visual
      // axle uses the opposite local-Z rotation. Negative setup camber leans in.
      pivot.rotation.z = -lerp(a[p + W.CAMBER], b[p + W.CAMBER], t);
      this.wheelSpins[i].rotation.x = wheelPhase(a, b, o, p, t);
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
      this.carcasses[i].update(
        this.wheelSpins[i].rotation.x,
        lerp(a[p + W.RADIUS], b[p + W.RADIUS], t),
        lerp(a[p + W.LOAD], b[p + W.LOAD], t),
        lerp(a[p + W.PRESSURE], b[p + W.PRESSURE], t),
        lerp(a[p + W.FLAT], b[p + W.FLAT], t),
      );
    }
    for (let j = 0; j < this.links.length; j++) {
      const link = this.links[j];
      const pivot = this.wheelPivots[link.wheel];
      this.v.set(0, link.dy, 0).applyQuaternion(pivot.quaternion).add(pivot.position);
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
      for (let j = 0; j < this.shiftLeds.count; j++)
        this.shiftLeds.setColorAt(j, this.indicatorColor.setHex(
          shiftLight(b[o + F.RPM], j) ? (j < 5 ? 0x6fec9b : j < 8 ? 0xed6540 : 0xaabef8) : 0x20292a,
        ));
      this.shiftLeds.instanceColor!.needsUpdate = true;
      this.display.needsUpdate = true;
    }
  }
}
