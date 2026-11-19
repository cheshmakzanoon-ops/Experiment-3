#!/usr/bin/env python3
"""Reproduce the complete hosted unit inventory from immutable retained reports."""
from pathlib import Path
import collections
import gzip
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
SOURCE = 'ffd22598335dfa2a074ebd466e1d53830bb8bb41'

def write(name, data):
    (ROOT / name).write_text(json.dumps(data, indent=2) + '\n')

if len(sys.argv) > 1:
    repo = Path(sys.argv[1]).resolve()
    source_tree = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', SOURCE + '^{tree}'], text=True).strip()
    tree = subprocess.check_output(['git', '-C', str(repo), 'ls-tree', '-r', SOURCE, '--', 'tests/'], text=True)
    inventory = []
    for line in tree.splitlines():
        metadata, name = line.split('\t', 1)
        if re.fullmatch(r'tests/(?:[^/]+/)*[^/]+\.test\.ts', name):
            inventory.append({'path': name, 'gitBlob': metadata.split()[2]})
    write('unit/source-file-inventory.json', {'commit': SOURCE, 'tree': source_tree, 'include': ['tests/**/*.test.ts'], 'files': inventory})

inventory = json.loads((ROOT / 'unit/source-file-inventory.json').read_text())
expected = {f['path']: f['gitBlob'] for f in inventory['files']}
assert len(expected) == len(inventory['files'])
seen = collections.Counter()
file_results = []
shards = []
failed_cases = []
for shard in range(1, 5):
    archive = ROOT / f'unit/unit-{shard}.json.gz'
    raw = gzip.decompress(archive.read_bytes())
    data = json.loads(raw)
    counts = collections.Counter()
    files = []
    for result in data['testResults']:
        name = result['name'].removeprefix('/home/runner/work/Experiment-3/Experiment-3/')
        assert name in expected, name
        seen[name] += 1
        case_counts = collections.Counter(case['status'] for case in result['assertionResults'])
        counts.update(case_counts)
        row = {'partition': shard, 'path': name, 'gitBlob': expected[name], 'status': result['status'], 'cases': len(result['assertionResults']), 'caseCounts': dict(case_counts)}
        files.append(row)
        file_results.append(row)
        for case in result['assertionResults']:
            if case['status'] != 'passed':
                failed_cases.append({'partition': shard, 'path': name, **case})
    assert counts['passed'] == data['numPassedTests']
    assert counts['failed'] == data['numFailedTests']
    assert sum(counts.values()) == data['numTotalTests']
    assert data['numPendingTests'] == 0
    assert data['numTodoTests'] == 0
    console = re.sub(r'\x1b\[[0-9;]*m', '', gzip.decompress((ROOT / f'unit/unit-{shard}-job.log.gz').read_bytes()).decode())
    console_files = {}
    for match in re.finditer(r'^\S+\s+[✓❯×]\s+(tests/\S+)\s+\((\d+) tests?(?:\s*\|\s*(\d+) failed)?\)', console, re.M):
        path, total, failures = match.groups()
        assert path not in console_files
        console_files[path] = {'cases': int(total), 'failed': int(failures or 0)}
    assert set(console_files) == {row['path'] for row in files}
    for row in files:
        assert console_files[row['path']]['cases'] == row['cases']
        assert console_files[row['path']]['failed'] == row['caseCounts'].get('failed', 0)
    duration = float(re.search(r'\bDuration\s+([\d.]+)s', console).group(1))
    shards.append({'partition': shard, 'fileCount': len(files), 'passedFiles': sum(row['status'] == 'passed' for row in files), 'failedFiles': sum(row['status'] == 'failed' for row in files), 'tests': data['numTotalTests'], 'caseCounts': dict(counts), 'vitestDurationSeconds': duration, 'success': data['success'], 'reportSHA256': hashlib.sha256(raw).hexdigest(), 'consoleAndReportAgree': True})
missing = sorted(set(expected) - set(seen))
extra = sorted(set(seen) - set(expected))
duplicates = sorted(path for path, count in seen.items() if count != 1)
assert not missing and not extra and not duplicates
assert sum(shard['tests'] for shard in shards) == 6757
summary = {'commit': SOURCE, 'tree': inventory['tree'], 'workflowRun': 44617126580, 'scope': 'Complete original unit suite only; browser/owner-QA and separate graphics workflows are not accepted by these results.', 'files': len(seen), 'passedFiles': sum(s['passedFiles'] for s in shards), 'failedFiles': sum(s['failedFiles'] for s in shards), 'tests': sum(s['tests'] for s in shards), 'passedTests': sum(s['caseCounts'].get('passed', 0) for s in shards), 'failedTests': sum(s['caseCounts'].get('failed', 0) for s in shards), 'pendingTests': 0, 'todoTests': 0, 'partitions': shards, 'missingFiles': missing, 'extraFiles': extra, 'duplicatedFiles': duplicates, 'failedCases': failed_cases, 'allPartitionsComplete': True, 'consoleAndReportsAgree': True, 'jsonSuiteCountNote': 'Vitest numTotalTestSuites includes nested describe suites; file counts use one testResults entry per source file and are independently matched to complete console summaries.'}
write('unit/file-results.json', sorted(file_results, key=lambda row: row['path']))
write('unit/summary.json', summary)
print(json.dumps({key: summary[key] for key in ('files', 'passedFiles', 'failedFiles', 'tests', 'passedTests', 'failedTests', 'missingFiles', 'extraFiles', 'duplicatedFiles')}, indent=2))
