# A12 validation continuation

Starting source: `0338e45a92268092ff6d6b841a55f8c3c9bf6242`.
The six authored stands and their Blender/GLB assets were already integrated at
`aa98c193bec21e205d6aec4d661b716ad3c9a865`. This continuation does not rebuild them.
A71 is independently published as `playable-67e3af529e09a52028cacf77a93f1066e2ca6f2c`.

## Reproduced blockers

GitHub A12 run `37380501020`, day job `112000936488`, failed on macOS
SwiftShader at the production 45-second GPU completion deadline after cockpit
warmup. An independent x86 Linux Mesa run of the unchanged source passed that
warmup and reached the static memory survey, but consumed its 600-second test
budget before the remaining quality and driven-lap checks. Neither is a full
browser pass, and neither establishes consumer-hardware frame rates.

## Changes

The supplemental workflow now uses the same explicitly verified Linux/Mesa
backend as full CI. Its software-rendered survey has a 30-minute test budget
and a 40-minute job budget; the application's 45-second GPU deadline, original
rendering ceilings, race simulation, quality settings and acceptance assertions
are unchanged. The pinned player derivative is generated on x86, not replaced
with an ARM-generated approximation. Publication still requires the full CI gate.

Every PNG is owned synchronously in its rendering task, then delivered to the
runner before any next simulation step. Each saved image receives a SHA-256
receipt. A later timeout therefore leaves the already captured evidence intact.
Reports retain metadata rather than an array of base64 images. Eleven static
images are taken from the existing forward memory-measurement pass rather than
re-rendering those same frozen views. Both warmup cycles and all 22 memory
measurements remain, as do all six physical approaches and their chase views.
Factory progress now records the actual task label instead of `[object Object]`.

Native regressions cover current-frame ownership, awaited delivery, rejected
storage, invalid PNG ownership, async clear/rain frame-and-water continuity, and
stopping traversal on a rejected evidence write. The first focused run passed
all seven cases; changed-file ESLint and strict project TypeScript also passed.
Final exact-source browser and aggregate results must be checked independently.

No source car, cockpit camera, physical route, authored asset, save/replay format,
release gate, or final-art flag changes. Human-driven full-race review, consumer
hardware, final art and A72-A75 remain open.

## Disk-first attachment correction

The installed Playwright reporter keeps body-only attachments in memory until
reporting. The capture sink now writes each PNG with exclusive creation before
notifying Playwright through a file-path attachment. Worker termination can no
longer erase earlier images that have already been delivered. Four filesystem
regressions verify exact bytes before notification, retention when the reporter
rejects, propagation of write errors, and rejection of duplicate overwrites.
This Node-side persistence correction does not change the browser survey,
application, authored assets, simulation or original coverage assertions.

## Independent aggregate results

GitHub run `37386431866`, validation job `112020726431`, passed all 1,898
unit cases in 215 files, complete lint, strict TypeScript, production build and
source preservation for commit `be2ecbdcbfb92558f1be707adc032bd03896e7bb`.
Its separate simulation-scenario job also passed. Full browser/release acceptance
must not be inferred from those jobs.

The concurrent sandbox aggregate is not a pass: although all 1,898 cases
reported passing, Vitest reported an unhandled task-update RPC timeout and the
source guard correctly rejected the separately running browser reporter's new
`browser-progress.json`. No source-stability exclusion was added. Use the
independent, exact-commit hosted aggregate above; do not relabel the local run.

The disk-first continuation passed all seven capture/filesystem tests, changed-file ESLint and strict project TypeScript. Its exact-commit full CI remains a separate gate.
