#!/usr/bin/env python3
"""Audit retained CI inputs; never run tests or mutate the source repository.

Reproduce: python audit-units.py --repo /path/to/Experiment-3
The four original ZIPs and compressed job logs remain authoritative inputs.
"""

import argparse
import collections
import gzip
import hashlib
import json
import math
import pathlib
import re
import subprocess
import zipfile

SOURCE = 'ffd22598335dfa2a074ebd466e1d53830bb8bb41'
RUN = 44617126580
RUNNER_ROOT = '/home/runner/work/Experiment-3/Experiment-3/'
ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=pathlib.Path, required=True)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parent
    metadata = json.loads((root / 'remote-metadata.json').read_text())

    def git(*arguments):
        return subprocess.check_output(['git', *arguments], cwd=args.repo)

    def source(path):
        return git('show', f'{SOURCE}:{path}')

    assert metadata['run']['id'] == RUN
    assert metadata['run']['head_sha'] == SOURCE
    assert metadata['run']['head_branch'] == 'main'
    assert metadata['run']['run_attempt'] == 1
    assert git('rev-parse', f'{SOURCE}^{{tree}}').decode().strip() == metadata['run']['tree']
    config = source('vitest.config.ts').decode()
    assert "include: ['tests/**/*.test.ts']" in config
    package = json.loads(source('package.json'))
    lock = json.loads(source('package-lock.json'))
    assert package['scripts']['test'] == 'vitest run'
    assert lock['packages']['node_modules/vitest']['version'] == '3.2.4'

    inventory = []
    for line in git('ls-tree', '-r', SOURCE, 'tests').decode().splitlines():
        identity, path = line.split('\t', 1)
        mode, kind, blob = identity.split()
        if path.endswith('.test.ts'):
            assert mode == '100644' and kind == 'blob'
            inventory.append({'file': path, 'blob': blob})
    expected = {item['file'] for item in inventory}
    assert len(expected) == len(inventory) == 694
    # Installed Vitest 3.2.4 BaseSequencer.shard hashes the root-relative
    # path WITH its initial slash, sorts SHA-1, then slices ceil(n/count).
    native_path = args.repo / 'node_modules/vitest/dist/chunks/coverage.DL5VHqXY.js'
    native = native_path.read_bytes()
    native_text = native.decode()
    method_start = native_text.index('\tasync shard(files) {', native_text.index('class BaseSequencer'))
    method_end = native_text.index('\n\t// async so it can be extended', method_start)
    native_method = native_text[method_start:method_end]
    assert 'Math.ceil(files.length / count)' in native_method
    assert 'fullPath?.slice(config.root.length)' in native_method
    assert 'hash("sha1", specPath, "hex")' in native_method
    ordered = sorted(expected, key=lambda name: hashlib.sha1(('/' + name).encode()).hexdigest())
    shard_size = math.ceil(len(expected) / 4)
    jobs = {int(re.search(r'\((\d)\)', item['name']).group(1)): item for item in metadata['jobs']}
    artifacts = {int(item['name'].split('-')[2]): item for item in metadata['artifacts']}
    assert set(jobs) == set(artifacts) == {1, 2, 3, 4}

    assignments, cases, failures, duplicate_titles, shard_summaries = {}, [], [], [], []
    all_statuses = collections.Counter()
    receipts = []
    for shard in range(1, 5):
        job, artifact = jobs[shard], artifacts[shard]
        assert job['status'] == 'completed' and job['run_id'] == RUN
        assert artifact['workflow_run']['id'] == RUN
        assert artifact['workflow_run']['head_sha'] == SOURCE
        assert artifact['workflow_run']['head_branch'] == 'main'
        assert not artifact['expired']
        archive = root / f'unit-{shard}.zip'
        raw = archive.read_bytes()
        assert len(raw) == artifact['size_in_bytes']
        assert 'sha256:' + digest(raw) == artifact['digest']
        with zipfile.ZipFile(archive) as zipped:
            assert zipped.testzip() is None
            assert sorted(zipped.namelist()) == [f'unit-{shard}.json', f'unit-{shard}.log']
            report_bytes = zipped.read(f'unit-{shard}.json')
            log_bytes = zipped.read(f'unit-{shard}.log')
        report = json.loads(report_bytes)
        log = ANSI.sub('', log_bytes.decode())
        full_job = gzip.decompress((root / f'job-{shard}.log.gz').read_bytes())
        job_log = ANSI.sub('', full_job.decode())
        assert SOURCE in job_log
        assert f'--shard={shard}/4' in job_log
        assert 'scripts/source-stability.ts -- npm test --' in job_log
        assert 'RUN  v3.2.4' in log
        marker = f'JSON report written to /home/runner/work/_temp/unit-{shard}.json'
        assert marker in log and marker in job_log
        # Negative unit cases intentionally print the guard's error strings.
        # Only the outer guard runs after the final reporter marker.
        guard_tail = job_log.rsplit(marker, 1)[1]
        assert 'Command rewrote application inputs:' not in guard_tail
        assert 'Command terminated by ' not in guard_tail
        shard_files, file_statuses, statuses = set(), collections.Counter(), collections.Counter()
        for file_result in report['testResults']:
            assert file_result['name'].startswith(RUNNER_ROOT)
            name = file_result['name'][len(RUNNER_ROOT):]
            assert name in expected and name not in assignments and name not in shard_files
            assert file_result['message'] == ''
            assert file_result['assertionResults']
            assignments[name] = shard
            shard_files.add(name)
            file_statuses[file_result['status']] += 1
            title_counts = collections.Counter()
            file_cases = collections.Counter()
            for index, case in enumerate(file_result['assertionResults']):
                assert case['status'] in {'passed', 'failed'}
                status = case['status']
                statuses[status] += 1
                file_cases[status] += 1
                title_counts[case['fullName']] += 1
                row = {'shard': shard, 'file': name, 'caseIndex': index, **case}
                cases.append(row)
                if status == 'failed':
                    assert case['failureMessages']
                    failures.append(row)
                else:
                    assert not case['failureMessages']
            assert file_result['status'] == ('failed' if file_cases['failed'] else 'passed')
            duplicate_titles.extend({'file': name, 'fullName': title, 'occurrences': count}
                                    for title, count in title_counts.items() if count > 1)
        expected_shard = set(ordered[(shard - 1) * shard_size:shard * shard_size])
        assert shard_files == expected_shard
        assert len(shard_files) == len(report['testResults'])
        assert report['numPassedTests'] == statuses['passed']
        assert report['numFailedTests'] == statuses['failed']
        assert report['numTotalTests'] == sum(statuses.values())
        assert report['numPendingTests'] == report['numTodoTests'] == 0
        assert report['numPendingTestSuites'] == 0
        assert report['success'] == (statuses['failed'] == 0)
        assert job['conclusion'] == ('failure' if statuses['failed'] else 'success')
        assert report['snapshot']['failure'] is False
        assert report['snapshot']['didUpdate'] is False
        assert not re.search(r'Unhandled Errors|Unhandled Rejection|Uncaught Exception', log)
        duration = float(re.search(r'Duration\s+(\d+\.\d+)s', log).group(1))
        summaries = [line.strip() for line in log.splitlines()
                     if re.match(r'\s*(Test Files|Tests|Duration)\s+', line)]
        shard_summaries.append({'shard': shard, 'jobId': job['id'], 'artifactId': artifact['id'],
                                'conclusion': job['conclusion'], 'files': len(shard_files),
                                'fileStatuses': dict(file_statuses), 'tests': sum(statuses.values()),
                                'passed': statuses['passed'], 'failed': statuses['failed'],
                                'pending': report['numPendingTests'], 'todo': report['numTodoTests'],
                                'nativeShardAssignmentMatches': True, 'durationSeconds': duration,
                                'defaultReporterSummary': summaries})
        all_statuses.update(statuses)
        receipts.append({'shard': shard, 'zip': archive.name, 'zipBytes': len(raw),
                         'zipSha256': digest(raw), 'githubDigestVerified': True,
                         'reportBytes': len(report_bytes), 'reportSha256': digest(report_bytes),
                         'testLogBytes': len(log_bytes), 'testLogSha256': digest(log_bytes),
                         'fullJobLogBytes': len(full_job), 'fullJobLogSha256': digest(full_job)})
    assert set(assignments) == expected
    assert len(cases) == sum(all_statuses.values()) == 6757
    assert all_statuses == {'passed': 6755, 'failed': 2}
    assert len(failures) == 2
    summary = {'sourceCommit': SOURCE, 'sourceTree': metadata['run']['tree'], 'runId': RUN,
               'runAttempt': 1, 'complete': True, 'accepted': False,
               'expectedFiles': len(expected), 'observedFiles': len(assignments),
               'passedFiles': sum(item['fileStatuses'].get('passed', 0) for item in shard_summaries),
               'failedFiles': sum(item['fileStatuses'].get('failed', 0) for item in shard_summaries),
               'missingFiles': [], 'unexpectedFiles': [], 'duplicateFileAssignments': [],
               'nativePartitionMatches': True, 'tests': len(cases), 'passed': all_statuses['passed'],
               'failed': all_statuses['failed'], 'pending': 0, 'todo': 0,
               'shards': shard_summaries, 'failures': failures,
               'repeatedNativeCaseTitles': duplicate_titles,
               'caseIdentity': 'repository file plus zero-based assertionResults index; titles are never deduplicated'}
    provenance_paths = ['.github/workflows/ci.yml', 'vitest.config.ts', 'package.json',
                        'package-lock.json', 'scripts/source-stability.ts',
                        'tests/gp-tyre-contact.test.ts', 'tests/bike-session.test.ts']
    provenance = {'sourceCommit': SOURCE, 'files': {path: {
        'blob': git('rev-parse', f'{SOURCE}:{path}').decode().strip(),
        'bytes': len(source(path)), 'sha256': digest(source(path))} for path in provenance_paths},
        'vitestLock': lock['packages']['node_modules/vitest'],
        'nativeSequencerModule': {'path': str(native_path.relative_to(args.repo)),
                                  'sha256': digest(native), 'shardMethod': native_method}}
    outputs = {'summary.json': encode(summary), 'artifact-receipts.json': encode(receipts),
               'source-provenance.json': encode(provenance),
               'inventory.json.gz': gzip.compress(encode(inventory), mtime=0),
               'file-assignments.json.gz': gzip.compress(encode(assignments), mtime=0),
               'all-test-outcomes.json.gz': gzip.compress(encode(cases), mtime=0)}
    for path, data in outputs.items():
        (root / path).write_bytes(data)
    print(json.dumps({key: summary[key] for key in ['sourceCommit', 'runId', 'complete', 'accepted',
                                                   'expectedFiles', 'observedFiles', 'passedFiles',
                                                   'failedFiles', 'tests', 'passed', 'failed',
                                                   'pending', 'todo', 'nativePartitionMatches']}, indent=2))


if __name__ == '__main__':
    main()
