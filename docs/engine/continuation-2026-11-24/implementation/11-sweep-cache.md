# Agent 11 — swept OBB interpolation preparation

Recovered the original implementation and regression tests after the environment loss. This is completion of the same Agent 11 task. All results below were rerun against the reconstructed files.

## Implementation

Implemented physics-audit finding 1 in `src/simulation/obb.ts`. Each `SweptBoxContact` owns two reusable quaternion-arc records. Every `intersect` refreshes the endpoint dot/sign/cosine/angle/sine work before advancement. Interpolation retains the exact `cosine < 1` branch, original sine division, quaternion arithmetic/normalization and centre arithmetic. The existing three-argument, alias-safe public call remains valid. The added preparation and advancement code allocates no objects after query construction.

## Measured result

A direct probe compared the restored reference at `/engine-work-4e0075ccccb3/reference` (coordinator baseline `5edead7`) with the reconstructed production implementation. The new tests independently freeze the old interpolation and advancement arithmetic.

| Rotating-corner fixture | Reference | Optimized |
|---|---:|---:|
| `Math.acos` calls | 6 | 1 |
| `Math.sin` calls | 18 | 13 |
| `Math.hypot` calls | 108 | 108 |
| Advancement iterations | 6 | 6 |

Both return `hit=true`, `fraction=0.39244887098081277`, `exhausted=false`, normal `[-0.8159318100467426, 0, 0.5781481482750299]` and point `[1.15, 0, 1.15]`. The direct probe asserts strict equality; regression comparisons use `Object.is` semantics, including signed zero. Two rotating boxes prepare at most two arcs. These are operation-count improvements, not an FPS claim.

## Verification after recovery

The following command passed **59/59 tests across four files**:

```sh
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/vitest run tests/swept-obb-interpolation-work.test.ts tests/collision-continuous.test.ts tests/collision-query-efficiency.test.ts tests/engine-physics-invariants.test.ts --pool=threads --maxWorkers=1
```

| Suite | Passing tests |
|---|---:|
| `swept-obb-interpolation-work` | 15 |
| `collision-continuous` | 22 |
| `collision-query-efficiency` | 14 |
| `engine-physics-invariants` | 8 |

New coverage includes 512 seeded 3D paths at coordinates through `1e14`; static, antipodal, negative-dot and near-identical rotations on both sides of the branch; changed endpoints with reused queries; approaching/resting/separating time-zero contacts; 80-iteration exhaustion; and standalone interpolation with either endpoint aliased. The frozen reference compares hit, fraction, normal, point, iteration count and exhaustion, including retained outputs on misses.

Scoped ESLint passed with the same lock and 512-MB heap for `src/simulation/obb.ts` and `tests/swept-obb-interpolation-work.test.ts`; Prettier completed for both files. The successful recovery run supersedes the interrupted environment's exit-137 verification attempts. No full-project compiler, npm hooks, commits/pushes, geometry/tuning, character, model, art or environment-content edits were performed.
