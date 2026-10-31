# Isolated Formula road and edge-paint probe

This boundary is **not enabled in BabylonCircuitScene or main**. The live
workbench road remains unchanged. The isolated probe is restricted to original
Aurel/Vellamar circuit definitions and explicit Formula/circuit context; GP,
MX/SX, open-world, non-Formula and unknown contexts are rejected before allocation.

## Preserved source content

- `tyre-mark-zones.ts` moves existing TYRE_MARKS and zone calculation unchanged;
  `circuit-line-profile.ts` moves original profile/cache/sample/apex calculation.
  Three import paths retain compatibility exports and share the same caches.
  No simulation algorithms or physics constants are changed.
- `indexed-ribbon-normals.ts` implements Three r180's indexed area weighting,
  Float32 accumulation/write order and reciprocal sqrt normalization, including
  degenerate vertices. Full upstream MIT notice is retained. Babylon's
  face-normalized ComputeNormals is deliberately not used. Existing Three
  computeVertexNormals remains unchanged.
- The isolated adapter uses the verified shared ribbon generator: original road
  14 columns/1.8 m step/zero lift; both 14 cm edge bands at +.006 m and 2 m step.
  Chunk boundaries remain <=80 m with original numeric ordering, no seam welding.
  UVs, trackUV, edgeMetres, apexLine, apexBikeBrake and strip metadata remain intact.
  Road and paint are generated together, not paint buried under the diagnostic
  live road's +.010 m lift. Pit lanes/kerbs/runoff are outside this boundary.
- Paint uses exact original sRGB-to-linear colour 0xe9e7e0, roughness .55,
  metallic zero. Its material-local plugin applies the existing world-space
  grit/wear noise and derivative filtering to linear albedo. It has a persistent
  unique define for composed shader-cache identity and owns no samplers, textures,
  uniforms, timers or global shader state. Colour-transfer attribution is retained.

## Explicit remaining limitations

Road material is a labelled diagnostic, **not** the original asphalt material:
wet state/reflections, asphalt micro/meso detail, scanned ground, rubber and other
road hooks are unported. Paint grounding and light-pool hooks remain unported.
No claims of final material, lighting, atmosphere or whole-scene visual parity.
No source texture is replaced and no new artwork is introduced.

Babylon PBR constructors create/reuse the engine-managed scene environment-BRDF
LUT. This shared engine texture is not an authored paint texture or owned by the
adapter. Tests distinguish that existing PBR dependency from adapter texture
allocation; scene disposal owns the LUT. Chunk meshes/materials belong to the
adapter, with idempotent explicit teardown and scene-first ownership handling.
Construction must occur under exclusive idle presentation/GPU preparation
ownership; this synchronous probe API is not a live gameplay installation hook.

## Evidence and acceptance

The a937 independent ribbon fixtures and hashes are unchanged and never
regenerated. Tests compare all captured normal bytes across all 13 representative
cases and the original Uint32 stress normal hash, plus zero/repeated-index cases.
Existing ribbon oracle, road-detail and tyre-mark tests cover compatibility.
Neutral dependency checks include transitive imports. NullEngine checks compare
actual original Three road/paint buffers, strip metadata and exact linear colour
on both venues, plus unsupported-context rejection, plugin cache identity,
partial-construction cleanup and scene-first/explicit disposal.

Real WebGL evidence is **pending** for this boundary. The dedicated probe must
compare the actual original Three paint finish against the actual Babylon plugin
in controlled linear-factor output, plus bank/seam/grazing visibility and real
GL/frame/disposal evidence. CPU/NullEngine success does not establish shader
compilation, paint visibility, native stability or final visual acceptance.
There is no extra native launch workload and no live road activation.

### Visibility evidence boundary

Each paint chunk retains its authored lateral side (-1 or +1), while all paint
chunks retain the same actual material. The diagnostic ID pass encodes those
authored identities in distinct colours, not screen-half occupancy. Pixel counts
prove visibility of both bands, not continuous coverage across a seam. Seam
continuity remains geometry evidence plus manual review of retained lit/ID
images; this probe makes no automated pixel-continuity claim.
