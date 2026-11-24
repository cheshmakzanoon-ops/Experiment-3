# Sixth batch CI evidence

Commit: [`676d4c8531695638537bf62af5a74ca8edbe41ef`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/676d4c8531695638537bf62af5a74ca8edbe41ef). The coordinator inspected completed job metadata and logs directly.

[Focused runtime run 45463968891](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45463968891), job 138693779261: **success**. Complete TypeScript/build and all 11 native browser tests passed. The three new OfflineAudioContext tests verified complete scheduling/ended cleanup, zero differing samples against a fresh graph after reset, and actual silence after disposal. The unchanged full replay test also passed.

[Build and validation run 45463968961](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45463968961), validate job 138693955722: **success**, including global lint, content validation and build. This confirms the subprocess-helper import correction from the previous failed validate job.

All four disjoint unit shards completed:

| Shard | Passed tests | Failed tests | Job |
|---|---:|---:|---|
|1|2,326|2|138693955420|
|2|2,348|0|138693955710|
|3|2,382|2|138693955626|
|4|2,110|0|138693955786|

Total: **9,166 passing tests and the same four content failures**, across 865 files. The failures remain APX livery alloy role, catalogue design/calibration hash, catalogue-growth unchanged hash, and dictionary expectations. These are intermediate-source results; no claim is made that every later source change or every broad browser shard has been validated by this run.
