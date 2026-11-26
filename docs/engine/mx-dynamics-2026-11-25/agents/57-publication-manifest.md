# Assignment 57 — publication manifest and local payload helper

## Result and scope

The read-only helper at `/home/agent/motobound-publication-579b454ae846/prepare.py` prepares exact UTF-8 Git tree payloads for two coherent commits: the frozen runtime, tests and benchmarks; then this pass's documentation and evidence. It creates no Git objects, commits, refs, network requests or credential reads. Publication remains root's responsibility.

The successful 2026-11-26 00:25:46 UTC dry run selected the following changes relative to `c9c94c7029dbc3e29b18101ef7ccea0a897184d1`:

| Group | Files | Raw content bytes | Added | Modified | Deleted |
| --- | ---: | ---: | ---: | ---: | ---: |
| Runtime, tests and benchmarks | 61 | 1,106,376 | 31 | 30 | 0 |
| Documentation and evidence | 123 | 2,918,303 | 123 | 0 | 0 |
| Total | 184 | 4,024,679 | 154 | 30 | 0 |

This is a **pre-report snapshot**, before this report and its companion evidence were added. Assignments 58–60 and final root reconciliation can change the documentation set. Regenerate after those edits; the temporary manifest, rather than these historical counts, determines the exact upload. A later assignment-60 remote receipt may form a subsequent documentation-only commit.

The code group contains nine modified runtime files, 46 tests/helpers and six benchmarks. Its closed 61-path allowlist is SHA-256-bound in the helper. The nine runtime paths are:

- `src/core/session-identity.ts`
- `src/rendering/wheel-pose.ts`
- `src/simulation/bike-vehicle.ts`
- `src/simulation/bike.ts`
- `src/simulation/offroad/ai.ts`
- `src/simulation/offroad/contact-impulse.ts`
- `src/simulation/offroad/dirt-bike-vehicle.ts`
- `src/simulation/offroad/mx-ground-physics.ts`
- `src/simulation/offroad/session.ts`

Everything else selected is restricted to the named documentation directory and approved report/evidence file shapes. Protected assets, models, environments, configuration and protocol files cannot enter through either allowlist. All 184 snapshot paths have mode `100644`; the helper preserves modes and rejects deletions, mode changes, symlinks, binary content, invalid UTF-8, unmerged index entries, escaped paths and unexpected additions. It also runs `git check-ignore --no-index` over every selected path: zero selected paths are ignored. Build output, dependency folders, raw test caches and temporary upload files are excluded.

## Integrity and payload format

The helper independently reconstructs Git tree objects in memory and reproduces the base tree `5e9fea61ed17d0709a192e2106ef20e161788ffc`. The exact frozen code-only result is `48e2f2104d145ee02697f3232bfd663d6ba48aec`. Documentation edits change the final tree; its current expected SHA is recorded only in the temporary full manifest.

Source fingerprint `4c041cb338d0fa480e0514ee905137a24061494b98b9899949238f6b137be790` covers 1,129 source/configuration inputs. The helper also reads the final assignment-46 acceptance receipt and its authenticated raw input manifest, then rechecks all 1,556 input hashes and modes. The accepted receipt reports 155 files and 1,736 passing test cases. Source, candidate files, acceptance inputs, HEAD and index are checked across preparation; edits during packaging fail the run.

Each JSON chunk is a complete array of Git tree elements with `path`, `mode`, `type: "blob"` and exact `content`. The temporary `manifest.json` records every selected path, group, status, byte length, SHA-256, Git blob SHA, prior blob SHA, preserved mode, chunk hash and incremental expected tree SHA. It round-trips every serialized payload against those values. The 00:25 dry run produced seven code chunks and 17 documentation chunks, targeting 180,000 UTF-8 JSON bytes per chunk. Four large evidence files remain complete singleton entries; the largest JSON payload is 490,317 bytes. No evidence is shortened or rewritten.

The actual full upload manifest stays outside the repository to avoid self-hash recursion. Published Git commit trees are the durable authority for the complete committed contents.

## Root handoff

Run after documentation authors release their files:

```sh
python3 /home/agent/motobound-publication-579b454ae846/prepare.py prepare
python3 /home/agent/motobound-publication-579b454ae846/prepare.py verify
```

Read `/home/agent/motobound-publication-579b454ae846/manifest.json`; only upload chunk files listed in that freshly generated manifest. Old unused chunk files, if present, are irrelevant. The `verify` command rejects later path/content/mode changes. To read large payloads through bounded exec output without truncation:

```sh
python3 /home/agent/motobound-publication-579b454ae846/prepare.py emit --file runtime-001.json --part 0 --part-size 60000
```

Each output is JSON containing `segment`, zero-based `part`, total `parts` and the full payload SHA-256. Concatenate all segments in order in `functions.store`, verify the payload hash, then parse the complete JSON array. Do not manually retype or shell-interpolate source content. Root can submit each array to Git Data `create_tree`, using the manifest's successive base/result tree SHAs, and check the returned SHA. A large singleton can instead be uploaded with `create_blob` and referenced by its verified blob SHA.

After the seventh code chunk, create the runtime/tests/benchmarks commit with parent `c9c94c7029dbc3e29b18101ef7ccea0a897184d1`. Build the documentation tree from that code tree and create its commit with the runtime commit as parent. Root must recheck remote `main` against the authorized base before its leased non-force update. If remote `main` advanced, stop publication against this base and review/rebase; this helper never silently changes its base or overwrites another head.

No packaging blocker was found. Final regeneration and remote-head verification are required publication conditions. This assignment does not assert that commits were created or `main` was updated.
