# Fifth batch CI evidence

Commit: [`54506ca8a700479868691a262fac385e8ffbb874`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/54506ca8a700479868691a262fac385e8ffbb874). The coordinator retrieved the completed job metadata and logs directly.

## Focused native gate

[Focused runtime run 45461006669](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45461006669), job 138683233747: **success**. Exact-source dependency installation, complete compiler/build and all eight native lifecycle/replay browser tests passed. The new agent 31 native audio tests were not yet part of this commit.

## Complete unit shards

[Build and validation run 45461006489](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45461006489) completed all four disjoint unit shards:

| Shard | Passed tests | Failed tests | Job |
|---|---:|---:|---|
|1|2,324|2|138683441504|
|2|2,334|0|138683441360|
|3|2,366|2|138683441506|
|4|2,110|0|138683440896|

That is **9,134 passing tests and four failures** across 862 files. The failures are the same previously recorded content expectations: APX livery alloy role, vehicle-catalogue design/calibration hash, vehicle-catalogue-growth unchanged hash, and the dictionary gate. No new engine assertion failure appeared in these shards. This is an intermediate-commit result, not a final-source certification.

## Validation correction

The broad validate job 138683441765 failed at ESLint because the new CommonJS crash fixture used four require-style imports. Its earlier scoped lint had omitted that helper. The coordinator replaced those imports with supported dynamic imports, without disabling the rule, and reran lint for both helper and test plus all 33 real-process cases successfully. The correction is in the next publication batch; this historical validate job remains a failure.

Offroad scenarios passed. Broad browser jobs were skipped after the validate failure; they are not passes. The focused native workflow above ran independently and passed.
