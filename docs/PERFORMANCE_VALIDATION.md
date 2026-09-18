# Measured performance, not a hardware promise

The pause menu's **Performance capture** records five seconds of warm-up followed
by at least thirty seconds of complete frame intervals. The final interval is
retained in full, even when a hitch crosses the requested end time. Capturing
never edits simulation state, suppresses an opponent, changes the graphics budget
or modifies the render clock. Captures are opt-in and remain local until the user
exports a JSON file. A maximum of 30,000 frames bounds storage to 1.44 MB of numeric
sample data; reaching that limit interrupts the run instead of discarding history.

## What is measured

`frame_ms` is completion-to-completion wall time for successive live rendered
frames. It includes scheduling delay, rendering, UI work and stalls, without the
camera integrator's 80 ms clamp. `render_cpu_ms` is the unaveraged duration of the
renderer update and submission path; it is **not** GPU duration or total browser
CPU utilization. `reported_physics_tick_ms` is the worker's reported tick cost as
seen by each rendered frame, not an independent CPU trace of every physics tick.
Draw calls and triangles include the mirrors, probe and postprocessing submissions
in that frame. Their counters are reset once before those passes.

GPU elapsed-time results use `EXT_disjoint_timer_query_webgl2` when available.
Pending, unsupported and invalid results use `-1` in the raw rows and `null` in
summary statistics. Each asynchronous completed query contributes only once.
These GPU values are not assumed to belong to the exact frame in which the result
becomes available. Disjoint events invalidate pending measurements and prevent a
new query that frame. Context loss clears ownership without touching invalid GL
handles. A four-query queue never waits for the GPU. No RAF-derived GPU estimate
is substituted. The engineering overlay now displays valid GPU results rather
than always saying they are unmeasured.

Average FPS is `1000 * frames / sum(frame_ms)`, **not** the mean of individual FPS
values. The one-percent-low FPS is the reciprocal of the mean duration of the
slowest `ceil(frameCount * .01)` frames. The separately reported p99 frame time
uses the nearest-rank convention. These are intentionally different statistics.

## Capture and compare

Configure a repeatable workload: the same machine, power mode, browser, viewport,
render settings, seed, session and camera. Use the same new-session procedure and
control inputs. The AI demonstration can help repeat a workload, but a matching
label by itself does not prove equivalent traffic or simulation progress. Enter
a machine/power-profile label and workload label in the capture dialog, then
choose **Resume & capture**. After completion, pause and export the report.

Pausing, visibility/focus loss, resizing, changing camera/settings/debug mode,
switching the driver, restarting or finishing the session interrupts an active
capture. Interrupted reports remain exportable as diagnostics, but cannot pass
the comparison gate. Capturing again discards the previous run explicitly.

```
npm run test:performance -- baseline.json candidate.json
```

The comparator revalidates the raw rows and recomputes all metrics, ignoring any
edited summary. It requires complete captures with at least 300 frames and ten
seconds of measured intervals, equal warm-up/duration, and matching declared
machine, workload, browser and automatically recorded configuration. Exit code
`2` means invalid or incomparable evidence, `1` means a detected regression, and
`0` means this particular comparison passes its thresholds. A pass is not a
universal 60 FPS certificate.

Default regression limits are 10% average FPS degradation, 15% one-percent-low
FPS degradation, 15% average renderer CPU increase, 20% p99 renderer CPU increase,
and 10% average draw-call or triangle-count increase. CPU comparisons allow a
0.05 ms absolute tolerance for near-zero timer quantization. GPU summaries are
reported but are not gated because extension availability and asynchronous
sampling coverage can differ. Record an explanation and remeasure before
accepting an intentional regression; do not silently loosen these thresholds.

Each report embeds a SHA-256 content fingerprint of `src/`, the lockfile,
`index.html` and Vite configuration. This identifies the actual built source,
including a patch applied before the final publication commit. It does not claim
to be the parent/staging Git commit. Reports contain no machine serial number,
GPU unmasked identifier, login, browser profile or secret.

## Verification and remaining boundary

The pure timing and comparison code is tested with adversarial synthetic fixtures:
unequal intervals, long hitches, interrupted runs, repeated GPU results, invalid
numbers, bounded storage, detached/recreated dialogs, mismatched configurations
and exit codes. `node --experimental-transform-types scripts/performance-selftest.ts`
checks the actual production aggregation/comparison functions without a browser.
Its synthetic fixtures are never presented as measurements of real hardware.

The browser test drives the visible UI, exports real frame observations and
checks invalidation on resize. CI's SwiftShader result is explicitly software
rendering evidence, not evidence for the user's Dell laptop or any consumer GPU.
There is no checked-in invented hardware baseline. The master prompt's universal
quality/performance ambitions still require representative hardware captures and
human assessment of the driving and presentation.
