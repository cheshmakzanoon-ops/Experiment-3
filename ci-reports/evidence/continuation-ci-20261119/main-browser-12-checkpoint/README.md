# Main browser shard 12 completed checkpoint

Source: `d8d87c73a8f3e921e865acdc02c61e84b8c877a7`. Run 44553045707, job 135663983171. The assigned partition completed with failure at 2026-11-19T16:15:17Z, after 54m34s of the unchanged 90-minute job cap. This result belongs to the original main run, not the isolated production candidate.

The planner verified 29 of the actual 353 discovered cases for shard 12/12. Playwright finished with **21 passed, 7 failed, 1 skipped** in 52.8m. Dependency installation, build download and final artifact upload succeeded. The one skip is the existing reference-review guard for internal tooling absent from the product build; it was not introduced by this continuation.

The seven failures consist of four readiness predicates still receiving `loading` after 240,000ms, two test timeouts at 300,000ms, and one at 600,000ms. They do not establish a visual/numerical assertion mismatch in the later unvisited workloads. Exact source-relative test locations, complete test titles, predicate boundaries and unchanged deadlines are in `browser-12-result-summary.json`. That file also preserves all29 individual result lines and the complete final seven-case failure report.

The artifact upload completed as `browser-validation-12-of-12`, ID14550657945, 719,688,136bytes. GitHub reported ZIP SHA-256 `684a43807ef8df5e1cb5f670947afe6ea852e966471ddeb781291a8a9205d2ba`. It has not been downloaded; the complete returned log and upload receipt suffice for this readiness classification.

The compressed log is lossless complete decoded connector output. Its source/check-out attribution, decoded and stored hashes are in the provenance file. `completed-job.json.gz` preserves the completed GitHub job object and API observation time. This package is frozen; other shards remain separate evidence and are not claimed complete here.
