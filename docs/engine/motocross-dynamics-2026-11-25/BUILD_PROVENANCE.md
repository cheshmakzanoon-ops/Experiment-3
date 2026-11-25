# Build, validation and publication provenance

## Verified candidate and acceptance boundary

Assignment 53 independently checked the frozen working files, retained build output, validation manifests and actual Git index at **2026-11-25 20:16:58 UTC**. The source/test/benchmark candidate is Git tree **`b7f379a7aaea0f807b5623b2c981190c6d1a3a17`**. Its **10,467 entries exactly equal the observed index**, and its **59 changes** from parent `f3b39eb8e1b02fc0677086819fc384b6ceacefc2` exactly match the coordinator's publication inventory and staged blob metadata. No task source commit existed at that observation.

All **1,734** inputs captured by assignment 50 match the candidate's Git blobs. Independently recomputing the actual Vite content fingerprint from the candidate's Git blobs gives **`d32aa557b2619b63883312be75df7735fb8ede13b801bf5315e642b2664c88bf`**, exactly the fingerprint embedded in the tested product/full build. All **266** retained output files remain identical to the build manifest and the manifest recorded after the completed browser invocation. [Independent evidence](evidence/53-build-provenance.json)

The final selected unit run and type/lint checks passed. The final build passed. The authorized isolated diagnostic and assignment 52's race/calibration acceptance were still pending at the original A53 snapshot. A subsequently inspected A52 receipt records the complete eight-race matrix passing at 20:18:33 UTC, with exit zero and all 1,131 inputs unchanged; its later calibration receipt also records exit zero and unchanged inputs.

**Terminal native-browser acceptance failed and remains open.** The earlier final-build invocation retained ten actual images before `page.evaluate: Target crashed`, without reaching Arena cockpit, pause and return-to-paddock completion. The isolated unchanged diagnostic then exited 1 at 20:42:04 UTC after its original 1,200,000 ms test timeout, with `locator.click: Target crashed` during APPLY & SAVE. It recorded two GPU-process exits; Low was selected but not applied and no venue/gameplay captures were reached. The cause is unproven. Its final manifests still match all 1,734 inputs and 266 built files. [Unit report](agents/49-final-units.md) · [Native report](agents/50-final-native.md) · [Terminal native evidence](evidence/50-final-native.json)

The coordinator published [code commit 39d9d497880e92801a7d77de6af2639b4186bfcc](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/39d9d497880e92801a7d77de6af2639b4186bfcc) to `main` with expected parent `f3b39eb8e1b02fc0677086819fc384b6ceacefc2` and `force: false`. A fresh remote read at 20:44:23 UTC confirmed that head. The fetched commit has exactly the accepted `b7f379a7…` tree, and local HEAD was aligned at 20:45:17 UTC while preserving all working files.

[Assignment 60](agents/60-publication-verification.md) independently observed the published code head at 20:45:21 UTC, rehashed the immutable source/protected/configuration blobs and retained build, and reproduced both accepted source identities. At 20:49:53 UTC it observed direct CI successor `6dc4c70515bfde48b27e2794bd97cdf1e1bd681d`, tree `9fc26764430e29c7e0283be435b117682dd77fdf`. Only the `ci-reports` root subtree differs; every source/test/script/asset/configuration entry is identical. The coordinator independently fetched that successor, confirmed only `ci-reports/benchmark-smoke.md` changed, and preserved it by normal fast-forward at 20:51:56 UTC. The final documentation commit is parented on preserved history and receives a separate coordinator verification after publication; A60 does not claim to verify the later commit containing its own report.

The committed [read-only publication verifier](evidence/60-verify-publication.py) reproduces the immutable code-content checks with `python docs/engine/motocross-dynamics-2026-11-25/evidence/60-verify-publication.py --verify-worktree`. It performs no checkout, staging, reset, fetch or ref update. Omit its optional `--check-code-index` flag after CI or documentation commits, because their complete trees legitimately differ from the original code tree.

This is a content-equivalence proof for acceptance performed before a commit. It is not a claim that the build or tests ran after a future commit existed.

## What each identity covers

The implementation in [`vite.config.ts`](../../../vite.config.ts) recursively enumerates **every file under `src/`**, then adds `package-lock.json`, `index.html` and `vite.config.ts`. It sorts the paths using JavaScript's default string ordering. For each path it hashes the repository-relative slash-normalized path, a NUL byte, the **raw file bytes**, and another NUL byte. The current set contains **1,129 files: 1,126 source files and three root files**. All paths in this audited set are ASCII, so the independently used Python string order is identical to that JavaScript order.

This fingerprint includes authored JSON and other assets stored inside `src/`, whether or not a particular product path imports them. It excludes `public/`, unit and browser tests, documentation, CI receipts, `package.json`, the installed dependency tree, and supporting scripts outside `src/`. It is a source-content identity with a defined scope, not a complete build-environment identity.

| Evidence | Captured scope | What was independently checked |
| --- | --- | --- |
| Vite identity | All `src/` files plus lockfile, entry HTML and Vite config | Raw-byte fingerprint recomputed from candidate Git blobs; matches retained identity |
| A50 input manifest | All `src/`, `public/`, `e2e/`; root package, TypeScript, Vite and Playwright inputs; entry HTML; four named support scripts | 1,734 current files and 1,734 candidate blobs match; exact capture path set and build/journey before/after equality |
| A50 output manifest | Every file under the produced `dist/` | 266 current files, 135,946,574 bytes; exact set and hashes match before and after completed journey |
| A49 unit manifest | Source, all tests, scripts, public assets, local test dependencies, named configs and two installed Three shader chunks | 2,710 current inputs match; 2,708 tracked candidate blobs match; the two installed shader files are explicitly outside Git |
| Final root type/lint manifests | `src/`, `tests/`, `scripts/`, `e2e/` and selected root input files | 2,835 current final inputs match; 2,834 candidate blobs match; generated root `browser-backend.json` is outside Git |
| A51 protected scope | Protected model/environment/specification and other source inputs | 1,772 current files and candidate blobs/modes match baseline; 18 allowed runtime files match the reviewed final versions |
| Publication inventory | Exactly the task's source, test and benchmark changes | 18 runtime paths, 37 test paths and four benchmark paths; 59 paths totaling 934,755 bytes match staged content |

A50's four explicit support scripts are `scripts/browser-backend.ts`, `scripts/browser-backend-setup.ts`, `scripts/ip-guard.mjs` and `scripts/vite-lazy-data.ts`. The lazy-data plugin is a real build input: it transforms the configured source geometry datasets into lazy chunks. Vite copies public assets and the product-build hooks remove owner-only output and run the IP guard. These behaviors are present in the inspected, unchanged configuration and plugins.

There is one important coverage distinction: `ip-guard.mjs` imports `scripts/ip-denylist.mjs`, which is **not** one of A50's four explicitly captured scripts. That unchanged file is covered by both root-gate script manifests, A49's script manifest and A51's protected baseline audit; its current/candidate SHA-256 is `44ccbba8ade1babe878802953afb9ed709917c6343b63a365ff8b54c066cd8a2`. A50 alone must therefore not be described as an exhaustive transitive or hermetic build-input manifest.

The lockfile and recorded tool versions identify the intended dependency resolution and observed executables: Node v24.22.3, Vite 7.1.7, Vitest 3.2.4 and Playwright 1.55.1. They do not constitute a hash of the complete installed `node_modules` tree, browser binary, operating system or environment. A50 records the product/owner/review/demo environment selectors; the retained identity confirms `variant: product` and `edition: full`. No cross-machine bit-for-bit rebuild claim is made.

## Exact content identities

These hashes use different explicitly defined domains. An aggregate of hexadecimal per-file hashes is not the same operation as Vite's raw-content fingerprint. A50 preserves Python `Path` sorting, which compares path components; A49 sorts full path strings. The two source aggregates below describe **the same 1,126 per-file hashes**. Assignment 53 compared every source path and reproduced both aggregates.

| Identity | SHA-256 |
| --- | --- |
| Vite raw-content fingerprint | `d32aa557b2619b63883312be75df7735fb8ede13b801bf5315e642b2664c88bf` |
| A50 all 1,734 input rows, Python path order | `1cbc70336eaaf00b0559a14a7de7b1af09a9ab4589701059b1656b1ffb4afb41` |
| A50 1,126 source rows, Python path order | `a91d8e12d2a2f97a8576fcdfe27f71f2f74eed2e08b8d8c926336e8384173d21` |
| Same 1,126 source rows, full-string order used by A49 | `5fea93841ed0da6949fe1dc2858c57f38b53595279222ab1550f74bfb6131096` |
| A50 266 output rows, Python path order | `fc510344f8e170443957e50410878a25e507f7e765ea92778ecd12dad06fa772` |
| A49 all 2,710 input rows, full-string order | `f985b369dd9bf56a9165a5134e3952dbba3a4fc22a8ed983b664bbc920c2fc0e` |
| A49 165 selected-test rows, full-string order | `b305e9790821c0849fc910046857d35c646a8be40f6cff56385eb07349270d14` |
| Final root-gate 2,835 input rows, full-string order | `df825498bb092d3467b9461028e40c50339c14909f0b84fa9b62e96ee2e8fdec` |
| Retained `BUILD_IDENTITY.json` file bytes | `13ccb05a514564f59db5c2c406dba604024911b9f2ba0ad5db4cc5789661f1fc` |
| Publication inventory JSON file bytes | `16025bf2af4a9dba6c0d1e404d4fce01597e2e54f6f903c9e3e6e48d53948dee` |
| Staged metadata JSON file bytes | `de56cbfa5e342c0a139ab442e5473a1c98c004460576962821dd818caf8d5df7` |

Manifest-row aggregates hash `path + NUL + file SHA-256 + newline` in the specified ordering. A51's protected/runtime inventory hashes instead hash the compact JSON row structures defined by its verifier; they must not be compared with any row aggregate above. Its protected-row identity is `49a448d918d0db165240c05976fadfaa4b50ff42aea633d30fc308b7696c42fd`, and its runtime-row identity is `35a15a118f35fcd42f701eba881296ec640faa38f35c37a72113066f6a5bcf2e`. [Scope report](agents/51-protected-scope.md)

## Reconciliation of the actual gates

The direct Vite build ran on **2026-11-25 19:43:17–19:43:42 UTC**, exited zero in **24.695 seconds**, and passed its IP guard. Its 1,734 captured inputs remained unchanged. No npm prebuild or pretest model-generation hook was invoked.

The first root gate completed a full TypeScript check and full ESLint run over `src tests e2e scripts`, each with exit zero and 2,835 unchanged captured inputs. Assignment 48 then strengthened exactly one test oracle in `tests/motocross-riding.test.ts`. An independent manifest diff finds **only that file changed** between the two root gates:

| Version of the riding test | SHA-256 |
| --- | --- |
| First full type/lint gate | `4ab8ec013b0a940c8595391d724ad8003a1f120ec2d815be253ae955bcdbaa00` |
| Final oracle, selected unit run and staged candidate | `f1d51d886210baadd8a85dd5b3828178b4954efca4a85b9108a91080c980f468` |

The second gate reran **full TypeScript** on the final inputs, exiting zero after 72.488 seconds, and ran **ESLint on the one changed test**, exiting zero after 2.657 seconds. Its before/after manifests are identical and match the current files and tracked candidate blobs. The correct final lint statement is therefore: full lint passed, the sole later changed file passed focused lint, and all other recorded inputs remained unchanged. It is not a claim that a second full-directory lint invocation ran after the test edit.

A49's completed invocation ran from **19:50:37 to 20:05:07 UTC**, exited zero in **870.159 seconds**, and passed **1,836 cases in 165 distinct files**: 128 motocross files/1,278 cases and 37 transport, recording and session contract files/558 cases. It records no failed, pending or todo cases, no missing/extra selection files, and no changed captured inputs. The final riding-test hash is present. All 1,126 source hashes equal A50's build source hashes, and all 37 changed test paths in the publication inventory are covered by the final gate manifest. This verifies selected unit acceptance, not the complete repository suite. Four unrelated baseline failures remain separately documented by [assignment 42](agents/42-baseline-ci.md).

A50's completed native invocation ran **19:51:30–19:57:23 UTC**, exited one in **353.050 seconds**, and retained a real target-crash failure after the tenth checked image. It used the unchanged test/configuration, Low quality and SwiftShader, with zero Playwright retries. All captured inputs and built bytes remained identical. Neither the failing report nor the first incomplete environment-interrupted attempt is a completed green journey. The cause of Chromium's crash is undetermined. Assignment 37's earlier successful journey used fingerprint `8ca5571bf1d9a5297793bf6f16b439311491ef8efdfb2ce06aa85f1ffcc459bf` and differs in four final runtime files; it cannot replace final-source acceptance.

## Protected content and the candidate tree

A51 compared **1,772 protected files / 264,155,763 bytes** to task baseline `b527a7e01ea247f0233a2ec4f2850639bafbd887`. Assignment 53 independently rehashed those current files, checked their modes and sizes, and verified the **candidate tree's protected modes and Git blob IDs equal the baseline**. The 18 allowed runtime hashes also match A51's final semantic review.

The candidate changes only the 59 inventoried runtime/test/benchmark paths relative to `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`. That parent's tree is `83200f67ef13ed9a0d253fa84d18dfc5a31aa5c5`. The baseline-to-parent difference consists of 24 inherited CI receipt changes and is not attributed to this task. Authored model and environment preservation is a source-scope conclusion; it does not assert that all simulation behavior or all non-MX recording bytes are unchanged. The scoped telemetry differences and global simulation-identity change remain disclosed in A51.

The coordinator's `source-tree-batch-0.json` through `source-tree-batch-5.json` record successive GitHub tree materialization. Their base/result chain is continuous, their path union is the same 59-file set, and the final recorded remote tree is the exact candidate tree above. The receipts record `branch_updated: false`. This audit checks those recorded receipts; it does not independently query a live GitHub branch or invent a published commit.

## Verifying a subsequently published commit

Root alone creates commits and updates `main`. After the code commit is created, record its real SHA and parent, fetch it, and check the following read-only facts:

1. Its tree is **`b7f379a7aaea0f807b5623b2c981190c6d1a3a17`** and its parent is **`f3b39eb8e1b02fc0677086819fc384b6ceacefc2`**. Exact tree equality covers paths, modes and blob IDs, including unchanged files; matching only the 59 changed file hashes would be a weaker check.
2. Its changed path set relative to that parent is exactly the 59 paths in the evidence's `publication.publication_path_hashes`. Rehash those Git blobs against the recorded SHA-256 values for an additional content check.
3. Recompute Vite's raw-content fingerprint from that commit's source blobs; it must be the recorded `d32…` value. The recipe below does so without checking out, rebuilding, staging or modifying anything.
4. Confirm the final remote `main` ref actually points to the intended commit or its documented final documentation descendant. A locally created commit or remote tree object alone does not establish publication.
5. If a later documentation commit is used, record both SHAs and verify its complete diff from the code commit contains only intended task documentation. The code commit retains tree `b7f…`; the later whole tree changes when documentation is added, while all validated source, test, configuration, script and asset blobs must remain identical.

Set `CODE_COMMIT` to the **actual recorded code-commit SHA** before running:

```sh
python - "$CODE_COMMIT" <<'PY'
import hashlib, json, re, subprocess, sys

commit = sys.argv[1]
assert re.fullmatch(r'[0-9a-f]{40}', commit), 'Supply the actual code commit SHA'
def git(*args):
    return subprocess.check_output(['git', *args])

expected_tree = 'b7f379a7aaea0f807b5623b2c981190c6d1a3a17'
expected_parent = 'f3b39eb8e1b02fc0677086819fc384b6ceacefc2'
assert git('rev-parse', commit + '^{tree}').decode().strip() == expected_tree
assert git('show', '-s', '--format=%P', commit).decode().strip() == expected_parent
entries = {}
for row in git('ls-tree', '-r', '-z', commit).split(b'\0'):
    if row:
        header, path = row.split(b'\t', 1)
        mode, kind, oid = header.decode().split()
        entries[path.decode()] = (mode, kind, oid)
paths = sorted([p for p in entries if p.startswith('src/')] +
               ['package-lock.json', 'index.html', 'vite.config.ts'])
assert len(paths) == 1129 and all(p.isascii() for p in paths)
process = subprocess.Popen(['git', 'cat-file', '--batch'],
                           stdin=subprocess.PIPE, stdout=subprocess.PIPE)
digest = hashlib.sha256()
for path in paths:
    process.stdin.write((entries[path][2] + '\n').encode())
    process.stdin.flush()
    oid, kind, size = process.stdout.readline().decode().strip().split()
    assert kind == 'blob'
    data = process.stdout.read(int(size))
    assert len(data) == int(size) and process.stdout.read(1) == b'\n'
    digest.update(path.encode() + b'\0' + data + b'\0')
process.stdin.close()
assert process.wait() == 0
expected = 'd32aa557b2619b63883312be75df7735fb8ede13b801bf5315e642b2664c88bf'
assert digest.hexdigest() == expected
print(json.dumps({'commit': commit, 'tree': expected_tree,
                  'fingerprint': digest.hexdigest(), 'inputs': len(paths)}))
PY
```

These checks establish that published code contains the exact validated source tree. The accurate resulting statement is: **“Acceptance ran on working-tree content later published unchanged in commit `<actual SHA>`.”** Do not say the retained build ran after that commit, and do not edit `BUILD_IDENTITY.json` to replace its honest `commit: null`.

The existing [`verify-release-artifact.mjs`](../../../scripts/verify-release-artifact.mjs) requires `identity.commit` to equal a validated commit and a matching `SOURCE_COMMIT.txt`. Consequently this retained precommit `dist` is not a postcommit release artifact acceptable to that verifier. A separate future release would need its normal commit-based build and gates. This distinction does not prevent committing and pushing the audited source changes requested here.

## Receipts and final reconciliation

The compact [assignment-53 evidence](evidence/53-build-provenance.json) records every checked count, the candidate tree, all 59 publication SHA-256 values, critical source/config/support hashes, and SHA-256 identities for the underlying receipts. Complete local build/native receipts are under `test-results/a50-final-native/`; root gates are under `test-results/root-final-gates/` and `test-results/root-final-oracle-gates/`; publication receipts are under `test-results/publication/`. Full A49 receipts are under `/workspace/scratch/e91efca799c8/validation/final-units-a49/`. These raw local paths should not be mistaken for already published artifacts.

Before a final delivery claim, reconcile A52's completed eight-race and calibration receipts, A50's authorized isolated diagnostic under `test-results/a50-final-native/diagnostic-attempt-3/`, and the actual published code/documentation commit SHAs. The A52 grid receipt inspected after the original snapshot is `/workspace/scratch/e91efca799c8/validation/a52-final-races/attempt-02/grid/receipt.json`; its content and SHA-256 are retained in the evidence's later-observation section, alongside the subsequently completed calibration receipt. A52's detailed scenario counts remain owned by its acceptance report. Preserve the existing failed native attempt even if a later attempt passes. Assignment 54's separate final cadence result and evidence cover deterministic dense-rig display reconstruction; they do not convert the incomplete native journey into browser acceptance. [Cadence report](agents/54-final-cadence.md)
