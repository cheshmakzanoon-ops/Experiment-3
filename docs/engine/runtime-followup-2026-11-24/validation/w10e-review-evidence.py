"""Read-only publication metadata and downloaded-evidence review; no tests run."""
from pathlib import Path
from collections import Counter
import base64
import hashlib
import io
import json
import os
import re
import subprocess
import zipfile

ROOT = Path('/tmp/engine-c71f32882729')
OUT = ROOT / 'w10e-work'
REPO = ROOT / 'repo'
BASE = '1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb'
CHECKPOINTS = json.loads((OUT / 'commit-summary.json').read_text())
SHAS = [x['sha'] for x in CHECKPOINTS]
FINAL = SHAS[-1]
ENV = dict(os.environ, GIT_NO_LAZY_FETCH='1', GIT_OPTIONAL_LOCKS='0', GIT_ALLOW_PROTOCOL='none')
OPERATIONS = []


def save(name, data):
    (OUT / name).write_text(json.dumps(data, indent=2) + '\n')


def git(*args):
    command = ['git', '-c', 'protocol.allow=never', *args]
    r = subprocess.run(command, cwd=REPO, env=ENV, capture_output=True, check=True)
    OPERATIONS.append({'argv': command, 'exit': r.returncode})
    return r.stdout


def tree(rev, recursive=False):
    args = ['ls-tree', '--full-tree', '-z']
    if recursive:
        args.append('-r')
    args.append(rev)
    result = {}
    for entry in git(*args).split(b'\0'):
        if not entry:
            continue
        fields, name = entry.split(b'\t', 1)
        mode, kind, sha = fields.decode().split()
        result[name.decode()] = {'mode': mode, 'type': kind, 'sha': sha}
    return result


def delta(a, b):
    return [{'path': path, 'before': a.get(path), 'after': b.get(path)}
            for path in sorted(set(a) | set(b)) if a.get(path) != b.get(path)]


history = json.loads((OUT / 'main-history.json').read_text())
baseline_index = next(i for i, c in enumerate(history) if c['sha'] == BASE)
history = history[:baseline_index + 1]
assert all(len(c['parents']) == 1 and c['parents'][0]['sha'] == history[i + 1]['sha']
           for i, c in enumerate(history[:-1]))
assert set(SHAS) <= {c['sha'] for c in history}
root_cache = {}
remote_main = json.loads((OUT / 'main-tree.json').read_text())
root_cache[history[0]['sha']] = {
    x['path']: {k: x[k] for k in ['mode', 'type', 'sha']} for x in remote_main['tree']
}


def roots(rev):
    if rev not in root_cache:
        root_cache[rev] = tree(rev)
    return root_cache[rev]


remote_local = []
programme_preservation = []
for c in CHECKPOINTS:
    raw = git('cat-file', '-p', c['sha']).decode()
    raw_tree = re.search(r'^tree ([0-9a-f]{40})$', raw, re.M).group(1)
    raw_parents = re.findall(r'^parent ([0-9a-f]{40})$', raw, re.M)
    assert raw_tree == c['tree'] and raw_parents == c['parents']
    remote_local.append({'checkpoint': c['checkpoint'], 'sha': c['sha'],
                         'tree': raw_tree, 'parents': raw_parents, 'matches': True})
    own, parent = roots(c['sha']), roots(c['parents'][0])
    assert own['ci-reports'] == parent['ci-reports']
    programme_preservation.append({'checkpoint': c['checkpoint'],
                                   'parent': c['parents'][0],
                                   'ci_reports_preserved': True,
                                   'ci_reports_tree': own['ci-reports']['sha'],
                                   'root_changes': delta(parent, own)})

bot_commits = []
for c in history[:-1]:
    if c['sha'] in SHAS:
        continue
    changes = delta(roots(c['parents'][0]['sha']), roots(c['sha']))
    assert [d['path'] for d in changes] == ['ci-reports']
    assert c['commit']['author']['name'] == 'ci-report[bot]'
    bot_commits.append({'sha': c['sha'], 'parent': c['parents'][0]['sha'],
                        'tree': c['commit']['tree']['sha'],
                        'author': c['commit']['author']['name'],
                        'subject': c['commit']['message'].split('\n')[0],
                        'only_changed_root': 'ci-reports'})
save('ancestry-and-preservation.json', {
    'snapshot_utc': json.loads((OUT / 'snapshot-time.json').read_text())['snapshot_utc'],
    'baseline': BASE, 'main': history[0]['sha'],
    'main_tree': history[0]['commit']['tree']['sha'],
    'parent_edges_to_baseline': len(history) - 1,
    'complete_remote_parent_chain': True,
    'all_nine_checkpoints_in_main_ancestry': True,
    'remote_local_metadata': remote_local,
    'programme_preservation': programme_preservation,
    'concurrent_bot_commits': bot_commits,
    'local_shallow_boundary_does_not_replace_remote_parent_proof': True,
})

leaves = {sha: tree(sha, True) for sha in [BASE, *SHAS[6:]]}
after7 = delta(leaves[SHAS[6]], leaves[FINAL])
programme_delta = [d for d in after7 if not d['path'].startswith('ci-reports/')]
expected = {
    '.github/workflows/engine-runtime-validation.yml',
    'tests/circuit-frame-transport.test.ts',
    'tests/circuit-preparation-lifetime.test.ts',
    'tests/festival-renderer-loader-lifecycle.test.ts',
    'tests/surface-channel-backpressure.test.ts',
}
assert {d['path'] for d in programme_delta} == expected
src = {str(i): roots(SHAS[i - 1])['src'] for i in [7, 8, 9]}
src['main'] = roots(history[0]['sha'])['src']
assert len({x['sha'] for x in src.values()}) == 1
assert next(iter(src.values()))['sha'] == 'ad28ec3acb55feb301e13232614a14c4230abcae'
production_changes = [d for d in delta(leaves[BASE], leaves[FINAL]) if d['path'].startswith('src/')]
assert len(production_changes) == 29
parent_deltas = []
for c in CHECKPOINTS[-2:]:
    parent_leaves = tree(c['parents'][0], True)
    changed = delta(parent_leaves, leaves[c['sha']])
    parent_deltas.append({'checkpoint': c['checkpoint'], 'sha': c['sha'],
                          'parent': c['parents'][0], 'changed': changed})
assert len(parent_deltas[0]['changed']) == 4
assert len(parent_deltas[1]['changed']) == 2
save('source-and-fixture-continuity.json', {
    'src_tree_at_7_8_9_and_observed_main': src,
    'source_leaf_count': sum(p.startswith('src/') for p in leaves[FINAL]),
    'after7_programme_delta': programme_delta,
    'after7_concurrent_report_delta': [d for d in after7 if d['path'].startswith('ci-reports/')],
    'checkpoint_parent_deltas': parent_deltas,
    'production_changes_since_baseline': production_changes,
    'all_other_checkpoint7_content_preserved_outside_ci_reports': True,
})

archive = OUT / 'checkpoint9-engine-runtime-validation.zip'
archive_bytes = archive.read_bytes()
archive_hash = hashlib.sha256(archive_bytes).hexdigest()
artifact_metadata = json.loads((OUT / 'artifact-list.json').read_text())['artifacts'][0]
assert len(archive_bytes) == artifact_metadata['size_in_bytes'] == 1178621
assert 'sha256:' + archive_hash == artifact_metadata['digest']
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    prefix = 'Experiment-3/Experiment-3/'
    embedded_commit = z.read('_temp/engine-source-commit.txt').decode().strip()
    embedded_tree = z.read('_temp/engine-source-tree.txt').decode().strip()
    lock_hash = z.read('_temp/engine-package-lock.sha256').decode().split()[0]
    identity = json.loads(z.read(prefix + 'dist/BUILD_IDENTITY.json'))
    backend = json.loads(z.read(prefix + 'browser-backend.json'))
    assert embedded_commit == identity['commit'] == FINAL
    assert embedded_tree == CHECKPOINTS[-1]['tree']
    local_lock_hash = hashlib.sha256(git('cat-file', 'blob', FINAL + ':package-lock.json')).hexdigest()
    assert lock_hash == local_lock_hash
    html = z.read(prefix + 'playwright-report/index.html').decode()
    match = re.search(r'<script id="playwrightReportBase64"[^>]*>data:application/zip;base64,([^<]+)</script>', html)
    report_zip = zipfile.ZipFile(io.BytesIO(base64.b64decode(match.group(1))))
    assert report_zip.testzip() is None
    report = json.loads(report_zip.read('report.json'))
    tests = []
    for f in report['files']:
        detail = json.loads(report_zip.read(f['fileId'] + '.json'))
        for t in detail['tests']:
            tests.append({'file': f['fileName'], 'title': t['title'], 'outcome': t['outcome'],
                          'ok': t['ok'], 'results': [{k: r[k] for k in ['status', 'retry', 'errors', 'duration']}
                                                   for r in t['results']]})
            if f['fileName'] == 'replay-state.spec.ts':
                for a in t['results'][0]['attachments']:
                    if a['name'] in ['recording-stall-continuity.json', 'replay-ownership.json']:
                        save(a['name'], json.loads(a['body']))
    assert len(tests) == 37 and len(report['files']) == 9
    assert report['stats'] == {'total': 37, 'expected': 37, 'unexpected': 0, 'flaky': 0, 'skipped': 0, 'ok': True}
    assert report['errors'] == []
    assert report['metadata']['ci']['commitHash'] == FINAL
    assert report['metadata']['gitCommit']['hash'] == FINAL
    assert all(t['outcome'] == 'expected' and t['ok'] and len(t['results']) == 1
               and t['results'][0]['status'] == 'passed' and t['results'][0]['retry'] == 0
               and not t['results'][0]['errors'] for t in tests)
    for filename in ['engine-runtime-unit.log', 'engine-runtime-build.log', 'engine-runtime-browser.log']:
        (OUT / filename).write_bytes(z.read('_temp/' + filename))
    save('browser-backend.json', backend)
    save('build-identity.json', identity)

new_log = (OUT / 'focused-job.log').read_bytes()
old_log = (ROOT / 'checkpoint9-ci.log').read_bytes()
assert new_log == old_log
save('focused-evidence-review.json', {
    'artifact_id': artifact_metadata['id'], 'artifact_bytes': len(archive_bytes),
    'artifact_sha256': archive_hash, 'api_digest_matches_download': True,
    'archive_member_crc_checks_pass': True,
    'embedded_commit': embedded_commit, 'embedded_tree': embedded_tree,
    'package_lock_sha256': lock_hash, 'package_lock_matches_commit_blob': True,
    'build_identity': identity, 'browser_backend': backend,
    'playwright_stats': report['stats'], 'playwright_duration_ms': report['duration'],
    'files': [{k: f[k] for k in ['fileName', 'stats']} for f in report['files']],
    'tests': tests, 'all_results_once_passed_without_retry_error': True,
    'independently_fetched_job_log_bytes': len(new_log),
    'independently_fetched_job_log_sha256': hashlib.sha256(new_log).hexdigest(),
    'coordinator_job_log_byte_identical': True,
})

ansi = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
unit_results = []
for shard in range(1, 5):
    raw = (ROOT / 'checkpoint9-broad' / f'unit-{shard}.log').read_bytes()
    text = ansi.sub('', raw.decode('utf-8-sig'))
    summary = [line for line in text.splitlines() if re.search(r'\b(Test Files|Tests)\s+', line)]
    failures = [re.sub(r'^.*?FAIL\s+', '', line).strip()
                for line in text.splitlines() if re.search(r'\bFAIL\s+tests/', line)]
    unit_results.append({'shard': shard, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                         'summary_lines': summary[-2:], 'failed_cases': failures})
save('broad-unit-log-review.json', unit_results)
jobs = json.loads((OUT / 'broad-jobs.json').read_text())
assert jobs['total_count'] == len(jobs['jobs']) == 28
save('broad-status-summary.json', {
    'snapshot_utc': json.loads((OUT / 'snapshot-time.json').read_text())['snapshot_utc'],
    'run_id': 45547850446, 'head_sha': FINAL,
    'run_status': json.loads((OUT / 'broad-run.json').read_text())['status'],
    'run_conclusion': json.loads((OUT / 'broad-run.json').read_text())['conclusion'],
    'total_jobs': jobs['total_count'],
    'job_states': dict(Counter(j['status'] + '/' + str(j['conclusion']) for j in jobs['jobs'])),
    'jobs': [{k: j[k] for k in ['id', 'name', 'status', 'conclusion', 'started_at', 'completed_at', 'html_url']}
             for j in jobs['jobs']],
    'broad_unit_logs_reviewed': True,
})
save('operations.json', {'read_only_git_env': {k: ENV[k] for k in ['GIT_NO_LAZY_FETCH', 'GIT_OPTIONAL_LOCKS', 'GIT_ALLOW_PROTOCOL']},
                          'git_operations': OPERATIONS, 'tests_builds_browsers_run': 0,
                          'git_mutations': 0, 'repository_writes': 0,
                          'binary_historical_blob_downloads': 0})
print(json.dumps({'verified_checkpoints': len(CHECKPOINTS), 'remote_parent_edges': len(history) - 1,
                  'preserved_bot_commits': len(bot_commits), 'after7_programme_paths': len(programme_delta),
                  'source_leaves': sum(p.startswith('src/') for p in leaves[FINAL]),
                  'artifact_bytes': len(archive_bytes), 'artifact_sha256': archive_hash,
                  'browser_tests': len(tests), 'browser_files': len(report['files']),
                  'job_log_byte_identical': True, 'broad_jobs': jobs['total_count']}))
