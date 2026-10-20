import * as T from 'three';
import { clamp, mod } from '../../core/math.ts';
import { gpCornerShapes, isGpCourse } from '../../simulation/gp-corner-shape.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { canvasTexture, mergeStatic } from '../geometry.ts';
import { installCircuitFinish } from '../circuit-finish.ts';
import { inStandFootprint } from '../grandstand.ts';
import { tagWeatherSurface } from '../weather-presentation.ts';
import type { VenueKitContext } from './context.ts';

export interface GpCourseBoard {
  corner: number;
  name: string;
  direction: 'left' | 'right';
  /** Physical metres before the sampled beginning of this bend. Null is its
   * identification panel, not a braking recommendation. */
  distance: number | null;
  entry: number;
  s: number;
  side: -1 | 1;
}

export const GP_BOARD_DISTANCES = [200, 150, 100, 50] as const;
const SETBACK = 2.4;

/** Permanent course references. Distance boards belong on the preceding
 * straight and measure to the same road-shaped entry used by the rider guide.
 * A fixed apex-minus-40 datum used to put them inside longer turns. Short
 * linked turns receive an identity panel without importing the previous
 * corner's braking zone. These are distances, never promised safe speeds. */
export function gpCourseBoardPlan(track: Track): readonly GpCourseBoard[] {
  if (!isGpCourse(track)) return [];
  const corners = track.circuit.corners,
    shapes = gpCornerShapes(track),
    p = trackPoint(),
    boards: GpCourseBoard[] = [];
  for (let index = 0; index < corners.length; index++) {
    const corner = corners[index],
      shape = shapes[index];
    if (shape.direction === 'straight') continue;
    const entry = mod(corner.s - shape.entry, track.length),
      side = shape.direction === 'left' ? -1 : 1;
    let available = track.length;
    for (let previous = 0; previous < corners.length; previous++) {
      if (previous === index) continue;
      const gap = mod(entry - corners[previous].s - shapes[previous].exit, track.length);
      available = Math.min(available, gap);
    }
    const append = (distance: number | null, s: number) => {
      const station = mod(s, track.length);
      // Keep the pit merge and pit approach free of ambiguous extra boards.
      if (side === track.pit.side && track.isPitSection(station)) return;
      boards.push({
        corner: index,
        name: corner.name,
        direction: shape.direction as 'left' | 'right',
        distance,
        entry,
        s: station,
        side,
      });
    };
    for (const distance of GP_BOARD_DISTANCES) {
      if (available < distance + 16) continue;
      const station = entry - distance;
      let straight = true;
      for (const offset of [-12, 0, 12])
        if (Math.abs(track.at(station + offset, p).curvature) > 1 / 350) straight = false;
      if (straight) append(distance, station);
    }
    append(null, entry - 10);
  }
  return boards;
}

/** The printed face points at an approaching rider's eye, including when the
 * marker stands far beyond a wide gravel trap. Supports start below the verge
 * plane rather than leaving a floating square beside the circuit. */
export function gpBoardPlacement(track: Track, board: GpCourseBoard) {
  const p = track.at(board.s, trackPoint()),
    lateral = board.side * (track.boundaryAt(p, board.side) + SETBACK),
    x = p.x + p.nx * lateral,
    z = p.z + p.nz * lateral,
    ground = p.y + p.bank * clamp(lateral, -12, 12) - 0.12,
    approach = track.at(board.s - 38, trackPoint());
  return {
    x,
    y: ground,
    z,
    yaw: Math.atan2(approach.x - x, approach.z - z),
    width: board.distance === null ? 2.8 : 1.12,
    height: board.distance === null ? 1.12 : 1.5,
    centre: board.distance === null ? 2.02 : 1.91,
  };
}

const ACCENTS: Record<string, string> = {
  'poggio-alto': '#b93d35',
  'cape-wrenna': '#3c7395',
  haarveld: '#345aa0',
  montejaral: '#bc7733',
  steinhorn: '#2d8fa1',
  'zafra-night': '#c09a45',
};

/** One bounded atlas per venue, generated once at construction. Corners and
 * distance boards share it; no per-board texture, external artwork, update
 * loop or session history is needed. Cell gutters protect lower mip levels. */
function boardAtlas(track: Track) {
  const columns = 4,
    rows = 8,
    width = 1024,
    height = 1024,
    cellWidth = width / columns,
    cellHeight = height / rows,
    count = GP_BOARD_DISTANCES.length + track.circuit.corners.length,
    shapes = gpCornerShapes(track);
  if (count > columns * rows) throw new Error('GP course board atlas capacity exceeded');
  const map = canvasTexture(width, height, (c) => {
    c.fillStyle = '#eae9de';
    c.fillRect(0, 0, width, height);
    for (let slot = 0; slot < count; slot++) {
      const x = (slot % columns) * cellWidth,
        y = Math.floor(slot / columns) * cellHeight,
        distance = slot < GP_BOARD_DISTANCES.length ? GP_BOARD_DISTANCES[slot] : null;
      c.fillStyle = distance === null ? '#1c292f' : '#eae9de';
      c.fillRect(x, y, cellWidth, cellHeight);
      c.save();
      c.translate(x + 4, y + 4);
      c.scale((cellWidth - 8) / 256, (cellHeight - 8) / 128);
      c.fillStyle = ACCENTS[track.circuit.id];
      c.fillRect(0, 0, 8, 128);
      c.textBaseline = 'middle';
      if (distance !== null) {
        // The cell maps to a tall plate, so compressed glyphs here recover
        // their intended proportions on the 1.12 x 1.5 m printed surface.
        c.textAlign = 'center';
        c.fillStyle = '#20282b';
        c.font = '800 62px Arial';
        c.fillText(String(distance), 130, 54, 224);
        c.font = '700 11px Arial';
        c.fillText('m', 130, 104, 218);
      } else {
        const index = slot - GP_BOARD_DISTANCES.length,
          corner = track.circuit.corners[index],
          shape = shapes[index];
        c.fillStyle = '#f3f1e7';
        c.textAlign = 'left';
        c.font = '800 54px Arial';
        c.fillText(`T${String(index + 1).padStart(2, '0')}`, 22, 46, 132);
        c.font = '700 18px Arial';
        c.fillText(corner.name, 22, 98, 218);
        const left = shape.direction === 'left',
          tip = left ? 175 : 233,
          tail = left ? 231 : 177,
          delta = left ? 16 : -16;
        c.strokeStyle = '#f3f1e7';
        c.lineWidth = 7;
        c.lineJoin = 'round';
        c.beginPath();
        c.moveTo(tail, 43);
        c.lineTo(tip, 43);
        c.moveTo(tip + delta, 27);
        c.lineTo(tip, 43);
        c.lineTo(tip + delta, 59);
        c.stroke();
      }
      c.restore();
    }
  });
  map.name = 'GP course identifiers and entry-distance atlas';
  return { map, columns, rows };
}

export function gpBoardFaceGeometry(
  width: number,
  height: number,
  slot: number,
  columns = 4,
  rows = 8,
) {
  const geometry = new T.PlaneGeometry(width, height),
    uv = geometry.getAttribute('uv'),
    column = slot % columns,
    row = Math.floor(slot / columns);
  for (let i = 0; i < uv.count; i++)
    uv.setXY(
      i,
      (column + (4 + uv.getX(i) * 248) / 256) / columns,
      1 - (row + (4 + (1 - uv.getY(i)) * 120) / 128) / rows,
    );
  return geometry;
}

export function buildGpCourseBoards(kit: VenueKitContext) {
  const track = kit.track,
    plan = gpCourseBoardPlan(track);
  if (!plan.length) return;
  const atlas = boardAtlas(track),
    printed = new T.MeshStandardMaterial({
      map: atlas.map,
      roughness: 0.7,
      metalness: 0.02,
      // The print sits on its backing plate. At approach distance, depth
      // quantisation otherwise lets the dark shell break through the glyphs.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    }),
    groups = new Map<number, T.Group>();
  installCircuitFinish(printed, 'paint');
  tagWeatherSurface(printed, 'paint');
  printed.name = 'GP weathered printed course panels';
  for (const board of plan) {
    const f = gpBoardPlacement(track, board);
    // Verify the entire panel footprint, not only its centre. A nearby
    // hairpin, spectator deck or garage must never be pierced by a marker.
    let clear = true;
    for (const x of [-f.width / 2 - 0.15, 0, f.width / 2 + 0.15]) {
      const wx = f.x + Math.cos(f.yaw) * x,
        wz = f.z - Math.sin(f.yaw) * x;
      if (
        kit.overOtherSection(wx, wz, board.s, 2) ||
        inStandFootprint(track, wx, wz, 0.2) ||
        kit.blocks(wx, wz, 0.2)
      )
        clear = false;
    }
    if (!clear) continue;
    let group = groups.get(board.corner);
    if (!group) {
      group = new T.Group();
      group.name = `GP T${board.corner + 1} ${board.name} approach markers`;
      group.userData.boards = [] as GpCourseBoard[];
      groups.set(board.corner, group);
    }
    (group.userData.boards as GpCourseBoard[]).push(board);
    const root = new T.Group();
    root.position.set(f.x, f.y, f.z);
    root.rotation.y = f.yaw;
    group.add(root);
    const shell = new T.Mesh(
      new T.BoxGeometry(f.width + 0.07, f.height + 0.07, 0.07),
      kit.materials.darkSteel,
    );
    shell.position.y = f.centre;
    shell.castShadow = shell.receiveShadow = true;
    root.add(shell);
    const slot =
        board.distance === null
          ? GP_BOARD_DISTANCES.length + board.corner
          : GP_BOARD_DISTANCES.indexOf(board.distance as (typeof GP_BOARD_DISTANCES)[number]),
      face = new T.Mesh(gpBoardFaceGeometry(f.width, f.height, slot), printed);
    face.position.set(0, f.centre, 0.036);
    face.receiveShadow = true;
    root.add(face);
    const poleHeight = f.centre + f.height / 2 + 0.05;
    for (const x of board.distance === null ? [-0.86, 0.86] : [0]) {
      const pole = new T.Mesh(new T.BoxGeometry(0.06, poleHeight + 0.3, 0.07), kit.materials.steel);
      pole.position.set(x, (poleHeight - 0.3) / 2, -0.09);
      pole.castShadow = pole.receiveShadow = true;
      root.add(pole);
    }
  }
  if (!groups.size) {
    printed.dispose();
    atlas.map.dispose();
    return;
  }
  for (const group of groups.values()) {
    mergeStatic(group);
    // One local group per approach: the old single venue-wide 600 m switch
    // could hide nearby boards on the opposite end of a large GP circuit.
    kit.detail(group, 650);
  }
}
