import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type {
  ASPHALT_DETAIL,
  ASPHALT_TEXELS,
  ASPHALT_TONE,
  SurfaceKind,
} from '../../src/engine/assets/surface-texel-data.ts';
import type { CircuitFinish } from '../../src/rendering/circuit-finish.ts';

export interface ArrayOracle {
  type: string;
  length: number;
  byteLength: number;
  sha256: string;
  bytes?: string;
}
export interface AsphaltMeansOracle {
  albedo: [number, number, number];
  roughness: number;
}
export interface SurfaceOracleCase {
  name: string;
  kind: SurfaceKind;
  size: number;
  seed: number;
  arrays: Record<'albedo' | 'height' | 'roughness', ArrayOracle>;
  normal: ArrayOracle;
  meso?: ArrayOracle;
  means: AsphaltMeansOracle;
}
export interface FactoryOracleCase {
  name: string;
  kind: SurfaceKind;
  finish: CircuitFinish | null;
  waterFilm: boolean;
  scanned: boolean | null;
  material: Record<string, unknown>;
  shader: {
    uniforms: string[];
    vertexShader: string;
    fragmentShader: string;
    vertexSha256: string;
    fragmentSha256: string;
  };
}
interface SurfaceOracle {
  version: number;
  sourceCommit: string;
  sourceFiles: Record<string, string>;
  captureScriptSHA256: string;
  nodeVersion: string;
  threeRevision: string;
  constants: {
    texels: typeof ASPHALT_TEXELS;
    detail: typeof ASPHALT_DETAIL;
    tone: typeof ASPHALT_TONE;
  };
  formatted: Record<string, string | string[]>;
  cases: SurfaceOracleCase[];
  normalCases: {
    name: string;
    size: number;
    strength: number;
    height: ArrayOracle;
    normal: ArrayOracle;
  }[];
  factories: FactoryOracleCase[];
}

export const sha256 = (bytes: string | Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
export const arrayBytes = (array: ArrayBufferView) =>
  Buffer.from(array.buffer, array.byteOffset, array.byteLength);
// Independently captured from the unedited Three owner at cee488b. No generator,
// golden-update mode or candidate data path is allowed to rewrite this fixture.
export const compressedOracle = readFileSync('tests/fixtures/asphalt-source-cee488b.json.gz');
export const oracle = JSON.parse(gunzipSync(compressedOracle).toString()) as SurfaceOracle;
export const ORACLE_SHA256 = '7f77c6a276a62ab192f571a36746704215260f44d94c31aac2d450e456bd0fc8';
