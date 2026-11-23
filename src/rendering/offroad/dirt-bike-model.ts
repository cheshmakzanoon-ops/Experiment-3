import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { VehicleDefinition } from '../../simulation/vehicles.ts';
import {
  add,
  exhaustGeometry,
  tube,
  tyreGeometry,
  type BikeMaterials,
  type BikePoseValues,
} from '../bike.ts';
import { liveryScheme } from '../car-livery.ts';
import { tagWeatherSurface } from '../weather-presentation.ts';
import { Rider, type RiderDetail } from '../rider.ts';
import { installMudOn, tagMudExposure, type MudUniforms } from './mud.ts';
import { MxPresentationRoot } from './mx-presentation-root.ts';
import {
  MotocrossAxles,
  MX_AXLE_OFFSET as OFFSET,
  MX_RAKE as RAKE,
  MX_TREAD_PAIRS,
} from './motocross-axles.ts';
import { forkLocalOffset } from '../bike-pit-service.ts';
import { batchBikeRigidMeshes } from '../bike-rigid-batch.ts';
import { MotocrossChainDrive, distantMotocrossChain } from './motocross-chain-drive.ts';
import { addMotocrossRadiators } from './motocross-radiators.ts';
import { motocrossRim, motocrossRimFittings, motocrossWheelHub, motocrossWheelSpokes } from './motocross-wheel-detail.ts';
import { installMotocrossMetalFinish } from './motocross-metal-finish.ts';
import {
  bindMotocrossTyre,
  installMotocrossTyreFinish,
  type MotocrossTyreFinish,
} from './motocross-tyre-finish.ts';
import {
  addMotocrossPowertrain,
  motocrossAxleLug,
  motocrossExpansionChamber,
  motocrossFourStrokeHeader,
  motocrossHeaderFlange,
  motocrossFrameSpar,
  motocrossSilencerOutlet,
  motocrossSumpGuard,
  motocrossSwingarmRail,
  addMotocrossChainGuides,
  addMotocrossAxleAdjusters,
} from './motocross-castings.ts';
import {
  addMotocrossBrakeCaliper,
  MotocrossBrakeHose,
  MotocrossRearShock,
} from './motocross-mechanics.ts';
import { addMotocrossHandguards } from './motocross-handguard.ts';
import { MotocrossShockLinkage } from './motocross-shock-linkage.ts';
import { applyMxAssemblyOcclusion } from './mx-assembly-occlusion.ts';
import { mxCrossbarPad } from './motocross-bar-pad.ts';
import { mxFenderLoad, prepareMxFenderFlex } from './mx-fender-flex.ts';
import { MX_SILENCER_MOUNT, mxSilencerHanger, mxSilencerSleeve } from './mx-silencer.ts';
import { mxNumberBoard, mxNumberBoardBack, mxSideNumberPlate, mxSidePlateMounts } from './motocross-number-board.ts';
import { MotocrossFootControls, motocrossRearBrakeLine, MX_PEG } from './motocross-foot-controls.ts';
import {
  addMotocrossControlMounts,
  motocrossGrip,
  motocrossLeverBlade,
} from './motocross-handlebar.ts';
import { motocrossTravelYaw } from './motocross-rider-motion.ts';
import { motocrossThrottleAngle } from './motocross-rider-contact.ts';
import { mapMxKitPanel, mxKitTexture } from './motocross-graphics-kit.ts';
import { mapUnprintedPlateBack } from './number-plate-uv.ts';
import {
  motocrossAirbox,
  motocrossMudFlap,
  mxMudFlapLoad,
  motocrossSeat,
  motocrossSeatPleats,
  motocrossTankShell,
  motocrossTankTop,
} from './motocross-bodywork.ts';
import {
  motocrossGraphics,
  MX_PRINT_SCALE,
  motocrossRadiatorShroud,
  motocrossRotor,
  motocrossTread,
  motocrossFender,
  motocrossForkGuard,
  motocrossForkOuter,
  motocrossTripleClamp,
  mouldedPanel,
  installMotocrossPlasticFinish,
} from './motocross-detail.ts';

function mxRotorEmission(temperature: number | undefined) {
  if (!Number.isFinite(temperature)) return 0;
  const t = T.MathUtils.clamp((temperature! - 530) / 370, 0, 1);
  return 0.55 * t * t * (3 - 2 * t);
}

/** Off-road motorcycle geometry (m): a 27 degree rake, a long fork with
 * ~300 mm of travel between the axle and the lower clamp, and the rider's
 * contact points for a standing-friendly riding position. */
const CLAMPS = 0.2;
/**
 * Procedural motocross / supercross / supermoto bike (WP41 presentation).
 * Original design, no real manufacturer: a steel perimeter frame and
 * aluminium swingarm, single-cylinder engine with radiators behind wing
 * shrouds, a high beak-less front fender on the lower clamp, a long
 * upswept rear fender, number boards front and side, a flat long seat, a
 * long upside-down fork with plastic guards, spoked wheels and knobby tyres
 * (treaded road tyres on the supermoto), and an off-road rider who stands
 * and dabs from the snapshot. Same pose contract and LOD levels as the road
 * bike; a mud coat follows the entrant's O.MUD.
 */
export class DirtBikeModel {
  readonly root: T.Group = new MxPresentationRoot(true);
  readonly sprung = new T.Group();
  readonly rider: Rider;
  readonly probeSurfaces: readonly T.MeshStandardMaterial[];
  /** Sight points on the authored control geometry, following steering. */
  readonly onboardControls = new T.Group();
  private readonly steerMount = new T.Group();
  private readonly steer = new T.Group();
  /** Real right-hand lever pivot. The clutch remains unactuated: the current
   * presented bike-pose contract has no clutch channel. */
  private readonly frontRotor: T.MeshPhysicalMaterial;
  private readonly rearRotor: T.MeshPhysicalMaterial;
  private readonly frontBrakeLever = new T.Group();
  private readonly throttleTube = new T.Group();
  private readonly forkLower = new T.Group();
  private readonly frontSpin = new T.Group();
  private readonly rearWheel = new T.Group();
  private readonly rearSpin = new T.Group();
  private readonly swingarm = new T.Group();
  private readonly rearBrake = new T.Group();
  private readonly shock?: MotocrossRearShock;
  private readonly shockLinkage?: MotocrossShockLinkage;
  private readonly footControls?: MotocrossFootControls;
  private readonly brakeHose?: MotocrossBrakeHose;
  private readonly rearBrakeLine?: T.SkinnedMesh;
  private readonly mudFlap?: T.Mesh;
  private readonly shockUpper = new T.Vector3(0, -0.02, -0.29);
  private readonly shockLower = new T.Vector3();
  private readonly upperEye = new T.Vector3();
  private readonly lowerEye = new T.Vector3();
  private readonly frontFender: T.Mesh;
  private readonly rearFender: T.Mesh;
  private readonly axles: MotocrossAxles;
  private readonly gripLocal = [new T.Vector3(), new T.Vector3()];
  private readonly scratch = new T.Vector3();
  private readonly matrix = new T.Matrix4();
  private readonly plastics: T.MeshStandardMaterial[] = [];
  private readonly chain?: MotocrossChainDrive;
  private readonly tyreFinish?: MotocrossTyreFinish;
  private disposed = false;
  constructor(
    readonly definition: VehicleDefinition,
    readonly id: number,
    readonly detail: RiderDetail,
    private readonly m: BikeMaterials,
    private readonly mud: MudUniforms,
  ) {
    const b = definition.bike!,
      sides = detail === 'high' ? 36 : detail === 'mid' ? 18 : 10,
      supermoto = definition.tireFamily === 'supermoto',
      scheme = liveryScheme(id);
    const colours = {
      primary: new T.Color(scheme.primary).getHex(),
      secondary: new T.Color(scheme.secondary).getHex(),
      accent: new T.Color(scheme.accent).getHex(),
      team: scheme,
    };
    this.axles = MotocrossAxles.of(definition);
    this.root.name = `${definition.name} ${id + 1} (${detail})`;
    this.root.add(this.sprung);
    // Moulded polypropylene with its glossy in-mould skin: a soft primary
    // lobe under a sharper surface reflection (wear and scuffs dull it).
    const plastic = (color: T.ColorRepresentation, name: string) => {
      const mat = new T.MeshPhysicalMaterial({
        color,
        roughness: 0.37,
        metalness: 0,
        clearcoat: 0.5,
        clearcoatRoughness: 0.2,
        name,
      });
      this.plastics.push(mat);
      return mat;
    };
    const primary = plastic(scheme.primary, 'Off-road plastics'),
      dark = plastic(0x1c1d20, 'Off-road black plastics'),
      board = new T.MeshPhysicalMaterial({
        map: motocrossGraphics(colours, 'number', (id % 98) + 2, MX_PRINT_SCALE[detail]),
        roughness: 0.4,
        clearcoat: 0.28,
        clearcoatRoughness: 0.3,
        name: 'Motocross factory number board',
      });
    this.plastics.push(board);
    tagMudExposure(board, 0.82);
    const shroudMaterial = primary.clone();
    shroudMaterial.color.setHex(0xffffff);
    shroudMaterial.map = mxKitTexture(colours, definition.id, detail);
    shroudMaterial.name = 'Motocross layered factory plastics';
    const rimMaterial = new T.MeshPhysicalMaterial({
      color: id % 2 ? scheme.primary : 0x33383b,
      metalness: 0.8,
      roughness: 0.32,
      clearcoat: 0.35,
      clearcoatRoughness: 0.22,
      name: 'Motocross anodised rim and hub',
    });
    this.frontRotor = new T.MeshPhysicalMaterial({
      color: 0xa3a7a8,
      metalness: 0.88,
      roughness: 0.35,
      clearcoat: 0.15,
      clearcoatRoughness: 0.28,
      name: 'Motocross stainless wave rotor',
      emissive: 0xb64017,
      emissiveIntensity: 0,
    });
    this.rearRotor = this.frontRotor.clone();
    this.rearRotor.name = 'Motocross rear stainless wave rotor';
    const chainMaterial = new T.MeshStandardMaterial({
      color: 0x938165,
      metalness: 0.78,
      roughness: 0.48,
      name: 'Motocross roller chain',
    });
    // The road material carries a GP drainage shader and its vertex contract.
    // MX owns its knobby rubber finish while reusing only the existing grain
    // textures; their lifetime remains with BikeMaterials, not this LOD.
    const tyreMaterial = new T.MeshStandardMaterial({
      color: 0x171916,
      roughness: 0.91,
      normalMap: this.m.rubber.normalMap,
      roughnessMap: this.m.rubber.roughnessMap,
      normalScale: new T.Vector2(0.11, 0.11),
      name: 'Motocross moulded knobby rubber',
    });
    const castMaterial = new T.MeshStandardMaterial({
      color: 0x92938d,
      metalness: 0.78,
      roughness: 0.59,
      name: 'Motocross cast aluminium water-cooled engine',
    });
    const magnesiumMaterial = new T.MeshStandardMaterial({
      color: 0x5e5b54,
      metalness: 0.66,
      roughness: 0.56,
      name: 'Motocross magnesium engine cover',
    });
    // Twin-spar frame, subframe and swingarm: polished-then-brushed
    // aluminium. The anisotropic lobe streaks highlights along each tube's
    // length (its UV direction) instead of the shared frame alloy's round
    // hotspot. Distant LODs keep the shared material and program.
    const brushedAlloy =
      detail === 'far'
        ? this.m.aluminium
        : new T.MeshPhysicalMaterial({
            color: 0xc3c6c8,
            metalness: 1,
            roughness: 0.27,
            anisotropy: 0.65,
            clearcoat: 0.12,
            clearcoatRoughness: 0.18,
            name: 'Motocross brushed aluminium frame and swingarm',
          });
    if (brushedAlloy !== this.m.aluminium) {
      this.plastics.push(brushedAlloy);
      tagWeatherSurface(brushedAlloy, 'metal', 0.6);
    }
    this.plastics.push(
      shroudMaterial,
      rimMaterial,
      this.frontRotor,
      this.rearRotor,
      chainMaterial,
      tyreMaterial,
      castMaterial,
      magnesiumMaterial,
    );
    // These finishes are actually visible on the ridden machine. A local
    // venue capture travels with this entrant through follow and replay cuts.
    this.probeSurfaces = [shroudMaterial, rimMaterial, brushedAlloy, m.forkUpper];
    // Engine cases are partly sheltered by the shrouds and frame. Use the
    // existing recorded-weather response with an authored exposure, while
    // deposited mud continues to come from this entrant's own coat state.
    tagWeatherSurface(castMaterial, 'metal', 0.4);
    tagWeatherSurface(magnesiumMaterial, 'metal', 0.4);
    if (detail !== 'far') {
      installMotocrossMetalFinish(castMaterial, 'aluminium');
      installMotocrossMetalFinish(magnesiumMaterial, 'magnesium');
    }
    if (detail !== 'far')
      for (const material of [primary, dark, board, shroudMaterial])
        installMotocrossPlasticFinish(material);
    // ---- Wheels: spoked rims and knobby (or treaded road) tyres.
    const frontR = b.frontWheelRadius,
      rearR = b.rearWheelRadius,
      frontRim = supermoto ? 0.2159 : 0.2667,
      rearRim = supermoto ? 0.2159 : 0.2286,
      frontDiscRadius = supermoto ? 0.16 : 0.131;
    this.tyreFinish = installMotocrossTyreFinish(
      tyreMaterial,
      frontR,
      frontRim,
      rearR,
      rearRim,
      this.mud,
      supermoto ? 'road' : 'knobby',
      detail !== 'far',
    );
    // Both the knobby and the 17-inch supermoto wheels use crossed stainless wire.
    // Keep the moving-wire shader off the shared steel used by fixed hardware.
    const spokeMetal = detail === 'far' ? m.steel : new T.MeshStandardMaterial({
      name: 'Motocross stainless spoke wire',
      color: m.steel.color, metalness: m.steel.metalness, roughness: m.steel.roughness,
    });
    if (detail !== 'far') this.plastics.push(spokeMetal);
    const wheel = (
      spin: T.Group,
      radius: number,
      rim: number,
      halfWidth: number,
      front: boolean,
    ) => {
      // Retain the crest radius through each LOD. Distant knobbies have
      // depth but a shallower relief to limit sparkle on a moving opponent.
      const knob = supermoto ? 0 : detail === 'far' ? 0.009 : 0.016;
      const wheelSides = detail === 'far' ? 24 : sides;
      const carcass = tyreGeometry(
        radius - knob,
        halfWidth,
        halfWidth * 1.15,
        rim + 0.012,
        wheelSides,
      );
      add(spin, bindMotocrossTyre(carcass, front), tyreMaterial);
      if (knob > 0)
        add(
          spin,
          bindMotocrossTyre(
            motocrossTread(
              radius,
              halfWidth,
              knob,
              detail === 'high' ? MX_TREAD_PAIRS * 2 : detail === 'mid' ? 24 : 20,
              front ? 'front' : 'rear',
              detail === 'far',
              wheelSides,
            ),
            front,
          ),
          tyreMaterial,
        );
      // Rim hoop, hub and spokes.
      if (!supermoto) {
        add(spin, motocrossRim(rim, halfWidth, wheelSides), rimMaterial).name =
          'Motocross rolled bead seat and drop-centre rim';
        if (detail !== 'far')
          add(spin, motocrossRimFittings(rim, front, detail), m.aluminium).name =
            'Motocross valve and mechanical bead lock';
      } else {
        const hoop = add(
          spin,
          new T.CylinderGeometry(rim, rim, 0.033, wheelSides, 1, true),
          rimMaterial,
        );
        hoop.rotation.z = Math.PI / 2;
        for (const side of [-1, 1]) {
          const lip = add(
            spin,
            new T.TorusGeometry(rim, 0.006, 6, wheelSides),
            rimMaterial,
            side * 0.019,
          );
          lip.rotation.y = Math.PI / 2;
        }
      }
      if (detail === 'far') {
        add(spin, new T.CylinderGeometry(0.034, 0.034, 0.092, 12), rimMaterial).rotation.z =
          Math.PI / 2;
        // Preserve the wheel's open construction. These coarse crossed spokes
        // merge with the hub and rim into their existing distant draw.
        add(spin, motocrossWheelSpokes(rim, detail), rimMaterial);
      } else {
        add(spin, motocrossWheelHub(detail), rimMaterial);
        const wires = motocrossWheelSpokes(rim, detail, halfWidth);
        add(spin, wires, spokeMetal, 0, 0, 0, false);
        const exposure = m.wheelExposure.layer(
          wires, spokeMetal, 'cross-laced motocross', rim, halfWidth,
          (this.axles.frontWidth + this.axles.rearWidth) / 2, front, detail, rim - 0.001,
        )!;
        // Preserve independent visibility and keep the optical sheet out of
        // mechanical inspection rays and the batched rim geometry.
        const optical = new T.Group();
        optical.add(exposure);
        spin.add(optical);
      }
      add(
        spin,
        motocrossRotor(front ? frontDiscRadius : 0.117, detail, false, front ? 0.131 : 0.117),
        front ? this.frontRotor : this.rearRotor,
        front ? 0.056 : -0.06,
      );
      if (!front) add(spin, motocrossRotor(0.115, detail, true), chainMaterial, 0.095);
      if (detail === 'high')
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          add(
            spin,
            new T.CylinderGeometry(0.004, 0.004, 0.006, 6),
            this.m.aluminium,
            front ? 0.06 : -0.064,
            Math.cos(a) * 0.061,
            Math.sin(a) * 0.061,
          ).rotation.z = Math.PI / 2;
        }
    };
    // ---- Steering: a long fork on a 27 degree head.
    const head = this.axles.head;
    this.steerMount.position.copy(head);
    this.steerMount.rotation.x = -RAKE;
    this.sprung.add(this.steerMount);
    this.steerMount.add(this.steer);
    this.onboardControls.name = 'Motocross onboard control sights';
    this.steer.add(this.onboardControls);
    const controlSight = (name: string, x: number, y: number, z: number) => {
      const point = new T.Object3D();
      point.name = name;
      point.position.set(x, y, z);
      this.onboardControls.add(point);
    };
    // Outer fork tubes (anodised) through the clamps.
    for (const side of [1, -1]) {
      const x = side * 0.095;
      if (supermoto || detail === 'far') {
        add(this.steer, new T.CylinderGeometry(0.03, 0.03, 0.6, sides / 2),
          this.m.forkUpper, x, -0.08, OFFSET);
        continue;
      }
      const { tube, wiper } = motocrossForkOuter(detail);
      add(this.steer, tube, this.m.forkUpper, x, 0, OFFSET);
      add(this.steer, wiper, this.m.dark, x, 0, OFFSET);
      // A threaded cap closes each outer tube above its clamp. The hex head
      // and adjuster are visible between the bars from the rider's eye.
      add(this.steer, new T.CylinderGeometry(0.028, 0.029, 0.004, 12),
        this.m.aluminium, x, 0.22, OFFSET);
      add(this.steer, new T.CylinderGeometry(0.018, 0.019, 0.005, 6),
        this.m.aluminium, x, 0.224, OFFSET);
      if (detail === 'high')
        add(this.steer, new T.CylinderGeometry(0.006, 0.0075, 0.003, 8),
          this.m.steel, x, 0.227, OFFSET);
    }
    if (detail === 'far') {
      add(this.steer, new T.BoxGeometry(0.24, 0.035, 0.08), this.m.aluminium, 0, 0, OFFSET * 0.5);
      add(
        this.steer,
        new T.BoxGeometry(0.24, 0.03, 0.07),
        this.m.aluminium,
        0,
        CLAMPS,
        OFFSET * 0.5,
      );
    } else {
      add(this.steer, motocrossTripleClamp(detail, 0.035, OFFSET), this.m.aluminium);
      add(this.steer, motocrossTripleClamp(detail, 0.03, OFFSET), this.m.aluminium, 0, CLAMPS);
      add(this.steer, new T.CylinderGeometry(0.0115, 0.0115, 0.244, 12), this.m.steel, 0, 0.1);
    }
    // Tapered bar on risers, crossbar pad, grips and levers.
    const barY = CLAMPS + 0.09,
      barZ = -0.06;
    controlSight('Motocross bar pad', 0, barY + 0.012, barZ + 0.03);
    add(
      this.steer,
      tube(
        [
          [-0.42, barY, barZ],
          [-0.28, barY, barZ + 0.01],
          [-0.17, barY - 0.044, barZ + 0.032],
          [0, barY - 0.05, barZ + 0.032],
          [0.17, barY - 0.044, barZ + 0.032],
          [0.28, barY, barZ + 0.01],
          [0.42, barY, barZ],
        ],
        0.012,
        detail === 'high' ? 36 : 16,
        8,
      ),
      this.m.aluminium,
    );
    // A real crossbrace connects both bar rises and supports the foam pad.
    add(
      this.steer,
      tube(
        [
          [-0.23, barY - 0.015, barZ + 0.023],
          [-0.17, barY + 0.01, barZ + 0.028],
          [0.17, barY + 0.01, barZ + 0.028],
          [0.23, barY - 0.015, barZ + 0.023],
        ],
        0.007,
        detail === 'far' ? 6 : 14,
        6,
      ),
      this.m.aluminium,
    );
    const compact = definition.id === 'mx250';
    if (supermoto) {
      const pad = new RoundedBoxGeometry(0.232, 0.06, 0.068, 1, 0.018);
      const p = pad.getAttribute('position'), uv = pad.getAttribute('uv');
      for (let i = 0; i < p.count; i++)
        uv.setXY(i, 0.5 - 8 * (p.getY(i) + p.getZ(i)), 0.5 - p.getX(i) / 0.232);
      add(this.steer, mapMxKitPanel(pad, 'bar', () => true), shroudMaterial, 0, barY + 0.012, barZ + 0.03);
    } else {
      const vinyl = new T.MeshPhysicalMaterial({ name: 'MX stitched crossbar pad cover',
        map: shroudMaterial.map, roughness: 0.66, clearcoat: 0.12, clearcoatRoughness: 0.48, vertexColors: true });
      this.plastics.push(vinyl);
      tagMudExposure(vinyl, 0.54);
      add(this.steer, mxCrossbarPad(detail, compact), vinyl, 0, barY + 0.012, barZ + 0.03);
    }
    if (detail !== 'far') addMotocrossControlMounts(this.steer, detail, this.m, barY, barZ);
    for (const side of [1, -1]) {
      if (detail === 'far') {
        add(
          this.steer,
          new T.CylinderGeometry(0.012, 0.012, 0.048, 8),
          this.m.steel,
          side * 0.07,
          CLAMPS + 0.024,
          barZ + 0.032,
        );
        add(
          this.steer,
          new T.CylinderGeometry(0.018, 0.018, 0.12, 10),
          this.m.dark,
          side * 0.36,
          barY,
          barZ,
        ).rotation.z = Math.PI / 2;
      } else if (side < 0) {
        this.throttleTube.name = 'Motocross rotating throttle tube';
        this.throttleTube.position.set(side * 0.36, barY, barZ);
        this.steer.add(this.throttleTube);
        add(this.throttleTube, motocrossGrip(detail, side), this.m.dark);
      } else {
        add(this.steer, motocrossGrip(detail, side), this.m.dark, side * 0.36, barY, barZ);
      }
      this.gripLocal[side > 0 ? 0 : 1].set(side * 0.36, barY, barZ);
      controlSight(`Motocross ${side > 0 ? 'left' : 'right'} grip`, side * 0.36, barY, barZ);
      if (detail !== 'far') {
        // The inboard end is the pivot, not the centre of the blade. Keep the
        // terminal ball and blade in this same articulation boundary so they
        // remain joined when the recorded front brake pulls the lever in.
        const leverParent = side < 0 ? this.frontBrakeLever : this.steer;
        if (side < 0) {
          this.frontBrakeLever.name = 'Motocross front brake lever pivot';
          this.frontBrakeLever.position.set(
            side * (0.3 - Math.cos(0.25) * 0.07),
            barY - 0.01,
            barZ + 0.07 + Math.sin(0.25) * 0.07,
          );
          this.frontBrakeLever.rotation.y = -0.25;
          this.steer.add(this.frontBrakeLever);
        }
        const blade = motocrossLeverBlade(side);
        // The fixed clutch casting shares the corresponding reflected pivot.
        if (side > 0) blade.rotateY(0.25);
        add(
          leverParent,
          blade,
          this.m.aluminium,
          side < 0 ? 0 : 0.3 - Math.cos(0.25) * 0.07,
          side < 0 ? 0 : barY - 0.01,
          side < 0 ? 0 : barZ + 0.07 + Math.sin(0.25) * 0.07,
        );
        // Join the ball to the actual outer blade endpoint after its yaw.
        // An independent forward offset leaves a visible gap from the cockpit.
        add(
          leverParent,
          new T.SphereGeometry(0.006, 8, 6),
          this.m.aluminium,
          side < 0 ? side * 0.14 : side * (0.3 + Math.cos(0.25) * 0.07),
          side < 0 ? 0 : barY - 0.01,
          side < 0 ? 0 : barZ + 0.07 - Math.sin(0.25) * 0.07,
        );
      }
    }
    if (detail !== 'far')
      for (const side of [-1, 1])
        add(
          this.steer,
          tube(
            [
              [side * 0.24, barY + 0.013, barZ + 0.042],
              [side * 0.16, barY + 0.073, barZ + 0.075],
              [side * 0.054, CLAMPS - 0.09, 0.05],
            ],
            0.004,
            18,
            5,
          ),
          this.m.dark,
        );
    if (!supermoto)
      addMotocrossHandguards(this.steer, detail, compact, barY, barZ,
        shroudMaterial, dark, this.m.aluminium);
    // Front number plate below the bar.
    const plate = add(
      this.steer,
      supermoto ? mouldedPanel(
        [
          [-0.138, 0.143],
          [0.138, 0.143],
          [0.155, 0.065],
          [0.119, -0.13],
          [0, -0.167],
          [-0.119, -0.13],
        ],
        0.008,
        0.005,
      ) : mxNumberBoard(detail, compact),
      board,
      0,
      CLAMPS - 0.088,
      // Close against the fork tubes, as a plate strapped to the clamps sits.
      OFFSET + 0.066,
    );
    plate.name = 'Motocross sculpted front number plate';
    // Race numbers are printed on the front. The cockpit sees the unprinted
    // moulding, not a mirrored duplicate of the graphics through the plate.
    if (supermoto) mapUnprintedPlateBack(plate.geometry);
    if (detail !== 'far') {
      // Moulded ribs bridge the flexible number board to its rubber fork
      // straps. The cockpit sees this hardware from behind the board.
      const faceY = plate.position.y,
        back = plate.position.z + (supermoto ? -0.011 : mxNumberBoardBack(0.092, 0.059, compact) - 0.003);
      for (const side of [-1, 1]) {
        const rib = add(
          this.steer,
          new T.BoxGeometry(0.008, 0.124, 0.009),
          board,
          side * 0.086,
          faceY + 0.065,
          back,
        );
        // A narrow blank area of the existing board atlas carries bare resin.
        const uv = rib.geometry.getAttribute('uv');
        for (let i = 0; i < uv.count; i++)
          uv.setXY(i, 0.012 + 0.006 * uv.getX(i), 0.42 + 0.09 * uv.getY(i));
        rib.rotation.z = side * -0.12;
        add(
          this.steer,
          new T.BoxGeometry(0.032, 0.018, 0.027),
          this.m.dark,
          side * 0.092,
          faceY + 0.059,
          back - 0.009,
        );
        const pad = add(
          this.steer,
          new T.CylinderGeometry(0.008, 0.008, 0.004, 10),
          this.m.aluminium,
          side * 0.092,
          faceY + 0.059,
          back - 0.025,
        );
        pad.rotation.x = Math.PI / 2;
        const bolt = add(
          this.steer,
          new T.CylinderGeometry(0.0047, 0.0047, 0.003, 6),
          this.m.steel,
          side * 0.092,
          faceY + 0.059,
          back - 0.028,
        );
        bolt.rotation.x = Math.PI / 2;
      }
    }
    // High front fender on the lower clamp: the wheel rises into the gap.
    const kitFender = (front: boolean) => {
      const geometry = motocrossFender(front, detail, definition.id === 'mx250');
      if (!supermoto && detail !== 'far') prepareMxFenderFlex(geometry, front);
      const normal = geometry.getAttribute('normal');
      return mapMxKitPanel(geometry, 'fender', (i) => normal.getY(i) > 0.5, !front);
    };
    this.frontFender = add(this.steer, kitFender(true), shroudMaterial, 0, -0.04, OFFSET);
    this.frontFender.name = 'Motocross front mudguard';
    // Lower legs (stanchions and axle lugs) slide with the recorded compression.
    this.steer.add(this.forkLower);
    this.forkLower.name = 'Motocross sliding fork lowers';
    for (const side of [1, -1]) {
      add(
        this.forkLower,
        new T.CylinderGeometry(0.024, 0.024, 0.68, sides / 2),
        this.m.forkLower,
        side * 0.095,
        0.34,
        OFFSET,
      );
      add(this.forkLower, motocrossAxleLug(detail), castMaterial, side * 0.095, 0, OFFSET);
      // Plastic fork guards over the stanchions.
      const guard = motocrossForkGuard(detail);
      const outerCount = guard.getAttribute('position').count / 2;
      mapMxKitPanel(guard, 'guard', (i) => i < outerCount);
      add(this.forkLower, guard, shroudMaterial, side * 0.095, 0, OFFSET);
    }
    add(
      this.forkLower,
      new T.CylinderGeometry(0.0095, 0.0095, 0.245, detail === 'far' ? 8 : 12),
      this.m.steel,
      0,
      0,
      OFFSET,
    ).rotation.z = Math.PI / 2;
    const frontBanjo =
      detail !== 'far'
        ? addMotocrossBrakeCaliper(this.forkLower, true, detail, this.m, OFFSET, frontDiscRadius)
        : undefined;
    if (detail === 'far')
      add(
        this.forkLower,
        new T.BoxGeometry(0.04, 0.1, 0.06),
        this.m.caliper,
        0.055,
        0.0,
        OFFSET - (frontDiscRadius - 0.011),
      );
    this.forkLower.add(this.frontSpin);
    this.frontSpin.name = 'Motocross front spinning wheel';
    this.frontSpin.position.set(0, 0, OFFSET);
    wheel(this.frontSpin, frontR, frontRim, this.axles.frontWidth, true);
    if (detail !== 'far') {
      add(
        this.forkLower,
        tube(
          [
            [frontBanjo!.x, frontBanjo!.y, frontBanjo!.z],
            [0.124, 0.25, OFFSET + 0.017],
            [0.123, 0.51, OFFSET + 0.013],
          ],
          0.004,
          16,
          5,
        ),
        this.m.dark,
      );
      this.brakeHose = new MotocrossBrakeHose(this.m.dark);
      this.steer.add(this.brakeHose.root);
    }
    // ---- Open perimeter frame, cast engine and folded radiator shrouds.
    const lightFrame = definition.id === 'mx250';
    for (const side of [1, -1]) {
      add(
        this.sprung,
        motocrossFrameSpar(side, head, lightFrame, detail),
        lightFrame ? primary : brushedAlloy,
      );
      // Subframe to the rear fender.
      add(
        this.sprung,
        tube(
          [
            [side * 0.11, -0.08, -0.14],
            [side * 0.1, 0.03, -0.42],
            [side * 0.06, 0.06, -0.68],
          ],
          0.011,
          8,
          detail === 'high' ? 10 : 6,
        ),
        brushedAlloy,
      );
      add(
        this.sprung,
        tube(
          [
            [side * 0.065, head.y - 0.06, head.z - 0.03],
            [side * 0.11, -0.28, 0.19],
            [side * 0.12, -0.5, 0.07],
            [side * 0.1, -0.51, -0.17],
            [side * 0.11, -0.33, -0.2],
          ],
          lightFrame ? 0.014 : 0.018,
          // Smooth bends and round sections up close: the brushed alloy's
          // streaked highlight otherwise shows every facet of the cradle.
          detail === 'high' ? (supermoto ? 56 : 37) : 12,
          detail === 'high' ? 12 : 8,
        ),
        lightFrame ? primary : brushedAlloy,
      );
    }
    add(
      this.sprung,
      tube(
        [
          [0, head.y - 0.06, head.z - 0.02],
          [0, -0.1, head.z - 0.06],
          [0, -0.42, 0.02],
        ],
        0.017,
        12,
        8,
      ),
      this.m.steel,
    );
    // Dedicated water-cooled powertrain casting across all off-road bikes.
    addMotocrossPowertrain(
      this.sprung,
      detail,
      this.m,
      castMaterial,
      magnesiumMaterial,
      lightFrame ? 'two-stroke' : 'four-stroke',
    );
    add(this.sprung, motocrossSumpGuard(detail), this.m.dark).name =
      'Motocross curved protective sump scoop';
    // Radiators either side of the frame, under the wing shrouds.
    addMotocrossRadiators(this.sprung, detail, this.m);
    for (const side of [1, -1]) {
      const duct = motocrossRadiatorShroud(side, detail);
      const face = duct.getAttribute('normal');
      mapMxKitPanel(duct, 'shroud', (i) => side * face.getX(i) > 0.4);
      const shroud = add(this.sprung, duct, shroudMaterial, side * 0.184, 0, 0);
      shroud.rotation.y = side * 0.12;
      shroud.name = 'Motocross folded radiator shroud';
      if (detail === 'high')
        for (const [z, y] of [
          [-0.122, 0.09],
          [0.156, -0.242],
          [0.277, 0.094],
        ])
          add(
            this.sprung,
            new T.CylinderGeometry(0.006, 0.006, 0.007, 6),
            this.m.steel,
            side * 0.194,
            y,
            z,
          ).rotation.z = Math.PI / 2;
    }
    // Tank and upper shroud body from the seat nose to the steering head,
    // its filler cap and breather, the airbox behind the frame and the seat.
    add(this.sprung, motocrossTankShell(detail), primary).name =
      'Motocross fuel tank and upper shroud body';
    const capZ = 0.222,
      capY = motocrossTankTop(capZ);
    const cap = add(
      this.sprung,
      new T.CylinderGeometry(0.03, 0.034, 0.02, detail === 'high' ? 20 : 12),
      this.m.dark,
      0,
      capY + 0.004,
      capZ,
    );
    cap.rotation.x = -0.52;
    cap.name = 'Motocross fuel filler cap';
    if (detail !== 'far')
      add(
        this.sprung,
        tube(
          [
            [0, capY + 0.014, capZ - 0.004],
            [0.012, capY + 0.05, capZ + 0.012],
            [0.03, capY + 0.03, capZ + 0.058],
            [0.036, capY - 0.035, capZ + 0.066],
          ],
          0.004,
          18,
          5,
        ),
        this.m.dark,
      );
    add(this.sprung, motocrossAirbox(detail), dark).name = 'Motocross airbox and seat base';
    if (detail !== 'far') {
      const flap = add(this.sprung, motocrossMudFlap(), dark, 0, -0.14, -0.345);
      flap.rotation.x = 0.3;
      flap.name = 'Motocross rear mud flap';
      this.mudFlap = flap;
    }
    add(this.sprung, motocrossSeat(detail), this.m.seat).name = 'Motocross one-piece seat';
    if (detail !== 'far')
      add(this.sprung, motocrossSeatPleats(detail), dark).name = 'Stitched anti-slip saddle pleats';
    // Side number boards and the long, upswept rear fender.
    for (const side of [1, -1]) {
      add(this.sprung, mxSideNumberPlate(detail, side, lightFrame), board).name =
        'Motocross tapered side number panel';
      if (detail !== 'far') {
        for (const mount of mxSidePlateMounts(side, lightFrame)) {
          const innerX = side * (mount.z < -0.5 ? 0.094 : 0.132);
          const outerX = mount.x + side * 0.0024;
          const stem = new T.CylinderGeometry(0.008, 0.005, Math.abs(outerX - innerX), 6);
          stem.rotateZ(-side * Math.PI / 2);
          add(this.sprung, stem, this.m.steel, (innerX + outerX) / 2, mount.y, mount.z).name =
            'Motocross tail panel retaining stud';
        }
      }
    }
    this.rearFender = add(this.sprung, kitFender(false), shroudMaterial);
    this.rearFender.name = 'Motocross rear mudguard';
    // Each dirt engine has its own gas path into the common silencer mount.
    add(
      this.sprung,
      lightFrame
        ? motocrossExpansionChamber(detail)
        : !supermoto ? motocrossFourStrokeHeader(detail) : exhaustGeometry(
            [
              [0, -0.16, 0.14],
              [-0.098, -0.2, 0.23],
              [-0.16, -0.365, 0.11],
              [-0.155, -0.3, -0.14],
              [-0.163, -0.05, -0.46],
            ],
            0.022,
            detail === 'high' ? 32 : 10,
            8,
          ),
      this.m.titanium,
    );
    if (!lightFrame && !supermoto && detail !== 'far') {
      add(this.sprung, motocrossHeaderFlange(detail), this.m.steel, 0, -0.117, 0.07);
      for (const x of [-0.037, 0.037]) {
        const nut = new T.CylinderGeometry(0.0062, 0.0062, 0.009, 6).rotateX(Math.PI / 2);
        add(this.sprung, nut, this.m.steel, x, -0.117, 0.08);
      }
    }
    const silencer = new T.Group();
    silencer.name = 'Motocross tapered open exhaust silencer';
    silencer.position.set(MX_SILENCER_MOUNT.x, MX_SILENCER_MOUNT.y, MX_SILENCER_MOUNT.z);
    silencer.rotation.x = MX_SILENCER_MOUNT.pitch;
    this.sprung.add(silencer);
    add(silencer, mxSilencerSleeve(detail, lightFrame), this.m.aluminium).name =
      'Swaged exhaust sleeve';
    add(silencer, motocrossSilencerOutlet(detail), this.m.dark).name =
      'Motocross recessed open silencer outlet';
    const bore = new T.LatheGeometry(
      [
        new T.Vector2(0.0215, -0.163),
        new T.Vector2(0.0215, 0.165),
        new T.Vector2(0.019, 0.165),
        new T.Vector2(0.019, -0.163),
        new T.Vector2(0.0215, -0.163),
      ],
      sides / 2,
    );
    bore.rotateX(Math.PI / 2);
    add(silencer, bore, this.m.dark);
    add(silencer, new T.TorusGeometry(0.0245, 0.0025, 5, sides / 2), this.m.steel, 0, 0, MX_SILENCER_MOUNT.outletZ);
    // An annular inlet leaves the real header connection open as well.
    const inlet = new T.RingGeometry(0.022, 0.049, sides / 2);
    add(silencer, inlet, this.m.aluminium, 0, 0, 0.171);
    if (detail !== 'far') {
      for (const z of [-0.065, 0.11]) {
        add(
          silencer,
          mxSilencerSleeve(detail, lightFrame, { centre: z, width: 0.016 }),
          this.m.steel,
        );
        const rivet = new T.CylinderGeometry(
          0.0045,
          0.0045,
          0.004,
          detail === 'high' ? 10 : 6,
        ).rotateZ(Math.PI / 2);
        add(silencer, rivet, this.m.steel, -0.044, 0, z);
      }
      add(silencer, mxSilencerHanger(), this.m.aluminium, 0, 0, -0.065);
      const bush = new T.TorusGeometry(0.007, 0.002, 5, 12);
      add(silencer, bush, this.m.dark, 0.105, 0.055, -0.059);
      const fastener = new T.CylinderGeometry(0.0054, 0.0054, 0.012, 6).rotateX(Math.PI / 2);
      add(silencer, fastener, this.m.steel, 0.105, 0.055, -0.062);
    }
    // Serrated hollow pegs retain the rider's authored contact points.
    for (const side of [-1, 1]) {
      for (const z of [-0.125, -0.075])
        add(
          this.sprung,
          new T.BoxGeometry(0.098, 0.014, 0.009),
          this.m.steel,
          side * 0.17,
          detail === 'high' ? -0.449 : -0.4385,
          z,
        );
      add(
        this.sprung,
        new T.BoxGeometry(0.011, 0.014, 0.059),
        this.m.steel,
        side * 0.217,
        detail === 'high' ? -0.449 : -0.4385,
        -0.1,
      );
      if (detail === 'high')
        for (let k = 0; k < 5; k++)
          for (const z of [-0.125, -0.075])
            add(
              this.sprung,
              new T.BoxGeometry(0.008, 0.025, 0.009),
              this.m.steel,
              side * (0.126 + k * 0.021),
              -0.444,
              z,
            );
    }
    if (detail !== 'far')
      this.footControls = new MotocrossFootControls(this.sprung, this.m, detail === 'high');
    // ---- Swingarm from the pivot to the rear axle on the ground.
    const arm = this.axles.armLength;
    this.swingarm.name = 'Motocross articulated swingarm';
    for (const side of [1, -1])
      add(this.swingarm, motocrossSwingarmRail(arm, side, detail), brushedAlloy);
    add(this.swingarm, new T.CylinderGeometry(0.018, 0.018, 0.26, 10), this.m.steel).rotation.z =
      Math.PI / 2;
    // The hub and the open adjustment slots share one actual rear spindle;
    // removing the old solid arm ends must not leave a floating rear wheel.
    add(
      this.swingarm,
      new T.CylinderGeometry(0.0095, 0.0095, detail === 'far' ? 0.252 : 0.264, detail === 'far' ? 8 : 12),
      this.m.steel,
      0,
      0,
      -arm,
    ).rotation.z = Math.PI / 2;
    if (detail === 'far') {
      add(this.swingarm, distantMotocrossChain(arm), chainMaterial).name =
        'Motocross distant chain runs';
    } else {
      for (const side of [-1, 1]) {
        add(
          this.swingarm,
          new T.CylinderGeometry(0.015, 0.015, 0.006, 6),
          this.m.steel,
          side * 0.128,
          0,
          -arm,
        ).rotation.z = Math.PI / 2;
        add(
          this.swingarm,
          new T.TorusGeometry(0.017, 0.0025, 4, 12),
          this.m.aluminium,
          side * 0.123,
          0,
          -arm,
        ).rotation.y = Math.PI / 2;
      }
    }
    if (detail !== 'far') {
      this.shockLower.set(0, 0.04, -arm * 0.35);
      this.shock = new MotocrossRearShock(detail, this.m);
      this.root.add(this.shock.root);
      if (!supermoto)
        this.shockLinkage = new MotocrossShockLinkage(this.root, this.sprung, this.swingarm, this.m, detail === 'high');
      for (const [parent, anchor] of [
        [this.sprung, this.shockUpper],
        [this.swingarm, this.shockLower],
      ] as const) {
        if (parent === this.swingarm && this.shockLinkage) continue;
        add(
          parent,
          new T.CylinderGeometry(0.0065, 0.0065, 0.22, 10),
          this.m.aluminium,
          anchor.x,
          anchor.y,
          anchor.z,
        ).rotation.z = Math.PI / 2;
      }
      this.rearBrake.name = 'Motocross axle-mounted non-spinning rear brake';
      this.rearBrake.position.copy(this.axles.rearRest);
      this.root.add(this.rearBrake);
      const rearBanjo = addMotocrossBrakeCaliper(this.rearBrake, false, detail, this.m, 0);
      if (!supermoto && this.footControls) {
        this.rearBrakeLine = motocrossRearBrakeLine(
          this.sprung, this.swingarm, this.axles.pivot, arm, this.footControls.outlet, this.m, detail === 'high',
        );
        this.root.add(this.rearBrakeLine);
      }
      add(
        this.rearBrake,
        tube(
          [
            [rearBanjo.x, rearBanjo.y, rearBanjo.z],
            [-0.106, 0.052, 0.12],
            [-0.113, 0.045, 0.2],
          ],
          0.0035,
          12,
          5,
        ),
        this.m.dark,
      );
      this.chain = new MotocrossChainDrive(arm, detail, chainMaterial, this.mud);
      this.swingarm.add(this.chain.root);
      addMotocrossChainGuides(this.swingarm, arm, detail, dark, this.m.aluminium, this.m.steel);
      addMotocrossAxleAdjusters(this.swingarm, arm, detail, this.m.aluminium, this.m.steel);
    }
    this.root.add(this.swingarm);
    this.rearWheel.name = 'Motocross rear suspension hub';
    this.rearWheel.position.copy(this.axles.rearRest);
    this.rearWheel.add(this.rearSpin);
    this.root.add(this.rearWheel);
    wheel(this.rearSpin, rearR, rearRim, this.axles.rearWidth, false);
    // ---- Off-road rider.
    this.rider = new Rider(colours, detail, 'motocross', (id % 98) + 2);
    if (detail !== 'far') this.rider.brakeFingerTargets = [new T.Vector3(), new T.Vector3()];
    this.rider.seat.set(0, 0.2, -0.24);
    this.rider.pegs[0].fromArray(MX_PEG);
    this.rider.pegs[1].set(-MX_PEG[0], MX_PEG[1], MX_PEG[2]);
    this.sprung.add(this.rider.root);
    // Repeated lugs, fins, fasteners and mechanical pieces are merged per
    // material inside each articulation boundary, including distant LODs.
    for (const group of [
      this.sprung,
      this.steer,
      this.frontBrakeLever,
      this.forkLower,
      this.frontSpin,
      this.rearSpin,
      this.swingarm,
      this.rearBrake,
      silencer,
    ])
      batchBikeRigidMeshes(group);
    if (!supermoto) {
      applyMxAssemblyOcclusion(`${definition.id}/frame/${detail}`, this.sprung,
        [this.rider.root, this.steerMount, this.footControls?.brake], 0.016, 0.19);
      applyMxAssemblyOcclusion(`${definition.id}/bars/${detail}`, this.steer,
        [this.forkLower, this.throttleTube, this.frontBrakeLever, this.brakeHose?.root], 0.008, 0.09);
    }
    installMudOn(this.root, this.mud);
  }
  pose(v: BikePoseValues) {
    const b = this.definition.bike!,
      fork = T.MathUtils.clamp(v.fork, 0, b.forkTravel),
      shock = T.MathUtils.clamp(v.shock, 0, b.shockTravel);
    // DirtBikeVehicle already records the sprung CG's heave and pitch.
    // Repeating the road-bike body's cosmetic spring offset doubles every
    // landing/dive and moves a fixed rear wheel with the chassis. Keep the
    // body rigid to that authoritative root; articulate the hubs instead.
    this.sprung.position.set(0, 0, 0);
    this.sprung.quaternion.identity();
    this.steer.rotation.y = v.steer;
    // The rear pedal has its own input; it must not squeeze the front lever.
    // This direct snapshot mapping also holds still on pause and rewinds
    // exactly without a presentation-only animation clock.
    this.footControls?.update(v.rearBrake);
    this.throttleTube.rotation.x = motocrossThrottleAngle(v.throttle);
    this.frontBrakeLever.rotation.y = -0.25 - T.MathUtils.clamp(v.brake, 0, 1) * 0.2;
    // The off-road adapter records vertical wheel travel, not piston travel.
    // Convert it to the raked telescope's stroke; steering around that axis
    // must not change its extension or produce another chassis displacement.
    this.forkLower.position.y = this.axles.lowerY(fork);
    if (this.detail !== 'far') this.m.wheelExposure.update(v.frontOmega, v.rearOmega);
    this.frontSpin.rotation.x = v.frontRotation;
    this.rearSpin.rotation.x = v.rearRotation;
    // Pit service wheel exchange (see BikeModel.pose).
    // The rigid swingarm pivots on a circular arc. Its axle's vertical travel
    // follows the recorded rear compression; neither the arm nor its chain
    // stretches to reach a hub pinned to the old ground-reference frame.
    this.axles.rearHub(shock, this.rearWheel.position);
    const dy = this.rearWheel.position.y - this.axles.pivot.y,
      dz = this.rearWheel.position.z - this.axles.pivot.z;
    this.rearBrake.position.copy(this.rearWheel.position);
    this.rearWheel.position.z -= v.rearWheelOut ?? 0;
    forkLocalOffset(
      this.scratch.set(0, -(v.frontWheelDrop ?? 0), 0),
      RAKE,
      v.steer,
      this.frontSpin.position,
    ).z += OFFSET;
    this.brakeHose?.update(this.forkLower.position.y);
    this.sprung.updateMatrix();
    const p = this.scratch.copy(this.axles.pivot).applyMatrix4(this.sprung.matrix);
    this.swingarm.position.copy(p);
    this.swingarm.rotation.x = Math.atan2(dy, -dz);
    this.swingarm.scale.z = 1;
    if (this.shock) {
      this.swingarm.updateMatrix();
      this.upperEye.copy(this.shockUpper).applyMatrix4(this.sprung.matrix);
      if (this.shockLinkage) this.shockLinkage.update(this.sprung.matrix, this.swingarm.matrix, this.lowerEye);
      else this.lowerEye.copy(this.shockLower).applyMatrix4(this.swingarm.matrix);
      this.shock.update(this.upperEye, this.lowerEye);
      // The casting follows arm angle about the axle, independently of both
      // wheel spin and wheel removal. No swingarm stretch scales the casting.
      this.rearBrake.rotation.x = this.swingarm.rotation.x;
    }
    this.chain?.update(v.rearRotation, this.swingarm.scale.z);
    // Steel stays dark at ordinary riding temperatures. The two rotors
    // use their own recorded heat, including brake dragging and cooldown.
    this.frontRotor.emissiveIntensity = mxRotorEmission(v.discTemp);
    this.rearRotor.emissiveIntensity = mxRotorEmission(v.rearDiscTemp);
    this.mud.offroadMud.value = T.MathUtils.clamp(v.mud ?? 0, 0, 1);
    this.mud.offroadMudWet.value = T.MathUtils.clamp((v.mudWet ?? 0) * 1.6, 0, 1);
    this.tyreFinish?.update(v);
    const forkStroke = T.MathUtils.clamp(
      (fork - this.axles.sag.fork) / (b.forkTravel - this.axles.sag.fork),
      0,
      1,
    );
    const rearStroke = T.MathUtils.clamp(
      (shock - this.axles.sag.shock) / (b.shockTravel - this.axles.sag.shock),
      0,
      1,
    );
    const bias = forkStroke - rearStroke;
    if (this.mudFlap?.morphTargetInfluences) {
      const rimSpeed = Number.isFinite(v.rearOmega)
        ? Math.abs(v.rearOmega!) * b.rearWheelRadius
        : 0;
      this.mudFlap.morphTargetInfluences[0] = mxMudFlapLoad(
        v.speed,
        rimSpeed,
        v.dirtSupportG,
        rearStroke,
      );
    }
    if (this.frontFender.morphTargetInfluences && this.rearFender.morphTargetInfluences) {
      this.frontFender.morphTargetInfluences[0] = mxFenderLoad(v.dirtSupportG, v.speed, bias);
      this.rearFender.morphTargetInfluences[0] = mxFenderLoad(v.dirtSupportG, v.speed, -bias);
    }
    if (v.riding) {
      this.steerMount.updateMatrix();
      this.steer.updateMatrix();
      this.matrix.multiplyMatrices(this.steerMount.matrix, this.steer.matrix);
      for (let i = 0; i < 2; i++) {
        this.rider.grips[i].copy(this.gripLocal[i]).applyMatrix4(this.matrix);
        this.rider.gripAxes[i].set(1, 0, 0).transformDirection(this.matrix);
      }
      const fingers = this.rider.brakeFingerTargets;
      if (fingers) {
        this.frontBrakeLever.updateMatrix();
        // Each fingertip rests on the rider-facing side of the blade.
        for (let i = 0; i < 2; i++) {
          fingers[i]
            .set(-0.106 - i * 0.016, 0.004, -0.006)
            .applyMatrix4(this.frontBrakeLever.matrix)
            .applyMatrix4(this.matrix);
        }
      }
      // Read the authoritative rendered chassis frame once for gaze.
      // Suspension travel separately drives the rider's compression response.
      this.scratch.set(0, 0, 1).applyQuaternion(this.root.quaternion);
      const chassisPitch = -Math.asin(T.MathUtils.clamp(this.scratch.y, -1, 1));
      this.rider.ride({
        lean: v.chassisLean,
        leanRate: v.leanRate,
        gLong: v.gLong,
        offset: v.riderOffset * 0.4,
        tuck: 0,
        braking: v.brake,
        throttle: v.throttle,
        rearBraking: v.rearBrake,
        steer: v.steer,
        speed: v.speed,
        standing: v.standing ?? 0,
        dab: v.dab ?? 0,
        body: v.body ?? 0,
        startBrace: v.startBrace,
        time: v.time,
        chassisPitch,
        travelYaw: motocrossTravelYaw(this.scratch.x, this.scratch.z, v.velocityX, v.velocityZ),
        compression: (forkStroke + rearStroke) / 2,
        compressionBias: bias,
        supportG: v.dirtSupportG,
      });
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.rider.root.removeFromParent();
    this.rider.dispose();
    this.rearBrakeLine?.skeleton.dispose();
    this.root.traverse((o) => {
      if (o instanceof T.InstancedMesh) o.dispose();
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    // Pad vinyl and plastics use the same entrant decal sheet.
    const maps = new Set(this.plastics.map((material) => material.map));
    for (const map of maps) map?.dispose();
    for (const material of this.plastics) material.dispose();
  }
}
