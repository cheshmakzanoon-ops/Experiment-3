# Babylon original-player primitive bindings · 2026-10-31

Increment A, developed from source `ac270f72ca26675c235495bfee34af51e6e13f29`.
This is an asset-contract migration step, not a Linux graphics repair or release qualification.

## Scope and ownership

- `src/engine/assets/player-lod-data.ts` contains the existing renderer-independent PLD2 parser, types and bounded transport. Extraction is identical after import-path normalization. `src/rendering/supplied-player-lods.ts` retains its existing exports and Three geometry implementation.
- `src/engine/babylon/existing-player-primitives.ts` derives immutable source descriptors from the already hash-verified original GLB, binds actual imported primitives/materials/joint palette, and can independently join parsed PLD2 rows.
- `src/engine/babylon/existing-player.ts` validates the mapping before returning its container. Validation/cancellation failure disposes the unpublished container; a cleanup error is logged without masking the original failure. A WeakMap accessor exposes existing resource references, not new scene ownership.
- **Full detail remains selected.** No derivative request, tier switch, vertex/index rewrite, mesh merge, material replacement, animation change, physics change or new GPU resource/query hook is introduced. The existing compilation, GPU-completion, native Mesa, security and deadline gates remain unchanged.

## Actual-asset evidence

`tests/babylon-existing-player-primitives.test.ts` imports the unmodified, hash-verified GLB with Babylon's normal `LoadAssetContainerAsync` options and NullEngine. It does not strip textures, rewrite the GLB, skip materials or fetch a decoder. The import makes only the original asset request through the test's local response.

Observed inventory:

| Item | Count |
| --- | ---: |
| Source glTF meshes / uniquely owning source nodes | 18 / 18 |
| Bound primitives / geometries | 172 / 172 |
| Babylon meshes, including the empty loader root | 173 |
| Materials / texture objects | 101 / 82 |
| Skinned / rigid primitives | 61 / 111 |
| Full-detail triangles | 1,455,118 |
| Source skin palette joints | 58 |
| Babylon bones | 59 |

The additional Babylon bone is the retained `F1CP_ARMATURE` ancestor, palette index `-1`, linked to source node 63. The contract verifies all **58 palette-index-to-source-node mappings**, not the incorrect assumption that total Babylon bones must equal source joint count. Existing hierarchy and animation targets are retained. Recorded source owner-node IDs are not a claim of imported-hierarchy parity: Babylon deliberately reparents skinned render meshes beside the skeleton root.

The test compares every imported original index and position/normal/UV/joint/weight value against its original GLB accessor. It also proves resource-reference identity before/after binding, preserves parents/local transforms, rejects malformed/missing/duplicate mappings, is independent of imported mesh names/enumeration order, rejects mismatched PLD2 rows, and exercises failure/cancellation cleanup.

## Version-sensitive boundary

Babylon 9.33.1 records source pointers in `_internalMetadata.gltf.pointers`:

- `/meshes/<mesh>/primitives/<primitive>`
- `/materials/<material>`
- `/nodes/<jointNode>` on linked joint transforms

This internal API is isolated in one helper. Missing or ambiguous pointers fail closed. Package upgrades must rerun the actual-GLB contract; mesh names/order are not fallback identifiers.

## Reproducible receipt

- Original compressed GLB SHA-256: `269b4d94c07602582070f1f48bc2e3a778f62d2e1cfcc26b021f52f79ad5ef3a`
- Original decoded GLB SHA-256: `013a47f059bf34a0a28bd31ae8f407f07ed6e2b55755753aed9a942c895e132b`
- Existing compressed PLD2 SHA-256: `1553e32eef4a6f89d02fb8f44a45f000620ee8539466d41704654e5f5dd09b58`
- Mapping receipt SHA-256: `732400ba6ad1e43e071e08255bd7b3be91bb1004bd0e082a1d8f520f7b451f3e`

The mapping receipt hashes compact JSON records in source mesh/primitive order:
`[nodeIndex, meshIndex, primitiveIndex, materialIndex, indicesAccessor, sortedAttributes, vertexCount, originalIndexCount]`.
The new actual-import test reproduces the earlier read-only source/PLD2 audit receipt.

## Validation and limits

- Affected Babylon and supplied-asset suites: **178 tests passed across 20 files**.
- After strengthening resource comparisons to identity checks, the new binding suite repeated **9/9 passed**.
- Targeted ESLint, TypeScript and whitespace checks passed during development; the publishing owner runs combined final-candidate checks.
- No local browser, GPU benchmark, native package qualification or production build was run by this increment's author.

**NullEngine proves data/import/ownership contracts only.** It does not decode and render texture pixels like a real GPU backend, establish material/visual parity, certify performance or replace native Mesa acceptance. Index switching, distance/quality policy integration, tyre deformation/blur, service removal and full four-discipline Babylon presentation remain subsequent work.
