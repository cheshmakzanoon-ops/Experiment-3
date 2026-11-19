#!/usr/bin/env python3
"""Retain a bounded, read-only review of the immutable High startup wait path."""
from pathlib import Path
import gzip
import hashlib
import json
import subprocess

ROOT = Path('/workspace/scratch/dac6891506fb')
REPO = ROOT / 'graphics-buffer-owner-2218'
OUT = ROOT / 'buffer-owner-ci-1d17083-audit/gpu-wait-review'
COMMIT = '07bf358316f4a51e1566a052628ca57a68ca2610'
PARENT = '62f18b868163a9c86857ac3222414484b92bffc9'
REMOTE = '1d17083c7364b0d960d3f4a548139ac95077daa2'
TREE = 'efa81a0e2ef87d079d355a457c67be24b0a8f263'
NATIVE = Path('/workspace/scratch/d611aefdb08c/Experiment-3/node_modules/three')

def sha(data):
    return hashlib.sha256(data).hexdigest()

def git(*args):
    return subprocess.check_output(['git', '-C', str(REPO), *args])

def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')

if OUT.exists():
    raise SystemExit('Refusing to overwrite existing review')
assert git('rev-parse', COMMIT + '^{tree}').decode().strip() == TREE
summary_bytes = (ROOT / 'buffer-owner-ci-1d17083-audit/review-package/summary.json').read_bytes()
assert sha(summary_bytes) == 'bfa1195032077934cbbe9e9d70d7d833d377d4de3cf0ad39da95c81882fc13be'
summary = json.loads(summary_bytes)
assert summary['source'] == REMOTE and summary['tree'] == TREE
OUT.mkdir()
source_paths = [
    'src/rendering/gpu-frame-gate.ts',
    'src/rendering/pit-material-warmup.ts',
    'src/rendering/adaptive-exposure.ts',
    'src/rendering/ground/normal-residency.ts',
    'src/rendering/renderer.ts',
    'src/rendering/reflections.ts',
]
native_paths = ['package.json', 'src/renderers/WebGLRenderer.js', 'src/utils.js']
provenance = {
    'remoteCommit': REMOTE, 'localImmutableCommit': COMMIT, 'tree': TREE,
    'unchangedProductionParent': PARENT, 'source': [], 'installedNative': [],
    'hostedSummarySHA256': sha(summary_bytes), 'run': 44631109424,
    'scope': 'Read-only immutable source review; no renderer, browser, race or tests executed.',
}
contents = {}
for path in source_paths:
    data = git('show', COMMIT + ':' + path)
    assert data == git('show', PARENT + ':' + path)
    snapshot = 'source/' + path + '.gz'
    target = OUT / snapshot
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(gzip.compress(data, mtime=0))
    provenance['source'].append({
        'path': path, 'bytes': len(data), 'sha256': sha(data),
        'gitBlob': git('rev-parse', COMMIT + ':' + path).decode().strip(),
        'snapshot': snapshot, 'byteIdenticalToProductionParent': True,
    })
    contents[path] = data.decode()
for path in native_paths:
    data = (NATIVE / path).read_bytes()
    snapshot = 'native/three/' + path + '.gz'
    target = OUT / snapshot
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(gzip.compress(data, mtime=0))
    provenance['installedNative'].append({
        'path': 'node_modules/three/' + path, 'bytes': len(data),
        'sha256': sha(data), 'snapshot': snapshot,
    })
    contents['node_modules/three/' + path] = data.decode()
lock_bytes = git('show', COMMIT + ':package-lock.json')
lock = json.loads(lock_bytes)
native_package = json.loads((NATIVE / 'package.json').read_text())
assert native_package['version'] == lock['packages']['node_modules/three']['version'] == '0.180.0'
provenance['lock'] = {
    'path': 'package-lock.json', 'sha256': sha(lock_bytes),
    'gitBlob': git('rev-parse', COMMIT + ':package-lock.json').decode().strip(),
    'threeEntry': lock['packages']['node_modules/three'],
}
write_json(OUT / 'provenance.json', provenance)

needles = {
    'src/rendering/gpu-frame-gate.ts': [
        'const result = gl.clientWaitSync(this.fence, 0, 0);',
        'if (result === gl.TIMEOUT_EXPIRED)',
        'result !== gl.ALREADY_SIGNALED',
        'this.completed = this.submitted;',
        'this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);',
        'gl.flush();',
    ],
    'src/rendering/pit-material-warmup.ts': [
        'renderer.render(scene, camera);', 'submitted();',
        'const deadline = performance.now() + 45000;',
        'while (!cancelled() && !ready())', 'target.dispose();',
    ],
    'src/rendering/renderer.ts': [
        'async waitForPreparedFrame(', 'while (!cancelled() && !this.gpuFrames.ready())',
        'this.warmupFrames++;', 'await this.warmPitPresentation(frame, cancelled, yieldFrame);',
        'await this.waitForPreparedFrame(cancelled, yieldFrame);',
        'this.gpuFrames.submittedFrame();',
    ],
    'src/rendering/adaptive-exposure.ts': ['renderer.readRenderTargetPixelsAsync(this.target', 'if (!this.pending) this.target.dispose();'],
    'src/rendering/ground/normal-residency.ts': ['renderer.readRenderTargetPixelsAsync(target'],
    'node_modules/three/src/renderers/WebGLRenderer.js': [
        'this.readRenderTargetPixelsAsync = async function',
        'const sync = _gl.fenceSync( _gl.SYNC_GPU_COMMANDS_COMPLETE, 0 );',
        'await probeAsync( _gl, sync, 4 );', '_gl.deleteSync( sync );',
    ],
    'node_modules/three/src/utils.js': ['function probeAsync(', 'gl.clientWaitSync( sync, gl.SYNC_FLUSH_COMMANDS_BIT, 0 )'],
}
references = []
for path, searches in needles.items():
    for needle in searches:
        matches = [i + 1 for i, line in enumerate(contents[path].splitlines()) if needle in line]
        assert matches, (path, needle)
        references.append({'path': path, 'needle': needle, 'lines': matches})
write_json(OUT / 'references.json', references)
high = summary['high']
last = high['lastSuccessfulApplicationDiagnostic']
write_json(OUT / 'observed-boundary.json', {
    'sourceSummarySHA256': sha(summary_bytes),
    'predicate': high['predicate'],
    'lastApplicationDiagnostic': last,
    'lastNativeSnapshot': high['lastPrePredicateEndSnapshot'],
    'observedNativeCalls': {name: high['observedChaseThroughPitDelta']['counts'][name]
        for name in ['fenceSync', 'clientWaitSync', 'flush', 'readPixels', 'getBufferSubData']},
})
(OUT / 'README.md').write_text('''# High startup GPU completion review

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
''')
(OUT / 'make-gpu-wait-review.py').write_bytes(Path(__file__).read_bytes())
entries = []
for path in sorted(OUT.rglob('*')):
    if path.is_file():
        entries.append(sha(path.read_bytes()) + '  ' + str(path.relative_to(OUT)))
(OUT / 'SHA256SUMS').write_text('\n'.join(entries) + '\n')
print(json.dumps({'directory': str(OUT), 'files': len(entries) + 1,
                  'readmeSHA256': sha((OUT / 'README.md').read_bytes()),
                  'sourceCount': len(source_paths), 'nativeCount': len(native_paths)}))
