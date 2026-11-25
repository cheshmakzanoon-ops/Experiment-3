# Worker 57 audit files

`audit-initial.json` is an immutable dated snapshot: 59 started, 56 coordinator-recorded complete, workers 57–59 active, worker 60 not started. It is not the final sixty-worker result.

The later `strict-pending-demonstration.json` records 60 actual starts / 57 completions: workers 1–56 and 58 complete; 57/59/60 active. It also catches sixteen missing scratch-relative link targets in the newly copied worker58 review. These must be reconciled by root before strict final acceptance. Its exit 1 is an actual document-integration finding, not an engine-test failure.

`registration-anchor.json` pins all already audited assignment identities. The validator checks those identities on later runs; statuses are allowed to advance.

`validate-ledger.py` reads only existing records, reports, logs and local Git metadata. It never imports or executes engine code, runs tests/builds, opens a browser, mutates Git, or uses the network. It writes only the requested external JSON result. Distinct actual agent creation remains attested by the coordinator's retained orchestration record; record uniqueness and report existence do not independently prove historical process creation.

After root records all sixty actual completions and integrates AGENTS/TASKS:

```sh
python /tmp/engine-c71f32882729/w10c-work/validate-ledger.py \
  --require-final \
  --output /tmp/engine-c71f32882729/w10c-work/audit-final.json
```

Before draft integration, add `--draft-overlay`. After final publication, optionally add `--published-revision <actual-final-sha>` to compare that commit's ledger/production identity and ancestry. Remote visibility is separately established by worker 59; the offline validator does not fetch it.

Exit 0: consistent snapshot, or complete/reconciled snapshot when strict mode is requested. Exit 2: strict completion requested while pending facts remain. Exit 1: audit inconsistency or required input unavailable. Always retain the JSON verdict and pending list. Ordinary exit 0 alone never means sixty agents complete.

The checker verifies local link targets, not heading fragments. The first two waves' missing original reports remain an explicit exception; do not replace them with fabricated originals. No total is formed by adding overlapping local/focused/broad unit counts or repeated 37-case browser runs.
