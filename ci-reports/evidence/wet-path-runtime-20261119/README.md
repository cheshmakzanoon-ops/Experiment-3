# Scoped motorcycle runtime control

This package records local evidence for the isolated wet-path candidate `756f587e29f25e5f1ea0023ac2660759f027799d`. It does not claim that the candidate was accepted on main.

The candidate passed 64 focused steering/path/braking cases. Its complete original contact file passed 21/22 under local Node 24.22.3: the wet Poggio race passed, while the clear Poggio race reported peak impact `0.9833333333333334`. An independent same-runtime baseline control reproduced the same clear failure. The baseline worktree contains a rendering-only change; its entire simulation tree and original contact test are byte-identical to baseline main, as recorded in the control receipt.

The original isolated clear case was then run exactly once on each source using the official Node 22.23.4 binary, matching the hosted CI runtime. Both the stable-source guard and the Vitest entry point used that explicit binary. Baseline and candidate both passed with the original assertions and deadline. The runtime receipt retains the official distribution URL and verified checksum. The 21 unselected cases in each filtered control are not additional passes or failures.

These results separate the local Node 24 clear failure from the narrow wet-path patch. They do not substitute for the complete original hosted race comparison. [Run 44647781041](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44647781041) compares the integrated candidate `5f23cf60923638bd03b29df9c7b533c536e8624f` with pinned main `f80309fce06e97ada17cde1ef330971d9af6ffd9` under Node 22. Its results are recorded separately in the continuation report.

The copied JSON files retain their original commands, source identities, outcomes and local file references. Full local logs and the full bounded dry-fall history are not included in this compact package. `manifest.json` hashes the included payloads and excludes its own recursive hash.
