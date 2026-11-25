# W01F — Historical native audio reference inputs

## Defect and repair

The native audio comparison previously checked 31 live production files against
their hashes at `350119e8ec0606e8c5de5b3ab80df41104025679`. The legitimate motocross
protocol additions in `a7f1eb9798cc19fd2a1f9abd515de1189231bb2a` therefore stopped
the comparison in `beforeAll`, before any audio contract could run.

`e2e/fixtures/engine-native-audio-reference-inputs.json` now contains the exact
UTF-8 bytes of every original manifest `unchanged` entry, retrieved with
`git show <original-commit>:<path>`. All 31 files, totaling **258,151 bytes**, passed
both the existing SHA-256 and Git blob checks. UTF-8 decode/re-encode equality
was also checked. The original manifest and its **7,256-byte** loudness source
remain untouched; that loudness text was independently compared with Git.

The spec checks the archive commit, exact path set and both hashes before
building. Its original-only resolver admits only the verified archive and the
existing loudness text. `onLoad` supplies those sources at their original
resolve directories. The metafile must contain exactly those 32 sources and
the synthetic entry; there is no live-source fallback. The candidate bundle
continues to read live production sources and reports its input paths and
current hashes in the existing attachments.

Only the assigned spec, new archive and this report were written. No production
source, original manifest, numeric threshold or native assertion was changed.

## Focused verification

- Focused TypeScript checking of the spec and its imported graph passed with
  the repository's compiler settings (`tsc --noEmit --target ES2022 --lib
ES2022,DOM,DOM.Iterable --module ESNext --moduleResolution Bundler --strict
--allowImportingTsExtensions --resolveJsonModule --isolatedModules
--skipLibCheck --types vite/client,node
e2e/engine-native-audio-advancement.spec.ts`).
- The actual `beforeAll` callback, compiled with esbuild and captured through
  a test-registration shim, completed both builds and all integrity assertions.
  The live protocol hash differed from the original hash, reproducing the
  formerly blocking condition without editing a production file.
- Negative controls were rejected: one changed archived byte sequence, one
  extra archive path, and a reference import of live-only `src/ui/ui-cue.ts`.
  The last failed with `Unarchived original audio dependency`.
- All spec text from `async function load` onward is byte-for-byte equal to
  `HEAD`, including both native test bodies, sample counts, tolerance formulas,
  sensitivity controls and cleanup assertions.
- esbuild version: `0.25.12`. Archive: **267,688 bytes**, SHA-256
  `350202a7895cfa9e4fa4f749159497c2aeed4f72b6da4afe861336d477048b5d`.
  Original bundle: **172,971 bytes**, SHA-256
  `ba2cb7dc479f82338490b8f8f729aab8b0b697b3ce37cd427d8972a3bf52be69`.
  Live fixture bundle at verification: **210,601 bytes**, SHA-256
  `e65be3758901ff6fd07639bd1d26e0506eb184733d04e1284141a09c9feec497`.

The isolated verification script is retained at
`/home/agent/motobound-engine-1a587ba11b3c/tmp/w01f-verify-audio-reference.mjs`.
This worker did not run native browser validation, a production build or the
full suite. Root owns the browser acceptance and integration results.
