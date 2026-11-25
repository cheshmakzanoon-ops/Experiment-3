#!/usr/bin/env python3
"""Read-only source audit; writes only the sibling JSON evidence manifest.
Run from the repository root with Python 3. No index, refs, build or tests change.
"""
from pathlib import Path
import collections
import datetime
import hashlib
import json
import os
import stat
import subprocess

BASELINE = 'b527a7e01ea247f0233a2ec4f2850639bafbd887'
RECEIPT_HEAD = 'f3b39eb8e1b02fc0677086819fc384b6ceacefc2'
OUTPUT = Path('docs/engine/motocross-dynamics-2026-11-25/evidence/51-protected-scope.json')
RUNTIME = {
    'src/core/session-identity.ts': 'simulation identity',
    'src/rendering/bike.ts': 'three foot-state readers; model construction normalized separately',
    'src/rendering/frame-state.ts': 'presented-state endpoint validation',
    'src/rendering/offroad/chase-camera.ts': 'motocross camera temporal response',
    'src/rendering/offroad/mx-machine-pose.ts': 'recorded mechanical pose reconstruction and validation',
    'src/rendering/snapshot-interpolation.ts': 'optional motocross rider-state interpolation',
    'src/simulation/offroad/ai.ts': 'existing supercross AI shoulder-guard integration',
    'src/simulation/offroad/contact-impulse.ts': 'coupled unilateral stop solver',
    'src/simulation/offroad/dirt-bike-vehicle.ts': 'motocross physical integration and controller lifecycle',
    'src/simulation/offroad/mx-gear-stroke.ts': 'accepted shift trajectory controller and derivatives',
    'src/simulation/offroad/mx-ground-physics.ts': 'passive yaw coordinate rotation',
    'src/simulation/offroad/rider-weight.ts': 'body-pose blending and derivative',
    'src/simulation/protocol.ts': 'optional motion metadata in existing reserved tail',
    'src/simulation/wheel-contact-state.ts': 'motion metadata serialization',
    'src/rendering/offroad/mx-foot-pose.ts': 'new pure recorded shift trajectory reader',
    'src/rendering/offroad/mx-rider-pose.ts': 'new pure recorded posture reader',
    'src/simulation/offroad/air-drag.ts': 'new analytic drag step',
    'src/simulation/offroad/mx-rider-posture.ts': 'new fixed-step automatic posture controller',
}
BENCHES = {
    'scripts/bench/motocross-display-cadence.ts',
    'scripts/bench/motocross-player-dynamics.ts',
    'scripts/bench/motocross-scope-isolation.ts',
    'scripts/bench/motocross-spring-work.ts',
}
ROOTS = ('src', 'public', 'reference', 'assets', 'authoring', 'scripts', 'tools',
         'playable', 'lookdev-tmp', 'screenshots', 'scratch-tmp')
sha256 = lambda data: hashlib.sha256(data).hexdigest()
def git(*args):
    return subprocess.check_output(['git', *args])
def blob(ref, path):
    return git('show', f'{ref}:{path}')
def exactly_once(data, old, new):
    assert data.count(old) == 1, ('expected exactly one occurrence', old)
    return data.replace(old, new, 1)

tracked = {}
for entry in git('ls-tree', '-rz', BASELINE).split(b'\0'):
    if not entry:
        continue
    meta, path = entry.split(b'\t', 1)
    mode, kind, oid = meta.decode().split()
    tracked[path.decode()] = {'mode': mode, 'kind': kind, 'oid': oid}
changed_tracked = git('diff', '--name-only', BASELINE, '--', 'src').decode().splitlines()
new_src = sorted(str(p) for p in Path('src').rglob('*')
                 if (p.is_file() or p.is_symlink()) and str(p) not in tracked)
assert set(changed_tracked + new_src) == set(RUNTIME), 'Unexpected runtime source inventory'
protected = sorted(p for p in tracked if
    ((p.split('/')[0] in ROOTS) or p == '3dmodels.md') and p not in RUNTIME and p not in BENCHES)
rows = []
process = subprocess.Popen(['git', 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
assert process.stdin is not None and process.stdout is not None
for path in protected:
    meta = tracked[path]
    assert meta['kind'] == 'blob', (path, 'unexpected tracked object kind')
    process.stdin.write((meta['oid'] + '\n').encode())
    process.stdin.flush()
    header = process.stdout.readline().split()
    baseline = process.stdout.read(int(header[2]))
    assert process.stdout.read(1) == b'\n'
    p = Path(path)
    current = os.readlink(p).encode() if p.is_symlink() else p.read_bytes()
    mode = '120000' if p.is_symlink() else ('100755' if p.stat().st_mode & stat.S_IXUSR else '100644')
    assert current == baseline, ('Protected bytes changed', path)
    assert mode == meta['mode'], ('Protected file mode changed', path, mode, meta['mode'])
    rows.append([path, mode, meta['oid'], sha256(current), len(current)])
process.stdin.close()
assert process.wait() == 0

bike_path = 'src/rendering/bike.ts'
bike = Path(bike_path).read_bytes()
normalized = exactly_once(bike, b"import { sampleMxFootField } from './offroad/mx-foot-pose.ts';\n", b'')
normalized = exactly_once(normalized, b'  MX_MOTION,\n', b'  MX_MOTION,\n  hasMxFootControls,\n')
current_reads = b''.join(
    f'      v.{name} = sampleMxFootField(a, b, o, MX_FOOT.{field}, t);\n'.encode()
    for name, field in [('shiftAngle', 'ANGLE'), ('shiftCover', 'COVER'), ('shiftClear', 'CLEAR')])
old_reads = b'      const left = hasMxFootControls(a, o), right = hasMxFootControls(b, o);\n' + b''.join(
    f'      v.{name} = T.MathUtils.lerp(left ? a[o + MX_FOOT.{field}] : 0, right ? b[o + MX_FOOT.{field}] : 0, t);\n'.encode()
    for name, field in [('shiftAngle', 'ANGLE'), ('shiftCover', 'COVER'), ('shiftClear', 'CLEAR')])
normalized = exactly_once(normalized, current_reads, old_reads)
baseline_bike = blob(BASELINE, bike_path)
assert normalized == baseline_bike, 'Extra bike.ts change beyond permitted readers/imports'

ai_path = 'src/simulation/offroad/ai.ts'
ai = Path(ai_path).read_bytes()
ai_normalized = exactly_once(ai,
    b'    // A finite body stroke can restore front load while that outward path\n'
    b'    // is still unsafe. Support scales the pedal authority below; it must\n'
    b'    // not switch off the geometric lane guard at a load threshold.\n', b'')
ai_gate = b"    if (courseKind === 'supercross' && c.definition.tireFamily === 'knobby' && !d.p.independentRearBrake && c.speed > 3 &&\n"
ai_normalized = exactly_once(ai_normalized,
    ai_gate + b'        race.phase === PHASE.RACING && race.raceTime > LAUNCH_SECONDS) {\n',
    ai_gate + b'        c.forceFront < d.mass * G * 0.38 && race.phase === PHASE.RACING && race.raceTime > LAUNCH_SECONDS) {\n')
assert ai_normalized == blob(BASELINE, ai_path), 'Unexpected AI change'

extras = {}
for root in ROOTS:
    extras[root] = sorted(str(p) for p in Path(root).rglob('*')
                          if (p.is_file() or p.is_symlink()) and str(p) not in tracked)
    assert set(extras[root]) <= set(RUNTIME) | BENCHES, ('Untracked protected-source path', root, extras[root])
inherited = git('diff', '--name-status', BASELINE, RECEIPT_HEAD).decode().splitlines()
assert len(inherited) == 24 and all(line.split('\t')[-1].startswith('ci-reports/') for line in inherited)
assert not git('diff', '--name-only', RECEIPT_HEAD, '--', 'ci-reports').strip()
source_rows = []
for path, classification in sorted(RUNTIME.items()):
    data = Path(path).read_bytes()
    source_rows.append({'path': path, 'status': 'modified' if path in tracked else 'new',
        'classification': classification, 'current_sha256': sha256(data),
        'baseline_sha256': sha256(blob(BASELINE, path)) if path in tracked else None})
def source_region(data, start, end):
    assert data.count(start) == 1 and data.count(end) == 1
    return data[data.index(start):data.index(end)]
preserved_regions = []
for path, label, start, end in [
    ('src/simulation/offroad/dirt-bike-vehicle.ts', 'spring inverse, spring force and preload',
     b'  private springForceInverse(', b'  override place('),
    ('src/simulation/offroad/dirt-bike-vehicle.ts', 'complete landing verdict function',
     b'  private judgeLanding(', b'  /** Mud carried by machine and rider:'),
    ('src/simulation/offroad/mx-ground-physics.ts', 'yaw inertia and complete tyre shear law',
     b'/** Same chassis and rider', b'/** Semi-implicit, internally substepped'),
    ('src/simulation/protocol.ts', 'all transport offsets, strides and protocol version',
     b'export const HEADER', b'/** The contact block begins'),
]:
    a = source_region(blob(BASELINE, path), start, end)
    b = source_region(Path(path).read_bytes(), start, end)
    assert a == b, ('Protected runtime law changed', path, label)
    preserved_regions.append({'path': path, 'region': label, 'bytes': len(a),
        'baseline_and_current_sha256': sha256(a)})
existing_constants = [
    'const RIDER_REACH = 0.25;', 'const RIDER_AIR_LEVER = 0.65;',
    'const DEEP_CONTACT = 0.12,\n  STOP_COMPLIANCE = 0.015;',
    'const PLAYER_GRIP_GRACE = 0.4;', 'const LANDING_NOSE_UP = 0.1;',
]
adapter_base = blob(BASELINE, 'src/simulation/offroad/dirt-bike-vehicle.ts')
adapter_current = Path('src/simulation/offroad/dirt-bike-vehicle.ts').read_bytes()
for declaration in existing_constants:
    assert adapter_base.count(declaration.encode()) == 1
    assert adapter_current.count(declaration.encode()) == 1

manifest = {
    'assignment': 51,
    'audit_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'task_baseline': BASELINE,
    'inherited_receipt_head': RECEIPT_HEAD,
    'observed_head': git('rev-parse', 'HEAD').decode().strip(),
    'task_source_commit': None,
    'method': 'Every protected blob was streamed from git cat-file --batch and compared byte-for-byte with the working file; file modes also compared. SHA-256 is of those equal bytes. Filesystem enumeration includes ignored files within named roots.',
    'protected_scope_roots': list(ROOTS),
    'protected_extra_paths': ['3dmodels.md'],
    'excluded_runtime_and_benches': sorted(set(RUNTIME) | BENCHES),
    'protected_file_count': len(rows),
    'protected_byte_count': sum(row[4] for row in rows),
    'protected_counts_by_root': dict(sorted(collections.Counter(row[0].split('/')[0] for row in rows).items())),
    'protected_rendering_files': sum(row[0].startswith('src/rendering/') for row in rows),
    'protected_offroad_rendering_files': sum(row[0].startswith('src/rendering/offroad/') for row in rows),
    'all_protected_bytes_and_modes_equal': True,
    'protected_row_columns': ['path', 'git_mode', 'baseline_git_blob_sha1', 'baseline_and_current_sha256', 'bytes'],
    'protected_rows_sha256': sha256(json.dumps(rows, separators=(',', ':')).encode()),
    'protected_rows': rows,
    'new_files_in_audited_roots_including_ignored': extras,
    'bike_reader_reversal': {'allowed_changes': 'remove sampleMxFootField import; restore hasMxFootControls import; replace exactly three sampled foot reads with the original four-line reader block', 'original_bytes': len(baseline_bike), 'current_bytes': len(bike), 'baseline_sha256': sha256(baseline_bike), 'current_sha256': sha256(bike), 'reversed_sha256': sha256(normalized), 'reversed_equals_baseline': True},
    'ai_guard_reversal': {'allowed_change': 'three comment lines and removal of c.forceFront < d.mass * G * 0.38 gate only', 'baseline_sha256': sha256(blob(BASELINE, ai_path)), 'current_sha256': sha256(ai), 'reversed_sha256': sha256(ai_normalized), 'reversed_equals_baseline': True},
    'preserved_runtime_law_regions': preserved_regions,
    'preserved_adapter_constant_declarations': existing_constants,
    'runtime': source_rows,
    'runtime_rows_sha256': sha256(json.dumps(source_rows, separators=(',', ':'), sort_keys=True).encode()),
    'inherited_receipt_changes': inherited,
    'working_runtime_diff_numstat': git('diff', '--numstat', BASELINE, '--', 'src').decode().splitlines(),
    'scope_caveat': 'Source/model protection is not a claim of identical non-MX behavior. A30 found two MX-on-road initial placement telemetry changes plus optional foot metadata; its nine exact scenario traces were measured before subsequent MX-only fixes. This audit does not rerun gameplay.',
}
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
print(json.dumps({key: manifest[key] for key in ['audit_utc', 'protected_file_count', 'protected_byte_count', 'protected_counts_by_root', 'protected_rendering_files', 'protected_offroad_rendering_files', 'protected_rows_sha256', 'runtime_rows_sha256', 'bike_reader_reversal', 'ai_guard_reversal']}, indent=2))
