# Pure observer decomposition — original control order retained

Source: `375cf3ab5017318bf19a067cca8c1474519fbe74`, tree `3097f826078a08dc9023d9e056c9fb0a1c657f18`, parent `8de0feb83cf7efaf7777a42b04f078efcca4b20b`.

The source adds the previously reviewed pure current-contact tyre-history observer and substitutes it only in the original roll forecast. Historical feedback, control ordering, force inverse, capacity, reserves and original acceptance assertions remain unchanged. The entire observer implementation matches the earlier reviewed native implementation.

| Guarded check | Result |
| --- | --- |
| Initial focused native scope | 44/45 passed; one stale fixture failed |
| Corrected focused native scope | 47/47 passed |
| TypeScript | Passed |
| Original snapshot case | Failed: `separated` instead of `riding` |
| Original mixed3303 | Failed: GP90.9750372089817 s versus SBK88.96962958891913 s |
| Original dry Aurel | Failed: peak impact0.9916666666666667 instead of zero |

All these commands completed with source-stability guards passing. The three original race/snapshot checks were selected individually; no full 51-case run was made for this already failing source.

The initial native fixture prescribes opposed front/rear force histories, unloads the rear, and expects a zero front inverse. The current-history observer correctly exposes the surviving front force. The final fixture explicitly prescribes its intended zero roll forecast while retaining the exact zero assertion, and adds two mirrored unmocked controls for the actual remaining force. That correction is identical to the previously reviewed fixture change; no original race or snapshot assertion changed. The initial failure is preserved rather than hidden.

`copy-provenance.json` maps each complete receipt/log to its original protected-input manifest. The initial fixture boundary and final source have separate manifests. Logs and manifests are compressed losslessly. `research-inputs-from-ffd2259.patch` restores all differing tracked protected inputs from published main, including the earlier research branch's CI/fixture inputs. Use it only in a separate research checkout; it is not an integration proposal. Worktree metadata and dependency-link paths are machine-specific. `SHA256SUMS` covers the retained evidence existing before this README.
