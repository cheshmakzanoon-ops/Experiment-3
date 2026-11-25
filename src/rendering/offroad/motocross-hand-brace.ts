import * as T from 'three';
import { smooth } from '../../core/math.ts';
import { MX_RECOVERY } from '../../simulation/offroad/rider-recovery.ts';
import { gpContactJoint } from '../gp-rider-contact.ts';
import type { MxDabSurface } from './motocross-dab.ts';
import { MX_GLOVE_WRIST } from './motocross-rider-contact.ts';

const UP = new T.Vector3(0, 1, 0);
// Heel of the fitted glove. At the far level the palm itself meets the dirt.
const CUFF = [0, -0.0285, -0.039] as const;
const PALM = [0, -0.0207, -0.0088] as const;

/** A rider presses the heel of a glove into the dirt to get the knees under
 * the body. The wrists follow the individual contact planes, even at a rut. */
export class MotocrossHandBrace {
  readonly wrist = new T.Vector3();
  readonly frame = new T.Quaternion();
  weight = 0;
  wristWeight = 0;
  private readonly contact = new T.Vector3();
  private readonly query = new T.Vector3();
  private readonly plane = new T.Plane();
  private readonly samplePlane = new T.Plane();
  private readonly rootFrame = new T.Quaternion();
  private readonly tilt = new T.Quaternion();
  private readonly angles = new T.Euler();

  sample(side: number, rise: number, tumble: number, far: boolean, pelvis: T.Vector3,
    freeWrist: T.Vector3, root: T.Group, inverse: T.Matrix4, floor: T.Plane, dirt?: MxDabSurface) {
    if (floor.normal.y <= 0.2) return;
    const roll = Math.sin(tumble), facing = Math.cos(tumble);
    // As the rider rolls onto one side, the low glove catches the ground
    // first. A settled rider has repeatable handholds through the press.
    const expectedPelvis = T.MathUtils.lerp(MX_RECOVERY.slideHeight, MX_RECOVERY.uprightHeight, rise);
    const nearGround = 1 - smooth(0.05, 0.30, floor.distanceToPoint(pelvis) - expectedPelvis);
    const prone = nearGround * smooth(-0.42, 0.65, facing);
    // A sliding wrist catches directly below its current path. Only a
    // rider already face-down commits to the handhold beside the shoulder.
    this.rootFrame.setFromRotationMatrix(root.matrixWorld);
    // The falling root tilts into the soil, then levels during the get-up.
    // Extract its yaw so the planted heel does not travel with that tilt.
    const heading = 2 * Math.atan2(this.rootFrame.y, this.rootFrame.w);
    const x = side * 0.285 * facing - 0.046 * roll, z = side > 0 ? 0.47 : 0.42;
    this.contact.copy(pelvis).applyMatrix4(root.matrixWorld);
    this.contact.x += Math.cos(heading) * x + Math.sin(heading) * z;
    this.contact.z += Math.cos(heading) * z - Math.sin(heading) * x;
    this.query.copy(freeWrist).applyMatrix4(root.matrixWorld);
    this.contact.lerp(this.query, 1 - prone);
    let support = this.plane.copy(floor).applyMatrix4(root.matrixWorld);
    if (support.normal.y <= 0.2) return;
    this.contact.y = -(support.normal.x * this.contact.x + support.normal.z * this.contact.z +
      support.constant) / support.normal.y;
    if (dirt?.planeAtWorld(this.contact, this.samplePlane) && this.samplePlane.normal.y > 0.2) {
      support = this.samplePlane;
      this.contact.y = -(support.normal.x * this.contact.x + support.normal.z * this.contact.z +
        support.constant) / support.normal.y;
    }
    const release = side > 0 ? smooth(0.16, 0.57, rise) : smooth(0.23, 0.64, rise);
    const height = support.distanceToPoint(this.query);
    // The upper hand on a tumbling body keeps its reach. A planned press
    // may draw it down only as far as that contact is within arm's reach.
    const capture = Math.min(1, 0.19 / Math.max(0.19, height - 0.034));
    const press = prone * capture * (1 - release);
    // A tumbling arm can reach the ground before the pelvis. Lift that
    // wrist into the contact pose even when the torso still faces sideways.
    const catchGround = 1 - smooth(0.065, 0.36, height);
    this.weight = Math.max(press, catchGround * (1 - smooth(0.56, 0.74, rise)));
    // The wrist uncocks after it unloads. Keep some palm orientation while
    // the elbow folds, so the forearm cannot snap the hand around at release.
    this.wristWeight = Math.max(this.weight, prone * capture * (1 - smooth(0.25, 0.80, rise)));
    if (this.wristWeight <= 0) return;
    this.frame.setFromEuler(this.angles.set(-0.16, side * 0.18, side * 0.045, 'YXZ'));
    this.frame.premultiply(this.tilt.setFromAxisAngle(UP, heading));
    this.frame.premultiply(this.tilt.setFromUnitVectors(UP, support.normal));
    this.frame.premultiply(this.rootFrame.invert());
    gpContactJoint(this.contact.applyMatrix4(inverse), this.frame, far ? PALM : CUFF, MX_GLOVE_WRIST, this.wrist);
    return this;
  }
}
