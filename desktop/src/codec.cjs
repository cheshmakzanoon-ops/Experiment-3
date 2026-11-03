'use strict';
/**
 * JSON codec for values the game keeps in IndexedDB (structured-clone data:
 * plain objects, arrays, numbers, and typed arrays such as the ghost-lap
 * Float32Array). Plain JSON would silently turn NaN into null and typed arrays
 * into index-keyed objects, so non-JSON values carry an explicit `$t` tag.
 * Pure Node: no Electron imports, unit-tested from the root vitest suite.
 */

const TYPED = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
};

const bytesOf = (view) => Buffer.from(view.buffer, view.byteOffset, view.byteLength);

function encode(value, path = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return Object.is(value, -0) ? { $t: 'n', v: '-0' } : value;
    return { $t: 'n', v: String(value) };
  }
  if (value === undefined) return { $t: 'u' };
  if (typeof value === 'bigint') return { $t: 'bi', v: value.toString() };
  if (typeof value === 'function' || typeof value === 'symbol')
    throw new TypeError(`Cannot mirror a ${typeof value}`);
  if (path.has(value)) throw new TypeError('Cannot mirror a cyclic value');
  path.add(value);
  try {
    if (value instanceof Date)
      return { $t: 'd', v: Number.isNaN(value.getTime()) ? null : value.toISOString() };
    if (value instanceof ArrayBuffer) return { $t: 'ab', b: Buffer.from(value).toString('base64') };
    if (ArrayBuffer.isView(value)) {
      const kind = value instanceof DataView ? 'DataView' : value.constructor.name;
      if (kind !== 'DataView' && !TYPED[kind]) throw new TypeError(`Cannot mirror ${kind}`);
      // Electron may hand a Float32Array over as a Uint8Array view of the same
      // bytes; the kind travels with the data so the round trip is exact.
      return { $t: 'ta', k: kind, b: bytesOf(value).toString('base64') };
    }
    if (value instanceof Map)
      return { $t: 'm', v: [...value].map(([k, v]) => [encode(k, path), encode(v, path)]) };
    if (value instanceof Set) return { $t: 's', v: [...value].map((v) => encode(v, path)) };
    if (Array.isArray(value)) return Array.from(value, (v) => encode(v, path));
    const out = {};
    for (const key of Object.keys(value)) out[key] = encode(value[key], path);
    return Object.prototype.hasOwnProperty.call(value, '$t') ? { $t: 'o', v: out } : out;
  } finally {
    path.delete(value);
  }
}

function toArrayBuffer(base64) {
  const buffer = Buffer.from(base64, 'base64');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function decode(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decode);
  switch (value.$t) {
    case undefined: {
      const out = {};
      for (const key of Object.keys(value)) out[key] = decode(value[key]);
      return out;
    }
    case 'n':
      return value.v === '-0' ? -0 : Number(value.v);
    case 'u':
      return undefined;
    case 'bi':
      return BigInt(value.v);
    case 'd':
      return new Date(value.v === null ? NaN : value.v);
    case 'ab':
      return toArrayBuffer(value.b);
    case 'ta': {
      const buffer = toArrayBuffer(value.b);
      if (value.k === 'DataView') return new DataView(buffer);
      const Kind = TYPED[value.k];
      if (!Kind) throw new TypeError(`Unknown typed array ${value.k}`);
      return new Kind(buffer);
    }
    case 'm':
      return new Map(value.v.map(([k, v]) => [decode(k), decode(v)]));
    case 's':
      return new Set(value.v.map(decode));
    case 'o': {
      const out = {};
      for (const key of Object.keys(value.v)) out[key] = decode(value.v[key]);
      return out;
    }
    default:
      throw new TypeError(`Unknown mirror tag ${String(value.$t)}`);
  }
}

module.exports = { encode, decode };
