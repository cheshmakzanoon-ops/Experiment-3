# Assignment 59 — independent development-publication preflight

## Result

**The prepared engine commit passes the independent scope, staged-content and acceptance-provenance checks. No source/tree/parent mismatch or additional production blocker was found.** This result concerns the requested development update to `main`. It is not a deployment or release certification, a claim that complete repository CI is green, or a passing final native-browser journey.

**Final native acceptance failed and remains an open limitation.** An earlier invocation on the final build failed after ten captures. Its isolated diagnostic was still open during this audit's initial receipt check at **20:41:26 UTC on 25 November 2026**, then ended at **20:42:04 UTC** with exit 1, the original 1,200,000 ms test timeout and `locator.click: Target crashed` during APPLY & SAVE. I subsequently read and verified those actual terminal receipts. Low was selected but not applied, and no venue/gameplay captures were reached. The coordinator retains responsibility for preserving this failed acceptance and verifying the eventual branch update. No browser pass is inferred from the numerical tests.

The machine-readable result is [59-publication-preflight.json](../evidence/59-publication-preflight.json). This assignment authored only that evidence and this report. All other operations were read-only file/Git inspection and GitHub GET requests. It ran no tests, simulations, build, browser journey, generator or child agent, and changed no source, test, asset, index or ref.

## Independent Git and remote identity

The candidate is [commit 39d9d497880e92801a7d77de6af2639b4186bfcc](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/39d9d497880e92801a7d77de6af2639b4186bfcc). The existence of this Git object is not evidence of publication to `main`.

| Identity | Independently observed value |
| --- | --- |
| Prepared commit | `39d9d497880e92801a7d77de6af2639b4186bfcc` |
| Its sole parent | `f3b39eb8e1b02fc0677086819fc384b6ceacefc2` |
| Its tree | `b7f379a7aaea0f807b5623b2c981190c6d1a3a17` |
| Local HEAD | The same `f3b39e…` parent |
| Remote `refs/heads/main` at 20:36:26 UTC | The same `f3b39e…` parent; **not updated** |
| Actual index | Exactly the candidate tree's **10,467 entries**, including modes and blob IDs |
| Staged difference from the parent | **59 paths**, all regular `100644` files |
| `git diff --cached --check` | Exit **0**, no whitespace/error output |

Three independent GitHub read requests retrieved the prepared commit, its tree and the current main ref. The commit's parent and tree match the locally inspected objects. The tree response has 31 root entries and is not truncated; its complete tree identity is the same one whose 10,467 recursive entries were compared with the actual local index. No recursive remote-output truncation was mistaken for complete source inspection.

The 59 changed paths exactly match both the publication inventory and staged metadata: **18 runtime files, 37 test files and four benchmark files**, totaling **934,755 bytes**. Their current SHA-256 values, staged blob IDs and modes agree. No source/test/script working-copy difference exists outside the index. Task documentation remains separate from this code candidate and must be included in the later documentation commit.

The 59-path inventory digest is `a336f6f8b6750b9965a0a78ad39b24aa9f9956a1833b0f29b9091aaffd32feef`, using sorted path + NUL + file-SHA-256 + newline entries. This digest is not the complete-source hash or Vite fingerprint.

## Protected content and narrow runtime exceptions

The audit independently read baseline tree `b527a7e01ea247f0233a2ec4f2850639bafbd887`, the candidate/index entries and the current protected files. Every one of the **1,772 protected files / 264,155,763 bytes** matches its baseline mode and Git blob identity, its current computed Git-blob SHA-1 and its recorded SHA-256. Enumeration of the protected roots, including ignored files, found only the authorized new runtime/benchmark paths outside the baseline set.

This repeats the content identity checks rather than merely accepting [A51](51-protected-scope.md)'s headline. The baseline protects authored characters, bikes, meshes, materials, textures, terrain/course definitions, environments, vehicle specifications, asset generators and other unchanged source. The separately reviewed runtime changes intentionally alter dynamics and driven poses.

The complete `bike.ts` diff was read. Independently reversing only the added foot-reader import, restored eligibility import, and three sampled foot-field reads reproduces its entire baseline file, with SHA-256 `775c708bd852f503d5129c5674ecb41e2348956260aa2e62900ad2c638427b29`. Thus the existing model construction and rig definitions are unchanged. The full AI diff was also read; reversing its three comment lines and the single removed front-load eligibility term reproduces the entire baseline AI file, SHA-256 `9ba826f4d2b0c42d5f98e175ed58a3bdb47a6bae739d29d9a63e6619f2b3b440`.

Four protected regions were compared directly against baseline bytes: spring inverse/force/preload methods (**658 bytes**), complete landing-verdict function (**2,201 bytes**), yaw inertia and tyre-shear law (**4,550 bytes**), and the original protocol offsets/strides/version declarations (**1,082 bytes**). All are identical. This is not a claim that every test assertion remained untouched: [A48](48-oracle-review.md) reviews the intentional timing/oracle migrations, and [A57](57-claims-limitations.md) correctly rejects that broader wording.

## Accepted inputs match the candidate

For every captured input below, I independently recomputed its current hash. Where it is tracked, the current bytes and mode also reproduce the candidate's actual Git blob and mode. The before/after manifests of the final runs agree.

| Receipt set | Files checked | Current hash mismatches | Candidate blob mismatches |
| --- | ---: | ---: | ---: |
| A49 final combined units | 2,710 | 0 | 0 |
| A50 final build/native inputs | 1,734 | 0 | 0 |
| Final root TypeScript/focused-lint inputs | 2,835 | 0 | 0 |
| A54 final cadence inputs | 1,132 | 0 | 0 |
| A52 final race inputs | 1,131 | 0 | 0 |

The explicitly non-Git inputs are A49's two installed Three shader files and the root gate's generated `browser-backend.json`. Their current hashes match too; they are not silently presented as committed source. All 1,126 source paths are the same across the A49 and A50 inventories and the candidate. Recomputing the sorted source digest gives `5fea93841ed0da6949fe1dc2858c57f38b53595279222ab1550f74bfb6131096`.

The earlier full TypeScript/ESLint gate and later final-oracle gate differ at exactly one input, `tests/motocross-riding.test.ts`. Both full TypeScript runs and both recorded lint runs exited zero. The later focused lint covers that sole changed test, while the earlier full lint covers every unchanged path. The final riding test is also in A49's complete passing selection.

Vite's actual content-fingerprint calculation was independently recomputed over **1,129 inputs** whose bytes match the candidate. It produces exactly:

`d32aa557b2619b63883312be75df7735fb8ede13b801bf5315e642b2664c88bf`

All **266 retained build files / 135,946,574 bytes** match the recorded manifest, with the same exact file set. The product/full artifact still correctly says **`commit: null`**. Publication of equivalent source does not turn it into a postcommit release artifact. [A53](53-build-provenance.md) and [BUILD_PROVENANCE.md](../BUILD_PROVENANCE.md) explain this distinction and the fingerprint's narrower coverage; neither the manifest nor this audit constitutes a hermetic dependency/environment proof.

## Acceptance mapping and claim checks

The raw A49 reporter was independently reconciled with the selected-file receipt. It contains exactly **165 unique files**, all passed, and **1,836 assertion results**, all passed. Every one of the **37 changed test files** is in that actual selection. No historical or overlapping run was added to those totals.

The completed raw race, calibration and cadence outputs were also inspected:

| Final evidence | Independently recomputed result |
| --- | --- |
| A52 race output | Eight cases, **96 classified starts / 192 rider-laps**, zero retirements, nine crashes, maximum one per rider/case. |
| A52 calibration output | Twenty configurations with no reported band failures; hold-speed outcomes **17 clean / three bottomed**. |
| A54 recording output | Eight recordings; **93,936 matrix comparisons**, **79,344 scalar comparisons**, **36,192 rig poses**; all reported maximum differences zero. |
| Product build receipt | Exit zero, no changed captured inputs. |

These are separate kinds of evidence. They do not prove crash-free riding, continuous-time accuracy through every unrecorded event, subjective display fluidity, physical-GPU FPS, or measured real-bike calibration. The calibration standing-start metric is 60 metres, not 0–60 km/h. The four separately reproduced failures in [A42](42-baseline-ci.md)'s 52-case baseline/current comparison remain visible; the passing selected motocross suite is not a claim that all repository CI is green.

The handoff and architecture were checked against [A51](51-protected-scope.md), [A53](53-build-provenance.md), [A55](55-final-architecture.md), [A56](56-final-handoff.md) and [A57](57-claims-limitations.md). They preserve the spring-work inconsistency, forward-only post-impact constraint, endpoint-bracketed contact coverage, capped supported refinement, reduced contact/model geometry, and global Float32 time limitations. The documented contact bisection precision does not certify the first crossing of arbitrary nonmonotonic terrain.

## Outstanding publication facts

The terminal diagnostic receipt records **1,205.098 seconds**, exit **1**, Playwright status **timedOut**, zero retries and `locator.click: Target crashed` at APPLY & SAVE. Its log contains two `GPU process exited unexpectedly: exit_code=9` observations. These do not establish an OOM, environmental or physics cause. The previous final-build failure with ten captures is separate evidence and remains preserved. The diagnostic's complete 1,734-input before/after manifests and 266-file build manifests match each other and the exact inputs independently checked above; the failure did not mutate the accepted source or build. A50 owns the detailed attempt history and resource interpretation.

The coordinator must retain that failed native outcome when performing the authorized development update, use a fresh expected-parent check, and preserve concurrent upstream work. A60 must verify the actual remote publication and its source identity. The final documentation commit must close the real sixty-agent ledger and include the actual publication/native outcomes while preserving historical reports as point-in-time evidence. A fresh remote observation is required at publication time; this preflight's GET result is not a lock on `main`.

No extra user approval was requested by this audit. The user already authorized committing and pushing the development work. Root owns that action and the final publication checks; this assignment provides the independent content evidence and returns its document ownership and active slot.
