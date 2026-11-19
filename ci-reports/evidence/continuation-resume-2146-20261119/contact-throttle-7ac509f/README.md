# Contact/throttle candidate — completed rejection

Source: `7ac509f9198ae5d5b06c9a17edd2177caa799115`, based on published `ffd22598335dfa2a074ebd466e1d53830bb8bb41`. This combines the reviewed AI/contact acceleration handoff and steering-throttle ownership correction. The native Bike and MotoGP core files remain identical to published main.

The authoritative guarded invocation and full command are in `contact-throttle-original51-and-native.json`. It completed in 455.004 s with all 7,460 protected inputs unchanged, child exit 1 and `passed: false`. The exact count is **73/76 passing**, comprising **48/51 original acceptance cases and 25/25 added native cases**.

| Original failed case | Actual result | Required result |
| --- | --- | --- |
| Mixed Parco Reale, seed5074 | One crash | Zero |
| Mixed Vellamar, seed5222 | Two crashes | Zero |
| All-GP Ardennes hairpin, seed1000 | Car1 falls at station3148.429820123317 before the flag | No falls |

Each failed scenario passed its preceding finished-race assertion. Assertions after the failed expectation were not established. The original snapshot, mixed3303 pace, dry Aurel, dry and wet Poggio, and Ardennes1037 cases passed in this same full run.

The retained complete log and protected-input manifest are compressed losslessly. Their original sizes and SHA-256 values are pinned in `copy-provenance.json`; `SHA256SUMS` covers the retained evidence existing before this README. A separate reviewer compared every one of the 7,458 tracked protected inputs with immutable Git blob bytes; the two other entries are worktree metadata and dependency-link identity. `independent-review.json` retains the original source review.

`candidate-from-ffd2259.patch` reproduces the four source/test changes for inspection in a separate research checkout. It is a rejected candidate, not a proposed main patch. The original evidence was produced in a concurrent workspace and was copied only after its exact source, receipt, log and manifest hashes were independently checked. The originals remain untouched. No duplicate full race gate was needed to establish this result.
