#!/usr/bin/env python3
"""Read-only acceptance evidence capture; does not execute engine/test code."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha1, sha256
from pathlib import Path
import json
import os
import subprocess

ROOT = Path('/tmp/engine-c71f32882729')
REPO = ROOT / 'repo'
DOC = REPO / 'docs/engine/runtime-followup-2026-11-24'
OUT = ROOT / 'w10f-work'
BASE = '1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb'
FINAL = '9119c7683d821d145f15ed64a03ee3406595b58d'
EXPECTED_SRC = 'ad28ec3acb55feb301e13232614a14c4230abcae'
CHECKPOINTS = [
    '6a6bf02eb2d89eeb6aeff32769ef3deb4a49f17c',
    '811ac2bc92f4494b1ec99d1fc4201101ccf34c66',
    FINAL,
]
ENV = dict(os.environ, GIT_NO_LAZY_FETCH='1', GIT_OPTIONAL_LOCKS='0',
           GIT_ALLOW_PROTOCOL='none')
operations = []

def git(*args):
    argv = ['git', '-c', 'protocol.allow=never', '-c', 'core.fsmonitor=false', *args]
    result = subprocess.run(argv, cwd=REPO, env=ENV, capture_output=True, check=True)
    operations.append({'argv': argv, 'exit_code': result.returncode,
                       'stdout_bytes': len(result.stdout)})
    return result.stdout

def read_json(name):
    return json.loads((DOC / 'validation' / name).read_text())

def blob_id(data):
    return sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()

OUT.mkdir(exist_ok=True)
state_bytes = (ROOT / 'state.json').read_bytes()
state = json.loads(state_bytes)
agents = state['agents']
identity = {
    c: {'root_tree': git('rev-parse', c + '^{tree}').decode().strip(),
        'src_tree': git('rev-parse', c + ':src').decode().strip()}
    for c in CHECKPOINTS
}
source = []
for row in git('ls-tree', '-r', '-z', '--full-tree', FINAL, '--', 'src').split(b'\0'):
    if not row:
        continue
    meta, encoded_path = row.split(b'\t', 1)
    mode, kind, oid = meta.decode().split()
    path = encoded_path.decode()
    file = REPO / path
    data = file.read_bytes() if file.is_file() else b''
    actual = blob_id(data) if file.is_file() else None
    source.append({'path': path, 'mode': mode, 'type': kind, 'expected_blob': oid,
                   'actual_blob': actual, 'matches': actual == oid})
unit = read_json('w09a-final-results.json')
build = read_json('w09b-static-build-manifest.json')
native = read_json('w09c-native-gate-manifest.json')
cases = read_json('w09c-case-results.json')
focused = read_json('checkpoint9-ci.json')
broad = read_json('checkpoint9-broad-unit-summary.json')
stats = read_json('w10b-statistics-audit.json')
sources = read_json('w10b-source-audit.json')
checks = {
    'sixty_unique_recorded_starts': len(agents) == len({a['id'] for a in agents}) == 60,
    'ten_waves_of_six': Counter(a['wave'] for a in agents) == {w: 6 for w in range(1, 11)},
    'shared_checkpoint_src_tree': all(x['src_tree'] == EXPECTED_SRC for x in identity.values()),
    'current_1116_sources_match': len(source) == 1116 and all(x['matches'] for x in source),
    'local_units': unit['before_head'] == FINAL and unit['after_head'] == FINAL
        and unit['physical_result_files'] == 128
        and unit['vitest_reported_totals']['numPassedTests'] == 1852
        and unit['vitest_reported_totals']['numFailedTests'] == 0
        and unit['source_guard_stable'] and not unit['failures'],
    'five_static_build_checks': build['passed'] and build['expectedHead'] == FINAL
        and len(build['checks']) == 5 and all(x['exitCode'] == 0 for x in build['checks'])
        and not build['changedSourcePaths'],
    'native_exact_build_stable': native['passed'] and native['expectedHead'] == FINAL
        and native['buildIdentity'] == build['buildIdentity']
        and not native['changedSourcePaths'] and not native['changedDistPaths']
        and not native['changedDistFromBuildPaths'],
    'native_37_once': len(cases) == 37 and len({(x['file'], x['title']) for x in cases}) == 37
        and all(x['expectedStatus'] == 'passed' and x['status'] == 'expected'
                and len(x['results']) == 1 and x['results'][0]['status'] == 'passed'
                and x['results'][0]['retry'] == 0 and not x['results'][0]['errors'] for x in cases),
    'focused_ci': focused['commit'] == FINAL and focused['conclusion'] == 'success'
        and focused['unit_tests'] == 506 and focused['unit_files'] == 42
        and focused['browser_tests'] == 37,
    'broad_counts_remain_failed': broad['commit'] == FINAL and broad['physical_files'] == 901
        and broad['passed'] == 9594 and broad['failed'] == 4
        and broad['tests'] == broad['passed'] + broad['failed'],
    'performance_audit_no_discrepancy': len(stats['summaries']) == 43
        and len(stats['checks']) == 925 and not stats['discrepancies']
        and len(sources['checks']) == 2380 and not sources['discrepancies'],
}
names = ['README.md', 'IMPLEMENTATION.md', 'VALIDATION.md', 'COMMIT-HISTORY.md',
         'WAVE09.md', 'WAVE10.md', 'PLAN.md', 'TASKS.md', 'AGENTS.json']
evidence = ['w09a-final-results.json', 'w09a-consolidated-validation.json',
            'w09b-static-build-manifest.json', 'w09c-native-gate-manifest.json',
            'w09c-case-results.json', 'checkpoint9-ci.json',
            'checkpoint9-broad-unit-summary.json', 'w10b-statistics-audit.json',
            'w10b-source-audit.json', 'w10d-source-review.json']
paths = [DOC / n for n in names] + [DOC / 'validation' / n for n in evidence]
paths += [ROOT / n for n in ['WORKER_CONTEXT.md', 'w09e.md', 'w10a.md', 'w10b.md',
                           'w10c.md', 'w10d.md']]
paths += [ROOT / 'w10e.md'] if (ROOT / 'w10e.md').exists() else []
hashes = [{'path': str(p), 'bytes': p.stat().st_size,
           'sha256': sha256(p.read_bytes()).hexdigest()} for p in paths]
record = {
    'worker': 60, 'captured_at': datetime.now(timezone.utc).isoformat(),
    'purpose': 'Acceptance report/source metadata inspection, not product execution or new measurements.',
    'baseline': BASE, 'tested_code_commit': FINAL, 'checkpoint_identities': identity,
    'source_count': len(source), 'source_mismatches': [x for x in source if not x['matches']],
    'state_sha256': sha256(state_bytes).hexdigest(),
    'recorded_started': len(agents),
    'recorded_complete_at_capture': sum(a['status'] == 'complete' for a in agents),
    'not_complete_at_capture': [a for a in agents if a['status'] != 'complete'],
    'checks': checks, 'discrepancies': [name for name, ok in checks.items() if not ok],
    'build_identity': build['buildIdentity'],
    'native_completed_at': native['finishedAt'],
    'focused_ci_job': focused['url'], 'broad_snapshot': broad['snapshot_utc'],
    'evidence_hashes': hashes,
    'limits': ['No remote fetch or final-main visibility check.',
               'Documentation was actively integrating during capture; this is a dated review snapshot.',
               'Coordinator record attests earlier actual starts; no independent reconstruction of lost process history.',
               'Link/ledger final consistency belongs to worker57 strict validator.',
               'No test/build/compiler/browser/benchmark was rerun.'],
    'git_operations': operations,
}
(OUT / 'review-snapshot.json').write_text(json.dumps(record, indent=2) + '\n')
(OUT / 'source-identities.json').write_text(json.dumps(source, indent=2) + '\n')
print(json.dumps({k: record[k] for k in ['captured_at', 'source_count',
    'recorded_started', 'recorded_complete_at_capture', 'discrepancies']}, indent=2))
