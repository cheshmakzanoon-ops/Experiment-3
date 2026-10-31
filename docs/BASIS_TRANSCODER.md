# Strict-CSP Basis transcoder

The installed desktop game retains `script-src 'self' 'wasm-unsafe-eval'`. It does **not** permit JavaScript string evaluation. Three 0.180.0's bundled Basis glue creates embind invokers using the Function constructor. Native qualification on `710fb863` caught four startup EvalErrors in the decoder's blob worker; Windows and Apple Silicon completed four driving journeys but correctly failed the final error guard. The errors were reproduced in a Node VM with string code generation disabled.

## Preserve the original codec

The [Three update](https://github.com/mrdoob/three.js/pull/29418) identifies Basis Universal v1.50.0. Upstream tag `v1_50_0`, commit `051ad6d8a64bb95a79e8601c317055fd1782ad3e`, has a prebuilt WASM SHA-256 of `6cf17dc889352c42e9acf8897107978d127005fe3386c36a0e3845e27967630a`, exactly matching the installed Three package. The replacement uses that same source, not a codec upgrade.

The recipe pins Emscripten SDK 4.0.19 at `7b4e60e4bfcba326025e373024369eaa9904af55`, retains upstream codec definitions and enables official `DYNAMIC_EXECUTION=0` and `EMBIND_AOT=1` settings. `HEAP8` is explicitly exported because v1.50's C++ wrappers access `Module.HEAP8.buffer`; newer SDKs no longer expose it implicitly. No runtime monkey patch or CSP exception is used. See [Emscripten settings](https://emscripten.org/docs/tools_reference/settings_reference.html#dynamic-execution) and [upstream strict-CSP guidance](https://github.com/BinomialLLC/basis_universal/tree/master/webgl/transcoder).

## Reproduce

```sh
git clone --branch 4.0.19 --depth 1 https://github.com/emscripten-core/emsdk.git /tmp/emsdk-basis
/tmp/emsdk-basis/emsdk install 4.0.19
/tmp/emsdk-basis/emsdk activate 4.0.19
git clone --filter=blob:none --no-checkout https://github.com/BinomialLLC/basis_universal.git /tmp/basis-source
git -C /tmp/basis-source sparse-checkout set transcoder zstd webgl/transcoder
git -C /tmp/basis-source checkout 051ad6d8a64bb95a79e8601c317055fd1782ad3e
bash scripts/assets/build-basis-csp.sh /tmp/emsdk-basis /tmp/basis-source
npm test -- --run tests/basis-transcoder.test.ts tests/third-party-assets.test.ts
```

The script checks both checkout identities, compiles a matched JS/WASM pair, copies the upstream Apache-2.0 and bundled Zstandard BSD-3-Clause license notices, and writes `public/assets/basis/build.json` with sizes, hashes, settings and recipe identity. It does not change shell startup files or system security. Asset refresh/check commands verify this build and must not overwrite it with the npm package's dynamic glue.

## Verification and limits

- The strict VM retains realm-native Function/WebAssembly, rejects a negative string-generation control, and initializes the rebuilt decoder successfully.
- Three's exact callback/in-place module contract is checked: the supplied object receives APIs, the returned module is that same object, and initialization fires once.
- All **74 shipped KTX2 files**, all mip/face/layer levels and **3,543** format outputs compare exactly to the original decoder: RGBA32 (802), BC7 (802), ASTC (335), ETC1 (477), ETC2 (325), BC1 (477), BC3 (325). No metadata, dimensions, size, status or byte-hash differences were accepted.
- The original dynamic wrapper remains a failing strict-VM control. Artifact and provenance checks accompany decoding tests in native CI.
- A prototype using newer upstream codec source was rejected because 157 ETC1S-to-BC7 outputs changed. A first v1.50 build without explicit HEAP8 export was also rejected. Neither prototype ships.

These local checks do not replace the actual Three blob-worker/desktop CSP journey. Fresh native qualification must confirm that startup EvalErrors are absent. Linux graphics-context losses and the legacy night-preview/preparation failures are separate open issues; this change does not claim to fix them.

## Native result on d063029

The required [native run 41187844014](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41187844014) reports no former CSP EvalErrors on any platform. Windows and Apple Silicon completed every four-mode journey with empty runtime-error, failed-asset and remote-request lists. Linux Mesa separately lost its graphics context during Formula preparation, preventing publication. The [non-publishing SwiftShader comparison](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41187844000) also completed all four journeys without CSP errors. These results verify the decoder repair in the actual worker path; they do not resolve the separate Mesa graphics failure or establish a root cause from one comparison.
