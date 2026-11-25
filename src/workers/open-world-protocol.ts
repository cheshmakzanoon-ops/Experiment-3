import type { Controls } from '../simulation/config.ts';
import type { FestivalResult } from '../simulation/open-world/festival-events.ts';
import type {
  FestivalCommand,
  FestivalStatus,
  FreeRoamOptions,
} from '../simulation/open-world/session.ts';

/** Preserve every status transition, with at most 6.4 seconds of normal 10 Hz
 * delivery queued. A stalled host pauses stepping instead of losing events. */
export const FESTIVAL_STATUS_CAPACITY = 64;

/** Messages to the festival simulation worker. */
export type ToOpenWorld =
  | { type: 'init'; options: Omit<FreeRoamOptions, 'region'> }
  | { type: 'input'; input: Controls }
  | { type: 'pause'; value: boolean }
  | { type: 'statusAck'; sequence: number }
  | { type: 'command'; command: FestivalCommand; requestId?: number }
  | { type: 'recycle'; buffer: ArrayBuffer };
/** Messages from the festival simulation worker. */
export type FromOpenWorld =
  | { type: 'ready'; buildMs: number; vehicle: string }
  /** A snapshot in the circuit layout and, in free roam, the ambient
   * traffic block (ambient-traffic.ts TRAFFIC_HEADER/TRAFFIC_STRIDE). */
  | { type: 'frame'; buffer: ArrayBuffer; traffic?: ArrayBuffer }
  | { type: 'status'; sequence: number; status: FestivalStatus }
  | { type: 'result'; result: FestivalResult }
  | { type: 'command-result'; requestId: number; error?: string }
  /** Fatal simulation/transport failures close the session. Omitted `fatal`
   * preserves the recoverable meaning of older command-error messages. */
  | { type: 'error'; message: string; fatal?: boolean };

/** Messages to the terrain tile worker (render meshes). */
export interface TileRequest {
  type: 'tile';
  id: number;
  /** Tile origin and size (m) and vertices per side minus one. */
  x0: number;
  z0: number;
  size: number;
  res: number;
  /** Tree density for the near, intermediate and distant canopy tiles (0..1). */
  trees: number;
  /** Keep every tree with a trunk collider whatever `trees` is (the
   * finest level, where the car can reach them): physics collides with
   * every trunk, so each must be drawn. */
  colliders?: boolean;
}
export type ToTileWorker = TileRequest | { type: 'cancel'; id: number };
/** A built terrain tile: positions are local to the tile origin. */
export interface TileMeshData {
  type: 'tile';
  id: number;
  /** (res + 1)² heights, normals (xyz), splat weights (rock, soil, sand,
   * snow) and shading masks (road, forest, farm, maintained ground).
   * Positive maintained ground is town paving, negative is airfield or village. */
  heights: Float32Array;
  normals: Float32Array;
  splat: Float32Array;
  shade: Float32Array;
  /** Packed trees (TREE_STRIDE) with ground y appended per tree. */
  trees: Float32Array;
  minY: number;
  maxY: number;
  ms: number;
}
export type FromTileWorker = TileMeshData | { type: 'error'; id: number; message: string };
