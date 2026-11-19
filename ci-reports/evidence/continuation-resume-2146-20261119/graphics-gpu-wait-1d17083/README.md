# High startup GPU completion review

## Conclusion

This bounded read-only review found no missing flush, lost frame fence, or false-completion condition that explains the captured failure. It does not justify changing submission order, timeouts, render quality, or GPU completion requirements. The original High readiness assertion remains failed.

The reviewed application source is immutable local commit `07bf358316f4a51e1566a052628ca57a68ca2610`, published as `1d17083c7364b0d960d3f4a548139ac95077daa2`, tree `efa81a0e2ef87d079d355a457c67be24b0a8f263`. All six retained application files are byte-identical to the preceding production candidate `62f18b868163a9c86857ac3222414484b92bffc9`. The installed native source is Three 0.180.0, matching the immutable lock entry. See provenance.json and references.json for exact source hashes and anchors.

## Frame gate and startup order

GpuFrameGate.submittedFrame creates a new GPU-completion fence and immediately flushes. An explicit preparation submission may replace the earlier fence; the later fence covers preceding queued work. The ordinary presentation loop is separately limited to one pending frame. ready polls with zero timeout and zero flags. TIMEOUT_EXPIRED keeps ownership and periodically flushes again. Only ALREADY_SIGNALED or CONDITION_SATISFIED releases the fence and advances the completed counter. The 120-second active polling bound fails closed; it never treats elapsed time as completion.

The first chase draw includes scene/reflection work and submits its frame fence. Startup then enters offscreen pit-material preparation. Each pit pass submits another fence through the same gate, restores borrowed rendering state synchronously, and polls readiness. That existing per-pass loop has a 45-second break, but a break does not mark the frame complete: the outer preparation path still calls waitForPreparedFrame before completing chase preparation and advancing to cockpit. The captured latest wait is approximately 13.75 seconds, so that per-pass break is not the observed boundary. This review makes no claim about unseen later cancellation or teardown behavior.

The latest retained application diagnostic resolved 9.93 ms before the recorded readiness-operation end. It was still loading in the offscreen pit-service stage, with one returned warmup scene frame, submitted=2, completed=0, pending=true, 824 deferred callbacks, 13 flush refreshes, and about 13.75 seconds pending. These are application gate counters. They do not mean that no individual GPU command has finished; they mean the gate has not observed completion of its covering submission. The six returned cube capture calls likewise do not establish GPU completion.

## Native readback polling and what cannot be attributed

Installed Three.readRenderTargetPixelsAsync creates its own pixel-pack buffer and fence, flushes, then invokes probeAsync with a 4 ms polling interval. probeAsync calls clientWaitSync with SYNC_FLUSH_COMMANDS_BIT and a zero timeout. The application includes asynchronous readback consumers in adaptive exposure and terrain normal residency. This native path is distinct from the application frame gate, which uses zero flags.

The last retained native operation is a returned clientWaitSync with numeric arguments [-1,1,0,-1]. Flag 1 is consistent with the installed native readback path. The trace does not retain the actual sync object identity, return code, or call stack, so this is a possible source explanation, not a proved attribution. A returned polling call does not itself establish a signaled fence. The selected chase-through-pit window contains three fenceSync calls, 3,966 clientWaitSync calls and 16 flush calls; those aggregate totals must not all be assigned to the application gate.

## Acceptance and scope

The configured readiness timeout is still 90,000 ms; the recorded operation spans 89,704.857 ms. Their instrumentation boundaries differ and are reported separately. The actual held fence and earlier CPU spans can reflect queued work; this review does not localize GPU execution time to the 26,568-byte garage index or prove a driver defect. The metadata observer also contributes startup overhead. No later paused, cockpit, driving, or photo acceptance was reached.

All retained source snapshots, the observed boundary extraction, and the producing script are checksummed. The complete hosted evidence is preserved separately. No renderer, browser, test, or race was executed for this source review, and no application, test, dependency, workflow, branch, or ref was modified. No additional run or source correction follows from the pending fence alone.
