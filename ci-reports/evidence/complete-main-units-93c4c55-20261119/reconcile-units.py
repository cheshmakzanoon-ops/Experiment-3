#!/usr/bin/env python3
"""Audit native unit reports against exact source and retained complete baseline.

This reads evidence only and never invokes Vitest, changes source, or contacts CI.
"""
from pathlib import Path
import collections
import gzip
import hashlib
import json
import re
import sys

ROOT = Path(__file__).resolve().parent
BASE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT.parent / 'complete-main-units-f80309f-20261119'


def write(name, data):
    (ROOT / name).write_text(json.dumps(data, indent=2) + '\n')


def report_cases(data):
    rows = []
    for result in data['testResults']:
        path = result['name'].removeprefix('/home/runner/work/Experiment-3/Experiment-3/')
        for case in result['assertionResults']:
            rows.append({'path': path, **case})
    return rows


inventory = json.loads((ROOT / 'source-file-inventory.json').read_text())
baseline_inventory = json.loads((BASE / 'source-file-inventory.json').read_text())
baseline_reference = json.loads((ROOT / 'baseline-reference.json').read_text())
assert baseline_inventory['commit'] == baseline_reference['sourceCommit']
for retained in baseline_reference['requiredFiles']:
    raw_baseline_input = (BASE / retained['path']).read_bytes()
    assert len(raw_baseline_input) == retained['bytes'], retained['path']
    assert hashlib.sha256(raw_baseline_input).hexdigest() == retained['sha256'], retained['path']
expected = {row['path']: row['gitBlob'] for row in inventory['files']}
baseline_expected = {row['path']: row['gitBlob'] for row in baseline_inventory['files']}
assert len(expected) == len(inventory['files'])
# The accepted wet-path change intentionally changes the simulation tree.
baseline_summary = json.loads((BASE / 'summary.json').read_text())
baseline_cases = []
for shard in range(1, 5):
    baseline_cases.extend(report_cases(json.loads(gzip.decompress((BASE / f'unit-{shard}.json.gz').read_bytes()))))

seen = collections.Counter()
file_results, shards, all_cases, failed_cases = [], [], [], []
for shard in range(1, 5):
    report_path = ROOT / f'unit-{shard}.json'
    if not report_path.exists():
        report_path = ROOT / f'unit-{shard}.json.gz'
    raw = report_path.read_bytes()
    if report_path.suffix == '.gz':
        raw = gzip.decompress(raw)
    data = json.loads(raw)
    counts = collections.Counter()
    files = []
    for result in data['testResults']:
        path = result['name'].removeprefix('/home/runner/work/Experiment-3/Experiment-3/')
        assert path in expected, path
        seen[path] += 1
        case_counts = collections.Counter(case['status'] for case in result['assertionResults'])
        counts.update(case_counts)
        row = {'partition': shard, 'path': path, 'gitBlob': expected[path], 'status': result['status'], 'cases': len(result['assertionResults']), 'caseCounts': dict(case_counts)}
        files.append(row)
        file_results.append(row)
        for case in result['assertionResults']:
            all_cases.append({'partition': shard, 'path': path, **case})
            if case['status'] != 'passed':
                failed_cases.append({'partition': shard, 'path': path, **case})
    assert counts['passed'] == data['numPassedTests']
    assert counts['failed'] == data['numFailedTests']
    assert sum(counts.values()) == data['numTotalTests']
    assert data['numPendingTests'] == 0
    assert data['numTodoTests'] == 0
    log_path = ROOT / f'unit-{shard}-job.log.gz'
    console = re.sub(r'\x1b\[[0-9;]*m', '', gzip.decompress(log_path.read_bytes()).decode())
    node_versions = re.findall(r'\bnode: (v[\d.]+)', console)
    npm_versions = re.findall(r'\bnpm: ([\d.]+)', console)
    assert len(node_versions) == 1 and node_versions[0].startswith('v22.'), node_versions
    assert len(npm_versions) == 1, npm_versions
    assert inventory['commit'] in console
    assert 'node --experimental-transform-types scripts/source-stability.ts -- npm test --' in console
    console_files = {}
    for match in re.finditer(r'^\S+\s+[✓❯×]\s+(tests/\S+)\s+\((\d+) tests?(?:\s*\|\s*(\d+) failed)?\)', console, re.M):
        path, total, failures = match.groups()
        assert path not in console_files, path
        console_files[path] = {'cases': int(total), 'failed': int(failures or 0)}
    assert set(console_files) == {row['path'] for row in files}, {'missingConsole': sorted({r['path'] for r in files} - set(console_files)), 'extraConsole': sorted(set(console_files) - {r['path'] for r in files})}
    for row in files:
        assert console_files[row['path']]['cases'] == row['cases'], row['path']
        assert console_files[row['path']]['failed'] == row['caseCounts'].get('failed', 0), row['path']
    durations = re.findall(r'\bDuration\s+([\d.]+)s', console)
    assert len(durations) == 1, durations
    receipt = json.loads((ROOT / f'unit-{shard}-receipt.json').read_text())
    assert receipt['workflowRun'] == inventory['workflowRun']
    assert receipt['sourceCommit'] == inventory['commit']
    shards.append({'partition': shard, 'jobId': receipt['jobId'], 'jobConclusion': receipt['jobConclusion'], 'artifactId': receipt['artifactId'], 'fileCount': len(files), 'passedFiles': sum(row['status'] == 'passed' for row in files), 'failedFiles': sum(row['status'] == 'failed' for row in files), 'tests': data['numTotalTests'], 'caseCounts': dict(counts), 'vitestDurationSeconds': float(durations[0]), 'success': data['success'], 'node': node_versions[0], 'npm': npm_versions[0], 'sourceGuardCommandPresent': True, 'exactSourceInCheckoutLog': True, 'reportSHA256': hashlib.sha256(raw).hexdigest(), 'consoleAndReportAgree': True})

missing = sorted(set(expected) - set(seen))
extra = sorted(set(seen) - set(expected))
duplicates = sorted(path for path, count in seen.items() if count != 1)
assert not missing and not extra and not duplicates
removed_files = sorted(set(baseline_expected) - set(expected))
added_files = sorted(set(expected) - set(baseline_expected))
changed_files = sorted(path for path in set(expected) & set(baseline_expected) if expected[path] != baseline_expected[path])
baseline_ids = collections.Counter((case['path'], case['fullName']) for case in baseline_cases)
current_original_ids = collections.Counter((case['path'], case['fullName']) for case in all_cases if case['path'] in baseline_expected)
added_original_ids = current_original_ids - baseline_ids
removed_original_ids = baseline_ids - current_original_ids
baseline_failures = {(case['path'], case['fullName']) for case in baseline_cases if case['status'] != 'passed'}
current_failures = {(case['path'], case['fullName']) for case in failed_cases}
comparison = {
    'baselineCommit': baseline_summary['commit'],
    'baselineWorkflowRun': baseline_summary['workflowRun'],
    'baselineFiles': baseline_summary['files'],
    'baselineTests': baseline_summary['tests'],
    'baselinePassedTests': baseline_summary['passedTests'],
    'baselineFailedTests': baseline_summary['failedTests'],
    'originalCaseIdentityMultisetUnchanged': baseline_ids == current_original_ids,
    'allBaselineCaseIdentitiesRetained': not removed_original_ids,
    'addedCasesInOriginalFiles': [{'path': path, 'fullName': name, 'occurrences': count} for (path, name), count in sorted(added_original_ids.items())],
    'removedCasesInOriginalFiles': [{'path': path, 'fullName': name, 'occurrences': count} for (path, name), count in sorted(removed_original_ids.items())],
    'addedFiles': [row for row in file_results if row['path'] in added_files],
    'addedCases': sum(row['cases'] for row in file_results if row['path'] in added_files),
    'totalAddedCasesIncludingDynamicCases': sum(row['cases'] for row in file_results if row['path'] in added_files) + sum(added_original_ids.values()),
    'removedFiles': removed_files,
    'changedOriginalTestFiles': changed_files,
    'sameFailedCaseIdentities': [list(key) for key in sorted(baseline_failures & current_failures)],
    'newFailedCaseIdentities': [list(key) for key in sorted(current_failures - baseline_failures)],
    'baselineFailuresNowPassing': [list(key) for key in sorted(baseline_failures - current_failures)],
}
summary = {
    'commit': inventory['commit'], 'tree': inventory['tree'], 'workflowRun': inventory['workflowRun'],
    'scope': 'Complete current-source native unit suite; browser, owner QA, physics scenarios, graphics pixels and application startup require their own results.',
    'simulationTree': inventory['simulationTree'], 'simulationUnchangedFromBaseline': inventory['simulationTree'] == inventory['baselineSimulationTree'],
    'files': len(seen), 'passedFiles': sum(s['passedFiles'] for s in shards), 'failedFiles': sum(s['failedFiles'] for s in shards),
    'tests': sum(s['tests'] for s in shards), 'passedTests': sum(s['caseCounts'].get('passed', 0) for s in shards), 'failedTests': sum(s['caseCounts'].get('failed', 0) for s in shards),
    'pendingTests': 0, 'todoTests': 0, 'partitions': shards, 'missingFiles': missing, 'extraFiles': extra, 'duplicatedFiles': duplicates,
    'failedCases': failed_cases, 'allPartitionsComplete': True, 'consoleAndReportsAgree': True,
    'baselineComparison': comparison,
    'dynamicCaseExplanation': 'The accepted wet-path source adds a bike-path test file, twelve session identity rows, and a generated YAML case for wet-path-validation.yml; this report derives the complete identities and counts from native JSON results.',
    'jsonSuiteCountNote': 'Vitest numTotalTestSuites includes nested describe suites; file counts use one testResults entry per source file and are independently matched to complete console summaries.',
}
assert summary['tests'] == baseline_summary['tests'] + comparison['addedCases'] + sum(added_original_ids.values()) - sum(removed_original_ids.values())
write('file-results.json', sorted(file_results, key=lambda row: row['path']))
write('summary.json', summary)
print(json.dumps({key: summary[key] for key in ('files', 'passedFiles', 'failedFiles', 'tests', 'passedTests', 'failedTests', 'missingFiles', 'extraFiles', 'duplicatedFiles', 'baselineComparison')}, indent=2))
