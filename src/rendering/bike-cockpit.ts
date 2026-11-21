import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Menu/orbit/broadcast cameras must never inherit first-person self-culling. */
export function bikeFirstPersonView(
  mode: string,
  menu: boolean,
  pregame: boolean,
  photoView?: string,
) {
  return (
    !pregame &&
    (!photoView || photoView === 'cockpit') &&
    (!menu || !!photoView) &&
    mode === 'cockpit'
  );
}

export interface BikeInstrumentValues {
  speed?: number;
  /** Vehicle.gear / F.GEAR: reverse=-1, neutral=0, forward gears=1..N. */
  gear?: number;
  rpm?: number;
  frontSurfaceTemp?: number;
  rearSurfaceTemp?: number;
  chassisLean?: number;
  intervention?: number;
  brake?: number;
  rearBrake?: number;
  throttle?: number;
  pitLane?: boolean;
}
/** Snapshot gears are already the displayed numbers. Only the drivetrain's
 * internal ratio lookup adds one to index its reverse/neutral entries. */
export function bikeInstrumentReadout(values: BikeInstrumentValues, limiterRPM: number) {
  const finite = (v: number | undefined) => (Number.isFinite(v) ? v! : 0);
  const gear = Math.round(finite(values.gear));
  return {
    speed: Math.round(Math.max(0, finite(values.speed)) * 3.6),
    gear: gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear),
    rpm: Math.round(Math.max(0, finite(values.rpm)) / 100) * 100,
    fill: T.MathUtils.clamp(finite(values.rpm) / Math.max(1, finite(limiterRPM)), 0, 1),
  };
}

/** Quantise to the precision actually painted on the GP dash. A studio or
 * older sample can have absent channels; a missing measurement has no reading. */
export function gpInstrumentTelemetry(v: BikeInstrumentValues) {
  const temperature = (value?: number) =>
    value !== undefined && Number.isFinite(value) ? String(Math.round(value)) : '—';
  const fraction = (value?: number) =>
    Number.isFinite(value) ? T.MathUtils.clamp(value!, 0, 1) : 0;
  const degrees = Number.isFinite(v.chassisLean)
    ? Math.round(T.MathUtils.radToDeg(v.chassisLean!))
    : null;
  return {
    front: temperature(v.frontSurfaceTemp),
    rear: temperature(v.rearSurfaceTemp),
    lean:
      degrees === null
        ? '—'
        : degrees === 0
          ? '0°'
          : `${Math.abs(degrees)}°${degrees > 0 ? 'L' : 'R'}`,
    control: Math.round(fraction(v.intervention) * 100),
    drive: Math.round(fraction(v.throttle) * 6),
    braking: Math.round(Math.max(fraction(v.brake), fraction(v.rearBrake)) * 6),
    pit: v.pitLane === true,
  };
}

/** GP shift-light sequence (REF 074/088): fifteen LEDs that only start to
 * light in the upper part of the rev range, green, then amber, then red, with
 * the last (blue) lamp at the shift point. Returns the number lit. */
export const GP_SHIFT_LIGHTS = Object.freeze({ count: 15, from: 0.6, to: 0.97 });
export function gpShiftLightsLit(fill: number) {
  const { count, from, to } = GP_SHIFT_LIGHTS;
  if (!Number.isFinite(fill)) return 0;
  return Math.round(T.MathUtils.clamp((fill - from) / (to - from), 0, 1) * count);
}
const SHIFT_COLOURS = ['#3fe07c', '#ffc93a', '#ff3b2f', '#4aa6ff'] as const;
function shiftColour(i: number) {
  return i < 5
    ? SHIFT_COLOURS[0]
    : i < 10
      ? SHIFT_COLOURS[1]
      : i < 14
        ? SHIFT_COLOURS[2]
        : SHIFT_COLOURS[3];
}

/** Physical dimensions (m) of the two instrument faces. The GP face is a
 * 16:9 race TFT inside an LED bezel; others keep the original 2:1 display. */
const FACE = Object.freeze({
  gp: { width: 0.136, height: 0.0765, canvas: [512, 288] as const },
  road: { width: 0.132, height: 0.066, canvas: [512, 256] as const },
});

/** One small cockpit canvas per high LOD, redrawn only when its quantised
 * snapshot readout changes. It never invents speed or gear from wall time. */
export class BikeCockpit {
  readonly root = new T.Group();
  private readonly display: T.Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: T.CanvasTexture;
  private readonly material: T.MeshBasicMaterial;
  private readonly shellMaterial = new T.MeshStandardMaterial({ color: 0x101316, roughness: 0.46 });
  private key = '';
  constructor(
    private readonly limiterRPM: number,
    /** GP prototypes: race TFT with shift lights, small gear and mode readouts. */
    readonly gp = false,
  ) {
    const face = gp ? FACE.gp : FACE.road;
    this.canvas.width = face.canvas[0];
    this.canvas.height = face.canvas[1];
    this.texture = new T.CanvasTexture(this.canvas);
    this.texture.colorSpace = T.SRGBColorSpace;
    this.texture.userData.dynamic = true;
    this.texture.anisotropy = 4;
    this.material = new T.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    this.root.name = 'Snapshot-driven GP instruments';
    if (gp) {
      // Satin carbon-black moulded housing with a deeper bezel lip.
      this.shellMaterial.color.setHex(0x0b0c0e);
      this.shellMaterial.roughness = 0.52;
      this.shellMaterial.name = 'GP dash housing';
    }
    const shell = new T.Mesh(
      gp
        ? new RoundedBoxGeometry(face.width + 0.016, face.height + 0.016, 0.022, 2, 0.007)
        : new RoundedBoxGeometry(0.152, 0.081, 0.018, 2, 0.006),
      this.shellMaterial,
    );
    shell.castShadow = shell.receiveShadow = true;
    this.root.add(shell);
    const display = new T.Mesh(new T.PlaneGeometry(face.width, face.height), this.material);
    this.display = display;
    display.name = 'GP instrument display';
    // The face looks back and up towards the rider, not down into the cowl.
    display.rotation.y = Math.PI;
    display.position.z = gp ? -0.0115 : -0.0095;
    this.root.add(display);
    // Recessed below the windscreen; the cowl provides a real open well. The
    // GP unit stands on the inner upper fairing a little further forward.
    if (gp) this.root.position.set(0, 0.305, 0.625);
    else this.root.position.set(0, 0.31, 0.6);
    this.root.rotation.x = 0.72;
    this.update({});
  }
  faceCentre(out: T.Vector3) {
    return this.display.getWorldPosition(out);
  }
  update(values: BikeInstrumentValues) {
    const r = bikeInstrumentReadout(values, this.limiterRPM);
    const lamps = this.gp ? gpShiftLightsLit(r.fill) : Math.round(r.fill * 12);
    const gp = this.gp ? gpInstrumentTelemetry(values) : null;
    let key = `${r.speed}/${r.gear}/${r.rpm}/${lamps}`;
    if (gp)
      key += `/${gp.front}/${gp.rear}/${gp.lean}/${gp.control}/${gp.drive}/${gp.braking}/${gp.pit}`;
    if (key === this.key) return;
    this.key = key;
    const c = this.canvas.getContext('2d');
    if (!c) return;
    if (gp) this.drawGp(c, r, lamps, gp);
    else this.drawRoad(c, r, lamps);
    this.texture.needsUpdate = true;
  }
  private drawRoad(
    c: CanvasRenderingContext2D,
    r: ReturnType<typeof bikeInstrumentReadout>,
    lamps: number,
  ) {
    c.fillStyle = '#0b1014';
    c.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 12; i++) {
      c.fillStyle = i >= lamps ? '#243039' : i < 6 ? '#a1d8bc' : i < 10 ? '#f0cc70' : '#f06049';
      c.fillRect(16 + i * 40, 14, 33, 13);
    }
    c.fillStyle = '#e5ecee';
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.font = '700 30px sans-serif';
    c.fillText('MOTOBOUND', 18, 66);
    c.fillStyle = '#8fa0a9';
    c.font = '22px monospace';
    c.fillText('GEAR', 21, 106);
    c.fillText('KM/H', 220, 106);
    c.fillStyle = '#f0f2ec';
    c.font = '700 104px monospace';
    c.fillText(r.gear, 18, 205);
    c.font = '700 92px monospace';
    c.fillText(String(r.speed).padStart(3, '0'), 218, 203);
    c.fillStyle = '#8fa0a9';
    c.font = '22px monospace';
    c.fillText(`${r.rpm} RPM`, 21, 242);
  }
  /** Race TFT (REF 017/074/088): LED bezel with a shift-light row and two
   * status columns around a transflective panel carrying a thin rev bar, the
   * tyre and rider telemetry, speed and the selected gear. */
  private drawGp(
    c: CanvasRenderingContext2D,
    r: ReturnType<typeof bikeInstrumentReadout>,
    lamps: number,
    telemetry: ReturnType<typeof gpInstrumentTelemetry>,
  ) {
    const W = 512,
      H = 288;
    c.fillStyle = '#040506';
    c.fillRect(0, 0, W, H);
    const led = (x: number, y: number, radius: number, colour: string, lit: boolean) => {
      c.beginPath();
      c.arc(x, y, radius + 2, 0, Math.PI * 2);
      c.fillStyle = '#16191b';
      c.fill();
      c.beginPath();
      c.arc(x, y, radius, 0, Math.PI * 2);
      c.fillStyle = lit ? colour : '#20262a';
      c.fill();
      if (lit) {
        c.beginPath();
        c.arc(x - radius * 0.3, y - radius * 0.3, radius * 0.35, 0, Math.PI * 2);
        c.fillStyle = 'rgba(255,255,255,0.55)';
        c.fill();
      }
    };
    const n = GP_SHIFT_LIGHTS.count;
    for (let i = 0; i < n; i++)
      led(56 + (i * (W - 112)) / (n - 1), 19, 8, shiftColour(i), i < lamps);
    // Input ladders rise from the bottom. Both brake controls feed the red column.
    for (let i = 0; i < 6; i++) {
      led(19, 62 + i * 38, 7, '#ff634a', 6 - i <= telemetry.braking);
      led(W - 19, 62 + i * 38, 7, '#42e38b', 6 - i <= telemetry.drive);
    }
    // Transflective panel.
    const x0 = 42,
      y0 = 40,
      x1 = W - 42,
      y1 = H - 12;
    c.fillStyle = '#1b231f';
    c.fillRect(x0, y0, x1 - x0, y1 - y0);
    c.strokeStyle = '#3a4640';
    c.lineWidth = 2;
    c.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
    // Thin rev bar with 1000 rpm ticks.
    const barX = x0 + 10,
      barW = x1 - x0 - 20;
    c.fillStyle = '#0d1311';
    c.fillRect(barX, y0 + 10, barW, 16);
    c.fillStyle = r.fill > GP_SHIFT_LIGHTS.to ? '#ff5a44' : '#4c8dff';
    c.fillRect(barX, y0 + 10, barW * r.fill, 16);
    c.fillStyle = '#56645d';
    const thousands = Math.max(1, Math.floor(this.limiterRPM / 1000));
    for (let k = 1; k < thousands; k++)
      c.fillRect(barX + (barW * k * 1000) / this.limiterRPM, y0 + 26, 2, 5);
    c.textBaseline = 'alphabetic';
    // The two tyre surfaces are measured separately. The intervention is the
    // recorded combined traction/wheelie correction reported by the bike.
    const channels = [
      ['F °C', telemetry.front],
      ['R °C', telemetry.rear],
      ['LEAN', telemetry.lean],
      ['CTRL', `${telemetry.control}%`],
    ];
    channels.forEach(([label, value], i) => {
      const baseline = y0 + 65 + i * 43;
      c.textAlign = 'left';
      c.font = '700 17px monospace';
      c.fillStyle = '#a7b6ad';
      c.fillText(label, x0 + 11, baseline);
      c.textAlign = 'right';
      c.font = '700 21px monospace';
      c.fillStyle = i === 3 && telemetry.control >= 10 ? '#ffd378' : '#edf2ea';
      c.fillText(value, x0 + 119, baseline);
    });
    c.fillStyle = '#3a4640';
    c.fillRect(x0 + 129, y0 + 40, 2, y1 - y0 - 54);
    // Speed, centre.
    c.textAlign = 'center';
    c.fillStyle = '#eef3ee';
    c.font = '700 74px monospace';
    c.fillText(String(r.speed), 290, 182);
    c.fillStyle = '#7f9188';
    c.font = '18px monospace';
    c.fillText('KM/H', 290, 206);
    c.font = '700 20px monospace';
    c.fillStyle = '#a9b8b0';
    c.fillText(`${r.rpm}`, 290, 240);
    // Small gear digit, top right (REF 074).
    c.textAlign = 'right';
    c.fillStyle = '#7f9188';
    c.font = '16px monospace';
    c.fillText('GEAR', x1 - 12, y0 + 52);
    c.fillStyle = '#ffffff';
    c.font = '700 52px monospace';
    c.fillText(r.gear, x1 - 14, y0 + 104);
    c.fillStyle = '#56645d';
    c.font = '700 13px sans-serif';
    c.textAlign = 'left';
    c.fillStyle = telemetry.pit ? '#ffdc78' : '#94a99e';
    c.fillText(telemetry.pit ? 'PIT LANE' : 'RPM', telemetry.pit ? 255 : 280, y1 - 10);
  }
  dispose() {
    this.texture.dispose();
    this.material.dispose();
    this.shellMaterial.dispose();
  }
}
