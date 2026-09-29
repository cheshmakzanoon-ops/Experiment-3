# A21 publication and validation receipt

## Published implementation

Implementation commit: `a80fd95df7a54d7751ac1d47bdbc33b5bfdc3043`.
Parent: `6071a3454a401bdc6b4fef7a67821580b7a4ab8a`.
Implementation tree: `a9dfe371ec9fa1277a9353b7e9c8ef00a03bf819`.

This receipt and the A21 row in `3dmodels.md` are documentation-only additions to that implementation. A21 adds four frontage sections around all twelve existing garages, three detail levels per section, and 43 placement sockets. Its integration preserves A22/A24/A31/A33/A34/A35 and the concurrent A26 authoring helpers; it changes no simulation, player car, cockpit, or driver source.

## Selected runtime asset

- File: `public/models/aurel-hero-pit-building-frontage.glb`.
- Bytes: 4,981,240.
- SHA-256: `e9f4710bd48b8e6d3d1aa4a09e5341ec0a568d56e0e08169333da77033723f6f`.
- Git blob: `0640e3b5086ee2c54d0abbe1ce8feef4e5726cc9`.
- Total triangles with all four sections at the same detail level: 101,516 / 13,436 / 5,064.
- Nine shared materials and three original embedded 256 x 256 surface maps.
- Editable source: `scripts/aurel-hero-pit-building-frontage.blend`, Git blob `a2bc7be56340150343b7b880e695d36d03af193d`.

## Hosted test evidence

[Final A35-inclusive candidate run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/36637038410) applied the A21 candidate to `8ac5ebc940c798a0583f79e6beec801e0423d3d8` before running its checks. The run head alone is therefore not the tested application tree.

- `npm run check`: lint, 1,377 unit tests across 142 files, and production build passed.
- A21/A22/A24/A35 browser suite: 17 tests passed, zero failures, retries, or skips.
- The A21 browser surveys retained 28 images: seven real-circuit views in day, sunset, dry night, and rainy night.
- A subsequent concurrent advance to `6071a3` changed only A26 authoring helpers. After reconciling that advance, 39 focused unit tests and the production build passed again.

That workflow's overall result was **failure**, because its automatic push could not add a workflow file with its Actions token. The failed publication step is not a failed geometry or browser test. Publication of the implementation commit was subsequently verified through GitHub's `main` reference. This receipt does not convert the failed workflow into a successful workflow.

The browser report is retained in artifact `11064688959`, `a21-final-integration-evidence`, SHA-256 `5e111b56b75b0c4d0aef8904bc9cdf75e0b41e7f093a82548250ff8ee8b781d6`.

[Earlier expanded candidate run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/36633854207) passed lint, 1,366 unit tests, the build, and 25 browser tests including A31/A33/A34. It predates A35 and is supplementary evidence, not a substitute for the final combined candidate. Its artifact is `11064227971`, SHA-256 `7b03802d294e18775900fb485b1eb9f2f732a65ed6242a6093c5452ff33dbdb5`.

## Validation boundaries

The local system-browser attempt was not a pass: normal startup encountered an administrator restriction on localhost and one graphics survey reported a WebGL error. Those diagnostics were retained rather than removing assertions or weakening the hosted gates. The hosted pinned-browser results above are the relevant completed browser evidence.

The post-publication full `main` workflow is a separate regression run; its status must be read from that exact commit's checks, not inferred from these candidate results. A fixed-camera survey is not a driven-lap review or a representative-hardware frame-rate benchmark. `finalArtApproved` remains false. Richer surface aging, final art review, hardware profiling, and the separate cockpit-camera repair remain open. Source publication alone does not establish a redeployment of an independently hosted website.

See [A21 implementation and reproduction notes](A21_HERO_PIT_BUILDING.md) for export identity, placement, ownership, and test commands.
