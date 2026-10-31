import { verifyBasisTranscoder } from '../scripts/assets/basis-contract.ts';
import { beforeAll, expect, it } from 'vitest';
import { createContext, runInContext, type Context } from 'node:vm';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import receipt from '../public/assets/basis/build.json' with { type: 'json' };

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const shipped = 'public/assets/basis';
const reference = 'node_modules/three/examples/jsm/libs/basis';
async function decoder(directory: string, strict: boolean) {
  // Keep Function and WebAssembly native to the realm. Injecting host versions
  // would make this an invalid test of the desktop's no-string-evaluation rule.
  const context = createContext(
    {
      console,
      setTimeout,
      clearTimeout,
      wasmBytes: Array.from(readFileSync(join(directory, 'basis_transcoder.wasm'))),
    },
    { codeGeneration: { strings: !strict, wasm: true } },
  );
  if (strict) expect(() => runInContext('Function("return 1")()', context)).toThrow();
  runInContext(readFileSync(join(directory, 'basis_transcoder.js'), 'utf8'), context);
  await runInContext(
    `
    globalThis.callbackCount = 0;
    globalThis.input = { wasmBinary: new Uint8Array(wasmBytes), onRuntimeInitialized() { callbackCount++; } };
    BASIS(input).then(result => { globalThis.result = result; });
  `,
    context,
  );
  // Three's worker ignores the returned Promise and consumes this input object.
  expect(runInContext('input === result && callbackCount === 1', context)).toBe(true);
  expect(runInContext('typeof input.initializeBasis', context)).toBe('function');
  expect(runInContext('typeof input.KTX2File', context)).toBe('function');
  expect(runInContext('input.HEAP8 instanceof Int8Array', context)).toBe(true);
  runInContext('input.initializeBasis()', context);
  return context;
}
let old: Context, safe: Context;
beforeAll(async () => {
  old = await decoder(reference, false);
  safe = await decoder(shipped, true);
});
it('pins the original codec, static-wrapper settings, license and reproducible artifacts', () => {
  verifyBasisTranscoder(process.cwd());
  expect(receipt.source.commit).toBe('051ad6d8a64bb95a79e8601c317055fd1782ad3e');
  expect(receipt.compiler.sdkVersion).toBe('4.0.19');
  expect(receipt.settings).toMatchObject({
    DYNAMIC_EXECUTION: 0,
    EMBIND_AOT: 1,
    EXPORTED_RUNTIME_METHODS: ['HEAP8'],
  });
  expect(hash(readFileSync(join(reference, 'basis_transcoder.wasm')))).toBe(
    receipt.reference.wasmSHA256,
  );
  expect(hash(readFileSync(receipt.recipe))).toBe(receipt.recipeSHA256);
  for (const [name, info] of Object.entries(receipt.files)) {
    const bytes = readFileSync(join(shipped, name));
    expect(bytes.length).toBe(info.bytes);
    expect(hash(bytes)).toBe(info.sha256);
  }
});
it('preserves the existing offline CommonJS authoring-tool loader', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'basis-cjs-contract-'));
  try {
    const file = join(directory, 'basis.cjs');
    writeFileSync(file, readFileSync(join(shipped, 'basis_transcoder.js')));
    const factory = createRequire(import.meta.url)(file) as (options: {
      wasmBinary: Uint8Array;
    }) => Promise<{ initializeBasis(): void; KTX2File: unknown }>;
    const module = await factory({
      wasmBinary: readFileSync(join(shipped, 'basis_transcoder.wasm')),
    });
    module.initializeBasis();
    expect(typeof module.KTX2File).toBe('function');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it('demonstrates that the original dynamic wrapper is rejected by the strict realm', async () => {
  await expect(decoder(reference, true)).rejects.toThrow(/Code generation from strings/);
});

const decode = `(() => {
  const file = new input.KTX2File(new Uint8Array(fileBytes));
  try {
    if (!file.isValid()) throw Error('Invalid shipped KTX2');
    const metadata = { width: file.getWidth(), height: file.getHeight(), layers: file.getLayers(),
      levels: file.getLevels(), faces: file.getFaces(), alpha: file.getHasAlpha(),
      uastc: file.isUASTC(), etc1s: file.isETC1S(), dfdFlags: file.getDFDFlags() };
    if (!file.startTranscoding()) throw Error('Could not start transcoding');
    const outputs = [];
    // Actual loader targets: RGBA32, BC7, ETC1/ETC2, BC1/BC3 and UASTC ASTC.
    const formats = [13, 7, metadata.alpha ? 1 : 0, metadata.alpha ? 3 : 2, ...(metadata.uastc ? [10] : [])];
    for (const format of formats) for (let level = 0; level < metadata.levels; level++)
      for (let face = 0; face < metadata.faces; face++) for (let layer = 0; layer < (metadata.layers || 1); layer++) {
        const info = file.getImageLevelInfo(level, layer, face);
        const bytes = new Uint8Array(file.getImageTranscodedSizeInBytes(level, layer, face, format));
        if (!file.transcodeImage(bytes, level, layer, face, format, 0, -1, -1)) throw Error('Transcode failed');
        outputs.push({ format, level, face, layer, width: info.origWidth, height: info.origHeight, bytes });
      }
    return { metadata, outputs };
  } finally { file.close(); file.delete(); }
})()`;
interface Decoded {
  metadata: Record<string, number | boolean>;
  outputs: {
    format: number;
    level: number;
    face: number;
    layer: number;
    width: number;
    height: number;
    bytes: Uint8Array;
  }[];
}
function inspect(context: Context, bytes: Uint8Array) {
  context.fileBytes = Array.from(bytes);
  const result = runInContext(decode, context) as Decoded;
  return {
    metadata: JSON.parse(JSON.stringify(result.metadata)),
    outputs: result.outputs.map(({ bytes, ...info }) => ({
      ...info,
      size: bytes.length,
      sha256: hash(bytes),
    })),
  };
}
const textures = readdirSync('public', { recursive: true })
  .filter((p): p is string => typeof p === 'string' && p.endsWith('.ktx2'))
  .sort();
it.each(textures)('preserves every mip and supported transcode output of %s', (file) => {
  const bytes = readFileSync(join('public', file));
  expect(inspect(safe, bytes)).toEqual(inspect(old, bytes));
});
