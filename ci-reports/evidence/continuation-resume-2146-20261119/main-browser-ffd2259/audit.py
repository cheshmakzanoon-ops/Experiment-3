"""Audit retained main browser logs against the previously enumerated case IDs.

No browser, application code or test is executed. Derived JSON is written beside
the original downloaded logs. Incomplete jobs retain their incomplete status.
"""

from collections import Counter
from datetime import datetime
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import re
import subprocess

SOURCE = 'ffd22598335dfa2a074ebd466e1d53830bb8bb41'
RUN = 44617126580
ROOT = Path(__file__).resolve().parent


def clean(data):
    text = data.decode('utf-8-sig')
    text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)
    return re.sub(r'^\d{4}-\d\d-\d\dT[^ ]+ ', '', text, flags=re.M)


def normalized(value):
    return ' '.join(value.replace(' › ', ' ').split())


def category(body):
    for marker, label in [
        ('e.cast is not a function', 'missing road cast method'),
        ('Upright joint detached', 'upright joint geometry assertion'),
        ("reading 'geometrySurvey'", 'undefined renderer geometrySurvey'),
        ('page.screenshot:', 'screenshot deadline'),
        ('page.waitForEvent:', 'download event deadline'),
        ('locator.fill:', 'locator input deadline'),
        ('page.evaluate: Test timeout', 'page evaluation deadline'),
    ]:
        if marker in body:
            return label
    if 'Expected: "cockpit"' in body and 'Received: "chase"' in body:
        return 'camera transition deadline'
    if 'Received: "loading"' in body or 'Received string:  "loading"' in body:
        return 'race readiness deadline'
    if 'toBeVisible() failed' in body:
        return 'visibility deadline'
    if 'timeout' in body.lower():
        return 'other execution or predicate deadline'
    return 'other assertion or exception'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    args = parser.parse_args()
    run = json.loads((ROOT / 'run.json').read_text())
    jobs = json.loads((ROOT / 'jobs.json').read_text())['jobs']
    assert run['id'] == RUN and run['head_sha'] == SOURCE and run['run_attempt'] == 1
    inventory_bytes = subprocess.check_output([
        'git', 'show', SOURCE + ':ci-reports/evidence/continuation-final-20261119/browser-partitions/actual-inventories.json.gz',
    ], cwd=args.repo)
    inventory = json.loads(gzip.decompress(inventory_bytes))
    outcome = {
        'source': SOURCE, 'runId': RUN, 'runAttempt': 1,
        'runConclusion': run['conclusion'],
        'expectedInventorySHA256': hashlib.sha256(inventory_bytes).hexdigest(),
        'jobs': [],
    }
    for job in jobs:
        match = re.fullmatch(r'(browser|owner-qa) \((\d+)\)', job['name'])
        if not match:
            continue
        group, shard = match[1], int(match[2])
        key = ('ordinary-' if group == 'browser' else 'owner-') + str(shard)
        expected = inventory[key]
        lookup = {}
        for case in expected:
            name = normalized(case['title'])
            assert name not in lookup, (key, name)
            lookup[name] = case
        row = {
            'name': job['name'], 'jobId': job['id'], 'status': job['status'],
            'conclusion': job['conclusion'], 'expected': len(expected),
            'expectedIds': [x['id'] for x in expected],
            'cases': [], 'failures': [], 'finalSummaryPresent': False,
        }
        path = ROOT / f'{group}-{shard}-{job["id"]}.log.gz'
        if job['status'] != 'completed' or not path.exists():
            row['evidenceComplete'] = False
            outcome['jobs'].append(row)
            continue
        raw = gzip.decompress(path.read_bytes())
        text = clean(raw)
        assert re.search(r'^\[command\].*git log -1 --format=%H\n' + SOURCE + r'\n', text, re.M), job['name']
        row['checkoutCommit'] = SOURCE
        row['elapsedSeconds'] = (
            datetime.fromisoformat(job['completed_at'].replace('Z', '+00:00'))
            - datetime.fromisoformat(job['started_at'].replace('Z', '+00:00'))
        ).total_seconds()
        row['log'] = path.name
        row['logSHA256'] = hashlib.sha256(raw).hexdigest()
        discovered = re.findall(r'^Running (\d+) tests? using ', text, re.M)
        row['discovered'] = int(discovered[-1]) if discovered else None
        for found in re.finditer(r'^\s*([✓✘-])\s+(\d+)\s+(e2e/\S+)\s+›\s+(.+)$', text, re.M):
            location = found[3]
            title = re.sub(r' \([0-9.]+(?:ms|s|m|h)\)$', '', found[4])
            file = location.split(':', 1)[0]
            identity = normalized(Path(file).name + ' ' + title)
            assert identity in lookup, (job['name'], identity)
            case = lookup[identity]
            assert case['file'].endswith('/' + file), (job['name'], file)
            row['cases'].append({
                'id': case['id'], 'number': int(found[2]),
                'status': {'✓': 'passed', '✘': 'failed', '-': 'skipped'}[found[1]],
                'location': location, 'title': title,
            })
        ids = [x['id'] for x in row['cases']]
        assert len(ids) == len(set(ids)), (job['name'], 'repeated result; inspect retries')
        counts = Counter(x['status'] for x in row['cases'])
        row['observedCompleted'] = dict(counts)
        row['withoutCompletedResult'] = sorted(set(row['expectedIds']) - set(ids))
        summaries = {}
        for status in ['passed', 'failed', 'skipped']:
            matches = re.findall(rf'^  (\d+) {status}(?: |$)', text, re.M)
            assert len(matches) <= 1, (job['name'], status)
            summaries[status] = int(matches[0]) if matches else 0
        row['finalSummaryPresent'] = any(summaries.values())
        if row['finalSummaryPresent']:
            assert summaries == {s: counts[s] for s in summaries}, (job['name'], summaries, counts)
            assert row['discovered'] == len(expected) == len(ids), job['name']
            assert not row['withoutCompletedResult']
        blocks = list(re.finditer(r'^  (\d+)\) (.+)$', text, re.M))
        for index, block in enumerate(blocks):
            body = text[block.end():blocks[index + 1].start() if index + 1 < len(blocks) else len(text)]
            body = body.split('\n  Slow test file:')[0].split('\n    Error Context:')[0].split('\n    attachment #')[0].strip()
            case_title = block[2].strip().rstrip('─').rstrip()
            matches = [
                case for case in row['cases'] if case['status'] == 'failed'
                and case_title.startswith(case['location'] + ' › ' + case['title'])
            ]
            assert len(matches) == 1, (job['name'], 'Unmatched original failure', case_title)
            row['failures'].append({
                'caseId': matches[0]['id'], 'case': case_title,
                'category': category(body), 'originalFailure': body,
            })
        if row['finalSummaryPresent']:
            assert len(row['failures']) == counts['failed'], job['name']
            assert len({case['caseId'] for case in row['failures']}) == counts['failed'], job['name']
        row['evidenceComplete'] = row['finalSummaryPresent']
        row['failureCategories'] = dict(Counter(x['category'] for x in row['failures']))
        outcome['jobs'].append(row)
    for prefix, inventory_key, n in [('browser', 'ordinary-all', 16), ('owner-qa', 'owner-all', 4)]:
        selected = [x for x in outcome['jobs'] if x['name'].startswith(prefix + ' (')]
        assert len(selected) == n
        expected = {x['id'] for x in inventory[inventory_key]}
        assigned = [identifier for x in selected for identifier in x['expectedIds']]
        assert len(assigned) == len(set(assigned)) and set(assigned) == expected
        observed = [x for job in selected for x in job['cases']]
        observed_ids = [x['id'] for x in observed]
        assert len(observed_ids) == len(set(observed_ids))
        outcome[prefix] = {
            'expected': len(expected),
            'jobsWithFinalSummary': sum(x['finalSummaryPresent'] for x in selected),
            'counts': dict(Counter(x['status'] for x in observed)),
            'withoutCompletedResult': sorted(expected - set(observed_ids)),
            'failureCategories': dict(sum((Counter(x.get('failureCategories', {})) for x in selected), Counter())),
        }
    # These are the original explicit source conditions, not new exemptions.
    # Preserve ordinary skipped outcomes and show the independently executed
    # owner counterpart; never convert a skip into a passing ordinary result.
    conditions = {
        'e2e/07-reference-tools.spec.ts': ('review build', 'test.skip(!REVIEW_BUILD, REVIEW_ONLY_REASON);'),
        'e2e/08-reference-implementation.spec.ts': ('review build', 'test.skip(!REVIEW_BUILD, REVIEW_ONLY_REASON);'),
        'e2e/09-reference-depth.spec.ts': ('review build', 'test.skip(!REVIEW_BUILD, REVIEW_ONLY_REASON);'),
        'e2e/14-phase27e.spec.ts': ('review build', 'test.skip(!REVIEW_BUILD, REVIEW_ONLY_REASON);'),
        'e2e/15-review-journey.spec.ts': ('review build', 'test.skip(!REVIEW_BUILD, REVIEW_ONLY_REASON);'),
        'e2e/24-coupled-driver.spec.ts': ('owner build', 'test.skip(!OWNER_BUILD, OWNER_ONLY_REASON);'),
        'e2e/39-supplied-player.spec.ts': ('owner build', 'test.skip(!OWNER_BUILD, OWNER_ONLY_REASON);'),
        'e2e/41-player-render-budget.spec.ts': ('owner build', 'test.skip(!OWNER_BUILD, OWNER_ONLY_REASON);'),
        'e2e/cabin-render-cost.spec.ts': ('opt-in CABIN_COST=1', "test.skip(process.env.CABIN_COST !== '1', 'Opt-in measurement: set CABIN_COST=1');"),
        'e2e/58-ultra-pipeline.spec.ts': ('opt-in APEX_ULTRA_LIVE=1', "test.skip(!process.env.APEX_ULTRA_LIVE, 'opt-in live ULTRA session (APEX_ULTRA_LIVE=1)');"),
    }
    owner_cases = {
        case['id']: {'jobId': job['jobId'], 'status': case['status']}
        for job in outcome['jobs'] if job['name'].startswith('owner-qa (')
        for case in job['cases']
    }
    outcome['originalSkipConditions'] = []
    for job in outcome['jobs']:
        for case in job['cases']:
            if case['status'] != 'skipped':
                continue
            file = case['location'].split(':', 1)[0]
            assert file in conditions, ('Unreviewed original skip condition', case)
            reason, original_statement = conditions[file]
            raw = subprocess.check_output(['git', 'show', SOURCE + ':' + file], cwd=args.repo)
            source = raw.decode('utf-8')
            assert original_statement in source
            outcome['originalSkipConditions'].append({
                'caseId': case['id'], 'title': case['title'], 'jobId': job['jobId'],
                'file': file, 'sourceSHA256': hashlib.sha256(raw).hexdigest(),
                'originalCondition': original_statement, 'condition': reason,
                'ownerCounterpart': owner_cases.get(case['id']),
            })
    (ROOT / 'summary.json').write_text(json.dumps(outcome, indent=2) + '\n')
    print(json.dumps({k: {a: (len(v) if a == 'withoutCompletedResult' else v) for a, v in outcome[k].items()} for k in ['browser', 'owner-qa']}))


if __name__ == '__main__':
    main()
