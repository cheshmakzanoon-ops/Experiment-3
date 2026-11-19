# Completed spatial investigation — rejected source

**The spatial-path candidate is rejected: four original selected race cases pass and four fail. It is not included in the review branch.** This addendum completes the earlier investigation; it does not change production or repeat any race.

## Completed original results

| Original gate | Result |
| --- | --- |
| Ardennes hairpin, seed 1000 | Pass |
| Ardennes hairpin, seed 1037 | Fail: car 2 at station 3165.3421341682924 before the flag |
| Vellamar mixed, seed 5222 | Fail: one fall |
| Montejaral mixed, seed 5111 | Pass |
| Mixed GP/Superbike, seed 3303 | Pass, with the original pace and incident assertions |
| Aurel clear, eight GP riders | Fail: peak impact 0.9916666666666667 |
| Poggio clear, eight GP riders | Fail: peak impact 0.9833333333333334 |
| Poggio rain, eight GP riders | Pass |

The verbatim [completed receipt](completed-original8.json) records actual exit 1, 384.452 seconds and unchanged protected inputs. The impact failures occur before the tests' per-rider crash assertions and do not identify the event cause. No exact mixed-race lap margin is printed on this source.

The earlier cache-only candidate is also rejected: 48 of 51 original cases pass. A measured selected-lane mismatch and 109 distinct focused native passes establish useful local behavior, but do not override these original race failures. No gains, grip, race bounds or assertions were relaxed.

## Preserved evidence

[gp-spatial-review-evidence.tar.gz](gp-spatial-review-evidence.tar.gz) contains two original sibling directories, preserving every file byte for byte:

- `gp-spatial-causal-evidence`: the cache-only rejection, all consumed fields from the first-fall trace, exact recorded-state geometry reconstruction, fixed-budget comparisons, source restoration patches and native lifecycle proofs. Its original text says the spatial race result was pending when it was frozen.
- `gp-spatial-rejection-supplement`: the completed four-pass/four-fail outcome, final fifteen-file whitelist, source delta, native and negative controls, original static logs and complete handoff. It supersedes only that historical pending race status.

Both complete packages remain unchanged. The [archive manifest](archive-manifest.json) records every member's size and SHA-256, both package checksum-file hashes and byte-for-byte archive verification. The omitted raw multi-megabyte trace remains represented by its exact hash and the lossless 480-row, 29-field projection sufficient for the retained native replays. All three native replays previously reproduced their complete saved numeric digests; packaging did not rerun them or start another race.

## Inspect or reproduce

Verify this directory with `sha256sum -c SHA256SUMS`. Extract the archive into a fresh review directory with `tar -xzf gp-spatial-review-evidence.tar.gz`; both sibling READMEs and their relative links will then work. Each package has its own checksum file. Follow the causal package's read-only replay instructions only if reproducing the native calculations; its archived race observer is provenance, not a required replay step.

These archives contain rejected research source, not a patch to apply to the review branch. See [the current review checkpoint](../../continuation-review-2026-11-19.md) for the actual six-file test/fixture change and its validation status.
