import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

/** Captured from the actual original factory and StudioFrame before extraction.
 * Never regenerate expected values from the renderer-neutral helper. */
export const GROUNDING_ORACLE_SHA256 =
  '6156be159c6826b87dda551ee6dd0b564ff571a4fbd5695cb87a7d5b91fde7fe';
export const groundingOracleBytes = readFileSync(
  new URL('./formula-grounding-source-2041020.json.gz', import.meta.url),
);
export const sha256 = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');

export interface GroundingArrayOracle {
  type: string;
  length: number;
  bytes: string;
  sha256: string;
}
interface GroundingObservation {
  reset?: boolean;
  input?: GroundingArrayOracle;
  view?: string;
  aspect?: number;
  cameraX?: number;
  error?: { name: string; message: string } | null;
  result: {
    uniforms: GroundingArrayOracle;
    poses: GroundingArrayOracle;
    diagnostics: Record<string, unknown>;
  };
}
interface GroundingOracle {
  version: number;
  sourceCommit: string;
  nodeVersion: string;
  threeRevision: string;
  captureScriptSha256: string;
  moduleLoader: string;
  sourceFiles: Record<string, string>;
  constants: {
    grounding: Record<string, number>;
    footprint: { name: string; centre: number[]; half: number[]; strength: number }[];
    tyres: { across: number; front: number; rear: number; half: number[] };
    maxCars: number;
    mounts: number[][];
  };
  formatted: Record<string, unknown>;
  cases: { name: string; observations: GroundingObservation[] }[];
  cpu: { inputs: GroundingArrayOracle; output: GroundingArrayOracle };
  factories: {
    name: string;
    firstInstall: boolean;
    repeatInstall: boolean;
    material: Record<string, unknown>;
    shader: {
      vertexShader: string;
      fragmentShader: string;
      vertexSha256: string;
      fragmentSha256: string;
      uniformNames: string[];
      sharedGroundUniforms: { name: string; shared: boolean }[];
    };
  }[];
}
export const groundingOracle: GroundingOracle = JSON.parse(
  gunzipSync(groundingOracleBytes).toString('utf8'),
);
export function arrayBytes(value: ArrayBufferView) {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}
export function decodeFloat32(value: GroundingArrayOracle) {
  const result = new Float32Array(value.length);
  new Uint8Array(result.buffer).set(Buffer.from(value.bytes, 'base64'));
  return result;
}
export function decodeFloat64(value: GroundingArrayOracle) {
  const result = new Float64Array(value.length);
  new Uint8Array(result.buffer).set(Buffer.from(value.bytes, 'base64'));
  return result;
}
