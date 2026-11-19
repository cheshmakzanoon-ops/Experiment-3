# Compact isolated High evidence — d784d94

This is a repository-ready, lossless copy of the targeted records from the
already frozen `ci-high-isolated-d784d94` package. It performs no new diagnosis,
browser run, test, download, source modification, or validation of a correction.
The original frozen package remains unchanged.

## Identity and result

- [Workflow 44559369205](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44559369205).
- [High job 135684104524](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44559369205/job/135684104524).
- Server commit: `d784d94c9ee1d4c0d50d0e0f7f59b91639a218a6`.
- Git tree: `b0eb64883e62199a789ba351385718ec80e07a89`.
- Diagnostic branch: `ci/high-late-startup-20261119`.
- Recorded conclusion: **failure**. The 90,000 ms state predicate expected
  `paused` and received `loading`; no accepted High frame-completion result.

`original-README.md` is the full, byte-identical original interpretation and its
limitations. Its artifact-path references describe the full original directory,
not this compact layout. `original-SHA256SUMS` is the byte-identical full-package
manifest; its SHA-256 is
`f76333afd975f7124ef50ce37cc013809a783c14533b38d08bd29b91911841b9`.

## Retained evidence

Every original file other than the four explicitly omitted files below is
retained. Small files remain byte-identical. The three large JSON bodies are
gzip-compressed without parsing, projection, truncation, or field removal:

- `high/high-gp-last-diagnostic.json.gz`
- `high/high-gp-startup-commands.json.gz`
- `high/test-detail.json.gz`

Their complete decompressed bytes were checked against their original hashes.
All native analyses, late-program identities, slow-upload stacks, source findings
and source hashes, inline diagnostics, backend/progress facts, attachment/report
metadata, published identity, run/job snapshots, artifact/download receipts,
the original extraction helper, and the exact native console gzip remain.
`high/native-console-records.jsonl.gz` is the original unmodified compressed file.

The original complete job log gzip also remains byte-identical. Its decompressed
bytes were checked against the full plaintext log: **68,781 bytes**, SHA-256
`35506673462793a26e3f013c3f01602748bc32c3b7adc78542c0537888305ee5`.

The source's late-program and upload-stack capture bounds are unchanged by this
packaging. In particular, the marshal fragment was already truncated in the
original capture, and the later upload calls already lacked new stack records
after the bounded allowance was exhausted. Lossless packaging does not recover
information that the original instrumentation did not retain. No underlying
GPU-cause or successful corrective-test claim is added here.

## Omitted files and provenance

| Original file | Bytes | SHA-256 |
| --- | ---: | --- |
| `high-d784d94.zip` | 107,392,120 | `ac132ac4890f1fc728af150468f5473e2bb73a63a6555bf3dc5d3db116bc1d4d` |
| `high/trace.zip` | 54,558,637 | `81e7597be3f9e6868edada8ab3b221ddb63da0c55ea2d14f37db3f2ffa91985f` |
| `high-job-complete.log` | 68,781 | `35506673462793a26e3f013c3f01602748bc32c3b7adc78542c0537888305ee5` |
| `job-log-response.json` | 72,043 | `06d88f7bc7a4847fc943ebe10534d0465fcfca0ee8aba2d1e7910535aabecc91` |

`packaging-provenance.json` maps every original file to its retained form or
explicit omission, with original and retained hashes/sizes. It records checks
of the entire original manifest before and after copying. The two ZIPs remain
in the full frozen external package; the decoded log is recoverable from the
retained gzip. The response-wrapper bytes themselves are not reconstructible
from this compact copy.

The original report-extraction helper is preserved as evidence. Re-extracting
the complete HTML report or arbitrary omitted trace entries with it still
requires the full original ZIP. The compact copy does not claim to reproduce
unselected trace content or unseen program/resource identities.

## Local verification and packaging replay

The following checks only saved files; it runs no application code or browser:

```bash
cd /path/to/ci-high-isolated-d784d94-evidence
sha256sum -c SHA256SUMS
python -B verify_evidence.py
gzip -dc high/high-gp-startup-commands.json.gz
```

To repeat the exact selection/compression from the still-frozen original into a
new directory:

```bash
python -B package_evidence.py \
  --original /path/to/ci-high-isolated-d784d94 \
  --out /path/to/new-high-evidence
```

The packager refuses an existing output and requires the exact original manifest.
`verification.json` records successful compact-file verification. `SHA256SUMS`
covers all compact files except itself. This directory is now frozen as evidence.
