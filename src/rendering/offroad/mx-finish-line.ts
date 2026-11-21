import * as T from 'three';
import { Track, trackPoint } from '../../simulation/track.ts';
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import { rodGeometry } from '../vehicle-bodies/loft.ts';
import { mxFinishPrint } from './mx-event-graphics.ts';
import { mxFurnitureGround } from './mx-ground-pose.ts';
import { mxPaddingGeometry } from './mx-padding.ts';

/** Station zero is the scoring loop on both venues. All geometry is returned
 * in venue coordinates so the normal steel, print and padding passes own it. */
function finishFrame(track: Track) {
  const p = track.at(0, trackPoint());
  const frame = new T.Matrix4().makeRotationY(Math.atan2(p.tx, p.tz)).setPosition(p.x, p.y, p.z);
  const point = (side: number, height: number, along = 0) =>
    new T.Vector3(side, height, along).applyMatrix4(frame);
  return { p, point, frame };
}

export function mxOutdoorFinish(track: Track) {
  const { p, point, frame } = finishFrame(track);
  const surface = Track.offroadOf(track) as TrackTerrainSurface;
  const half =
    Math.max(surface.course.legalWidth(p.width, 0, 1), surface.course.legalWidth(p.width, 0, -1)) +
    1.55;
  const metal: T.BufferGeometry[] = [],
    print: T.BufferGeometry[] = [],
    padding: T.BufferGeometry[] = [];
  const cable = (a: T.Vector3, b: T.Vector3, r: number) => metal.push(rodGeometry(a, b, r, 6));
  const mastTop = 6.99;
  for (const side of [-1, 1]) {
    const x = side * half,
      foot = point(x, 0);
    foot.y = mxFurnitureGround(track, foot.x, foot.z) - 0.04;
    const grade = foot.y - p.y;
    // Two tapered-back stays and bolt shoes support each telescopic mast.
    metal.push(new T.BoxGeometry(0.5, 0.1, 0.62).translate(x, grade + 0.05, 0).applyMatrix4(frame));
    cable(point(x, grade, 0), point(x, 3.65), 0.108);
    cable(point(x, 3.65), point(x, mastTop + 0.12), 0.081);
    for (const z of [-0.57, 0.57]) {
      const anchor = point(x + side * 0.73, 0, z);
      anchor.y = mxFurnitureGround(track, anchor.x, anchor.z);
      metal.push(
        new T.CylinderGeometry(0.12, 0.15, 0.11, 8).translate(anchor.x, anchor.y + 0.03, anchor.z),
      );
      cable(anchor, point(x, 2.45, 0), 0.034);
    }
    for (const y of [3.65, mastTop - 1.37, mastTop - 0.13])
      metal.push(
        new T.CylinderGeometry(0.126, 0.126, 0.074, 10).translate(x, y, 0).applyMatrix4(frame),
      );
    padding.push(
      mxPaddingGeometry('post')
        .rotateX(Math.PI / 2)
        .scale(0.62 / 0.68, 1.65 / 2.1, 0.62 / 0.58)
        .translate(x, grade + 0.83, 0)
        .applyMatrix4(frame),
    );
  }
  const halfPrint = 4.55,
    height = 1.4;
  const sag = (x: number) => 0.34 * (1 - (x / half) ** 2);
  const lineY = (x: number, top: boolean) => mastTop - 0.13 - sag(x) - (top ? 0 : height + 0.17);
  // Piecewise catenary at this small sag. Every shackle lands on an actual
  // cable joint. A sewn double-face banner has a slight corrugated belly.
  const knots = [-half, ...Array.from({ length: 9 }, (_, i) => halfPrint * (i / 4 - 1)), half];
  for (const top of [false, true]) {
    for (let i = 1; i < knots.length; i++)
      cable(
        point(knots[i - 1], lineY(knots[i - 1], top)),
        point(knots[i], lineY(knots[i], top)),
        0.019,
      );
    for (const x of knots.slice(1, -1)) {
      const y = lineY(x, top);
      cable(point(x, y), point(x, y + (top ? -0.1 : 0.1)), 0.018);
    }
  }
  for (const face of [-1, 1]) {
    const g = new T.PlaneGeometry(1, 1, 24, 6),
      pos = g.getAttribute('position');
    const wind = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) * 2 * halfPrint * face,
        v = pos.getY(i) + 0.5;
      const belly = Math.sin(Math.PI * v) * Math.cos((Math.PI * x) / (2 * halfPrint));
      const along = face * 0.014 + belly * (0.045 + 0.042 * Math.sin(2.7 * x + 0.9 * v));
      const y = lineY(x, true) - 0.085 - (1 - v) * height;
      const at = point(x, y, along);
      pos.setXYZ(i, at.x, at.y, at.z);
      wind.set([p.tx * belly * 0.056, p.tz * belly * 0.056, 1.52 * x + 2.1 * y], i * 3);
    }
    // Mirroring only X on the rear face also reverses its outward normal.
    g.computeVertexNormals();
    g.setAttribute('mxCloth', new T.Float32BufferAttribute(wind, 3));
    print.push(mxFinishPrint(g));
  }
  return { metal, print, padding };
}

export function mxArenaFinish(track: Track, roof: { minZ: number; spanZ: number; chordY: number }) {
  const { frame, point } = finishFrame(track);
  const metal: T.BufferGeometry[] = [],
    print: T.BufferGeometry[] = [],
    housing: T.BufferGeometry[] = [];
  const half = 3.85,
    height = 1.18,
    y = 5.88;
  housing.push(
    new T.BoxGeometry(half * 2 + 0.14, height + 0.16, 0.4).translate(0, y, 0).applyMatrix4(frame),
  );
  for (const side of [-1, 1]) {
    const g = new T.PlaneGeometry(half * 2, height);
    if (side < 0) g.rotateY(Math.PI);
    print.push(mxFinishPrint(g.translate(0, y, side * 0.208).applyMatrix4(frame)));
    // Each end has a two-point bridle terminating in one chain block, with
    // a plumb/sloped wire secured to an actual primary roof chord.
    const x = side * (half - 0.42),
      eye = point(x, y + 1.8);
    housing.push(new T.BoxGeometry(0.21, 0.3, 0.18).translate(eye.x, eye.y, eye.z));
    for (const z of [-0.16, 0.16])
      metal.push(
        rodGeometry(point(x + 0.36 * Math.sign(z), y + height / 2 + 0.08, z), eye, 0.025, 6),
      );
    const cell = T.MathUtils.clamp(Math.round(((eye.z - roof.minZ) * 5) / roof.spanZ - 0.5), 0, 4);
    const anchor = new T.Vector3(eye.x, roof.chordY, roof.minZ + ((cell + 0.5) * roof.spanZ) / 5);
    metal.push(rodGeometry(eye, anchor, 0.029, 6));
    metal.push(new T.BoxGeometry(0.22, 0.2, 0.2).translate(anchor.x, anchor.y, anchor.z));
  }
  return { metal, print, housing };
}
