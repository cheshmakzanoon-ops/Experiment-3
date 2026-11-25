"""Read-only checkpoint/source/evidence audit; never imports engine code."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha1, sha256
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path('/tmp/engine-c71f32882729')
REPO = ROOT / 'repo'
OUT = ROOT / 'w10d-work'
BASE = '1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb'
FINAL = '9119c7683d821d145f15ed64a03ee3406595b58d'
CHECKPOINTS = [
    '6a6bf02eb2d89eeb6aeff32769ef3deb4a49f17c',
    '811ac2bc92f4494b1ec99d1fc4201101ccf34c66',
    FINAL,
]
ENV = {**os.environ, 'GIT_NO_LAZY_FETCH': '1', 'GIT_OPTIONAL_LOCKS': '0',
       'GIT_ALLOW_PROTOCOL': 'none'}
OPERATIONS = []

def git(*args):
    command = ['git', '-c', 'protocol.allow=never', *args]
    result = subprocess.run(command, cwd=REPO, env=ENV, check=True, capture_output=True)
    OPERATIONS.append({'command': command, 'exit_code': result.returncode})
    return result.stdout

def save(name, data):
    (OUT / name).write_text(json.dumps(data, indent=2) + '\n')

def blob(data):
    return sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()

OUT.mkdir(exist_ok=True)
patch = git('diff', '--no-ext-diff', '--no-textconv', '--unified=5', BASE, FINAL, '--', 'src')
(OUT / 'production-baseline-to-final.patch').write_bytes(patch)
inventory = []
for line in git('diff', '--numstat', BASE, FINAL, '--', 'src').decode().splitlines():
    additions, deletions, path = line.split('\t')
    before = git('show', f'{BASE}:{path}')
    after = git('show', f'{FINAL}:{path}')
    working = (REPO / path).read_bytes()
    inventory.append({
        'path': path, 'added_lines': int(additions), 'removed_lines': int(deletions),
        'baseline_blob': blob(before), 'final_blob': blob(after),
        'baseline_sha256': sha256(before).hexdigest(), 'final_sha256': sha256(after).hexdigest(),
        'working_matches_final': working == after,
    })

source_matches = []
for item in git('ls-tree', '-r', '-z', FINAL, '--', 'src').split(b'\0'):
    if not item:
        continue
    metadata, raw_path = item.split(b'\t', 1)
    mode, kind, expected = metadata.decode().split(' ')
    path = raw_path.decode()
    data = (REPO / path).read_bytes()
    source_matches.append({'path': path, 'mode': mode, 'kind': kind, 'blob': expected,
                           'working_blob': blob(data), 'matches': blob(data) == expected})

source_audit = {
    'worker': 58, 'reviewed_at': datetime.now(timezone.utc).isoformat(),
    'baseline': BASE, 'final': FINAL,
    'final_root_tree': git('rev-parse', f'{FINAL}^{{tree}}').decode().strip(),
    'checkpoint_src_trees': {c: git('rev-parse', f'{c}:src').decode().strip() for c in CHECKPOINTS},
    'changed_files': len(inventory), 'hunks': len(re.findall(rb'^@@ ', patch, re.M)),
    'hunk_context_lines': 5,
    'added_lines': sum(x['added_lines'] for x in inventory),
    'removed_lines': sum(x['removed_lines'] for x in inventory),
    'patch_sha256': sha256(patch).hexdigest(), 'inventory': inventory,
    'source_files': len(source_matches),
    'source_mismatches': [x for x in source_matches if not x['matches']],
}
save('source-review.json', source_audit)
save('all-source-identities.json', source_matches)

unit = json.loads((ROOT / 'w09a-final/results-summary.json').read_text())
cases = json.loads((ROOT / 'w09c-case-results.json').read_text())
static = json.loads((ROOT / 'w09b-work/w09b-static-build-manifest.json').read_text())
ci = json.loads((ROOT / 'checkpoint9-ci.json').read_text())
browser_results = [result for case in cases for result in case['results']]
inputs = [
    'w09e.md', 'w10a.md', 'w10b.md', 'w09f-draft/IMPLEMENTATION.md',
    'w09a-final/results-summary.json', 'w09b-work/w09b-static-build-manifest.json',
    'checkpoint9-ci.json', 'w09c-native-gate-manifest.json', 'w09c-case-results.json',
    'w09f-draft/validation/checkpoint9-broad-unit-summary.json',
]
evidence = {
    'review_only': True,
    'new_tests_builds_benchmarks_browsers': 0,
    'input_identities': [{'path': x, 'bytes': (ROOT / x).stat().st_size,
                          'sha256': sha256((ROOT / x).read_bytes()).hexdigest()} for x in inputs],
    'units': {k: unit[k] for k in ['before_head', 'after_head', 'physical_result_files',
                                  'assertion_status_counts', 'source_guard_stable',
                                  'source_changed_files', 'failures']},
    'static_checks': [{'name': x['name'], 'exit_code': x.get('exitCode')} for x in static['checks']],
    'published_focused_ci_receipt': ci,
    'browser': {
        'cases': len(cases), 'files': len({x['file'] for x in cases}),
        'result_status_counts': dict(Counter(x['status'] for x in browser_results)),
        'retry_indices': sorted({x['retry'] for x in browser_results}),
        'cases_without_exactly_one_result': [x['title'] for x in cases if len(x['results']) != 1],
        'errors': [x['errors'] for x in browser_results if x['errors']],
    },
}
save('evidence-review.json', evidence)
save('operations.json', {'environment': {k: ENV[k] for k in ['GIT_NO_LAZY_FETCH',
      'GIT_OPTIONAL_LOCKS', 'GIT_ALLOW_PROTOCOL']}, 'git_reads': OPERATIONS})
print(json.dumps({k: source_audit[k] for k in ['changed_files', 'hunks', 'added_lines',
      'removed_lines', 'source_files', 'source_mismatches', 'checkpoint_src_trees']}))
print(json.dumps({'unit_results': evidence['units']['assertion_status_counts'],
                  'browser_results': evidence['browser'], 'static_checks': evidence['static_checks']}))
