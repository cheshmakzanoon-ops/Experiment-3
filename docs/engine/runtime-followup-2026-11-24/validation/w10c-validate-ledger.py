#!/usr/bin/env python3
"""Read-only reconciliation of existing worker records, Git metadata and receipts.

No engine imports, tests, benchmarks, browser, network, Git writes or asset reads.
Exit 0: consistent snapshot (possibly pending); 1: inconsistency; 2: --require-final
was requested but actual recorded starts/completions or reconciliation are pending.
State is the coordinator's execution record, not independent orchestration proof.
"""
import argparse
import collections
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.parse

BASE = '1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb'
CHECKPOINTS = [
    ('85ae215329ee1bd1ccc66540cece0cda72d197f7', 'f0bfcb614006d98d6c8241c8578decf3b323c5fd'),
    ('5185010e6538d8a9095aca9c4e7964817147e1a1', 'a0b7a4446dc9f8b477f9d7a34443d044ca560df7'),
    ('25a837597de0159a32e2e5d8bad2e9ac74977c22', '40dc98ab64f8b348992e285cd5ec060f0a78596b'),
    ('f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6', '98ae35c4ec253987e6897ebc13a55dee2c1afb21'),
    ('0f7fecfda61ea7e669f04eebd138c52543144421', '831bde9df0759e078ae26c8ca289b1da116bb0ad'),
    ('6314ba3ec7d54a0ba1e79a59b8db8f03117e4520', '18766f8bf4dbfed1bcec2d2917d760df535f94c8'),
    ('6a6bf02eb2d89eeb6aeff32769ef3deb4a49f17c', 'e6d37727eb695278c4934fa11365d6d014c40db6'),
    ('811ac2bc92f4494b1ec99d1fc4201101ccf34c66', 'bcb8ac50d931448e1d321f76d5fbb092c89d1cf1'),
    ('9119c7683d821d145f15ed64a03ee3406595b58d', '3b704f846c3283c21e73f8f5c3febf670a773c63'),
]
FINAL, FINAL_TREE = CHECKPOINTS[-1]
DOCS = 'docs/engine/runtime-followup-2026-11-24'
ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    root_default = Path(__file__).resolve().parent.parent
    ap.add_argument('--evidence-root', type=Path, default=root_default)
    ap.add_argument('--state', type=Path)
    ap.add_argument('--repo', type=Path)
    ap.add_argument('--output', type=Path)
    ap.add_argument('--require-final', action='store_true')
    ap.add_argument('--published-revision', help='Optional actual final commit; also compare its ledger/source.')
    ap.add_argument('--draft-overlay', action='store_true', help='Resolve docs with w09f-draft overlay before integration.')
    args = ap.parse_args()
    root = args.evidence_root.resolve()
    repo = (args.repo or root / 'repo').resolve()
    state_path = args.state or root / 'state.json'
    errors, pending, warnings = [], [], []
    input_receipts = {}
    env = {**os.environ, 'GIT_NO_LAZY_FETCH': '1', 'GIT_ALLOW_PROTOCOL': 'none', 'GIT_OPTIONAL_LOCKS': '0'}

    def check(ok, description):
        if not ok:
            errors.append(description)

    def record(path):
        path = Path(path)
        data = path.read_bytes()
        input_receipts[str(path)] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        return data

    def read_json(path):
        return json.loads(record(path))

    def git(*argv, binary=False):
        run = subprocess.run(['git', '-c', 'protocol.allow=never', *argv], cwd=repo, env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
        if run.returncode:
            raise RuntimeError('Git metadata unavailable without fetching: ' + ' '.join(argv) + ': ' + run.stderr.decode(errors='replace'))
        return run.stdout if binary else run.stdout.decode()

    def tree(sha):
        result = {}
        for entry in git('ls-tree', '-r', '-z', '--full-tree', sha, binary=True).split(b'\0'):
            if not entry:
                continue
            meta, name = entry.split(b'\t', 1)
            mode, kind, oid = meta.decode().split()
            result[name.decode()] = {'mode': mode, 'type': kind, 'oid': oid}
        return result

    def top_tree(sha):
        return dict((line.split('\t', 1)[1], line.split('\t', 1)[0])
                    for line in git('ls-tree', sha).splitlines())

    def ledger_check(data, label):
        check(data.get('baseline') == BASE, label + ': wrong task baseline')
        check(data.get('requested_agents') == 60, label + ': requested agent count is not 60')
        check(data.get('requested_waves') == 10, label + ': requested wave count is not 10')
        check(data.get('maximum_workers') == 3, label + ': worker-slot limit changed')
        check(data.get('coordinator_excluded') is True, label + ': coordinator exclusion missing')
        rows = data.get('agents', [])
        ids, names = [x['id'] for x in rows], [x['task'] for x in rows]
        check(len(ids) == len(set(ids)), label + ': duplicate worker IDs')
        check(len(names) == len(set(names)), label + ': duplicate assignment names')
        check(sorted(ids) == list(range(1, len(rows) + 1)), label + ': IDs are not contiguous distinct starts from 1')
        check(len(rows) <= 60, label + ': more than 60 assignments counted')
        for row in rows:
            i = row['id']
            expected_wave = (i - 1) // 6 + 1
            prefix = f'w{expected_wave:02d}' + 'abcdef'[(i - 1) % 6] + '_'
            check(row['wave'] == expected_wave, label + ': wrong wave for worker ' + str(i))
            check(row['task'].startswith(prefix), label + ': wrong assignment prefix for worker ' + str(i))
            check(row['status'] in ('running', 'complete'), label + ': planned/unstarted/unknown status counted as a start')
        return rows

    state = read_json(state_path)
    rows = ledger_check(state, 'execution state')
    by_id = {x['id']: x for x in rows}
    complete = [x['id'] for x in rows if x['status'] == 'complete']
    running = [x['id'] for x in rows if x['status'] != 'complete']
    not_started = sorted(set(range(1, 61)) - set(by_id))
    if not_started:
        pending.append('Workers not yet recorded as actually started: ' + ', '.join(map(str, not_started)))
    if running:
        pending.append('Started workers without coordinator-recorded completion: ' + ', '.join(map(str, running)))
    anchor = root / 'w10c-work/registration-anchor.json'
    if anchor.exists():
        for old in read_json(anchor)['agents']:
            check(old['id'] in by_id and all(by_id[old['id']][k] == old[k] for k in ('id', 'wave', 'task')),
                  'An already audited distinct assignment identity was replaced: ' + str(old['id']))

    working_ledger = read_json(repo / DOCS / 'AGENTS.json')
    wr = ledger_check(working_ledger, 'working AGENTS.json')
    for row in wr:
        actual = by_id.get(row['id'])
        check(actual is not None and all(actual[k] == row[k] for k in ('id', 'wave', 'task')),
              'Working ledger contains a start/identity not in coordinator execution state: ' + str(row['id']))
    working_matches = wr == rows
    if not working_matches:
        pending.append('Working AGENTS.json has not yet been reconciled with the execution-state snapshot')
    tasks = record(repo / DOCS / 'TASKS.md').decode()
    task_rows = [{'id': int(i), 'wave': int(w), 'task': n, 'status': status.strip()}
                 for i, w, n, status in re.findall(r'^\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*([^|]+)\|', tasks, re.M)]
    check(task_rows == wr, 'TASKS.md rows differ from working AGENTS.json')
    frozen_ledger = json.loads(git('cat-file', 'blob', FINAL + ':' + DOCS + '/AGENTS.json'))
    frozen_rows = ledger_check(frozen_ledger, 'historical checkpoint9 AGENTS.json')
    check(len(frozen_rows) == 51 and sum(r['status'] == 'complete' for r in frozen_rows) == 48,
          'Historical checkpoint9 ledger differs from its known 51-start/48-complete snapshot')

    reports = []
    for i in range(1, 61):
        wave, letter = (i - 1) // 6 + 1, 'abcdef'[(i - 1) % 6]
        path = root / f'w{wave:02d}{letter}.md'
        exists = path.is_file()
        if exists:
            receipt = {'path': str(path), **input_receipts.get(str(path), {})}
            record(path)
            receipt.update(input_receipts[str(path)])
        else:
            receipt = None
        if i in complete and i > 12 and not exists:
            pending.append('Completed worker lacks its retained handoff: ' + str(i))
        reports.append({'id': i, 'wave': wave, 'task': by_id.get(i, {}).get('task'),
                        'status_in_execution_record': by_id.get(i, {}).get('status', 'not_started'),
                        'individual_handoff': receipt,
                        'provenance': ('original scratch handoff lost; committed plan/code/test reconstruction only'
                                       if i <= 12 else 'worker handoff corroborates work; distinct start/completion authority is coordinator history')})
    for w in range(3, 9):
        check((repo / DOCS / f'WAVE-{w:02d}.md').is_file(), 'Missing retained wave report ' + str(w))
    recon = repo / DOCS / 'WAVE01-02.md'
    if not recon.exists():
        recon = root / 'w09f-draft/WAVE01-02.md'
    check(recon.exists(), 'Missing explicit lost-handoff reconstruction for waves 1–2')
    warnings.append('Workers 1–12 original individual reports were lost; no reconstructed worker quotations, historical timing or original test totals are certified.')

    commits = []
    check([x['sha'] for x in state['commits'][:9]] == [x[0] for x in CHECKPOINTS], 'State checkpoint IDs differ from actual published checkpoint list')
    for i, (sha, expected_tree) in enumerate(CHECKPOINTS, 1):
        check(git('cat-file', '-t', sha).strip() == 'commit', 'Checkpoint is not a commit: ' + sha)
        header, message = git('cat-file', 'commit', sha).split('\n\n', 1)
        lines = header.splitlines()
        oid = next(x.split()[1] for x in lines if x.startswith('tree '))
        parents = [x.split()[1] for x in lines if x.startswith('parent ')]
        sec = int(next(x for x in lines if x.startswith('committer ')).rsplit(' ', 2)[1])
        check(oid == expected_tree, 'Published checkpoint tree mismatch: ' + sha)
        top, parent_top = top_tree(sha), top_tree(parents[0])
        check(top.get('ci-reports') == parent_top.get('ci-reports'), 'Engine checkpoint replaced concurrent CI-report tree: ' + sha)
        commits.append({'checkpoint': i, 'sha': sha, 'tree': oid, 'parents': parents,
                        'utc': dt.datetime.fromtimestamp(sec, dt.timezone.utc).isoformat(),
                        'subject': message.splitlines()[0], 'src_tree': git('rev-parse', sha + ':src').strip(),
                        'ci_report_tree_preserved_from_actual_parent': top.get('ci-reports') == parent_top.get('ci-reports')})
    check(len({x['src_tree'] for x in commits[3:6]}) == 1, 'Measured production changed across checkpoints4/5/6')
    check(len({x['src_tree'] for x in commits[6:9]}) == 1, 'Production changed across checkpoints7/8/9')
    chain_lines = git('log', '--first-parent', '--max-count=60', '--format=%H%x09%P%x09%an%x09%s', FINAL).splitlines()
    chain = []
    for line in chain_lines:
        sha, parents, author, subject = line.split('\t', 3)
        chain.append({'sha': sha, 'parents_visible_to_walk': parents.split(), 'author': author, 'subject': subject})
        if author == 'ci-report[bot]' and parents:
            child, parent = top_tree(sha), top_tree(parents.split()[0])
            changed = sorted(k for k in child.keys() | parent.keys() if child.get(k) != parent.get(k))
            check(changed == ['ci-reports'], 'Interleaved report-bot commit has non-report tree delta: ' + sha)
    check(set(x[0] for x in CHECKPOINTS) <= {x['sha'] for x in chain}, 'A named checkpoint is absent from the retained first-parent chain')
    baseline_tree, final_tree = tree(BASE), tree(FINAL)
    src = [p for p in final_tree if p.startswith('src/')]
    changed_src = [p for p in src if final_tree[p] != baseline_tree.get(p)]
    check(len(src) == 1116 and len(changed_src) == 29, 'Final production file counts differ from 1116/29')
    coverage = read_json(root / 'w09e-work/protected-coverage.json')
    protected = {p['path'] for group in coverage['groups'] for p in group['paths']}
    protected_changed = sorted(p for p in protected if baseline_tree.get(p) != final_tree.get(p))
    check(len(protected) == 3883 and not protected_changed, 'Protected baseline/final checkpoint metadata changed')
    head = git('rev-parse', 'HEAD').strip()
    check(git('rev-parse', 'HEAD:src').strip() == commits[-1]['src_tree'], 'Current HEAD production tree differs from tested checkpoint9')
    publication = read_json(root / 'publication.json')
    local_equivalent = publication.get('head')
    if local_equivalent and local_equivalent not in [x[0] for x in CHECKPOINTS]:
        warnings.append('publication.json.head is a local integration identity, not one of the nine published checkpoint SHAs: ' + local_equivalent)
    published_check = None
    if args.published_revision:
        revision = git('rev-parse', args.published_revision + '^{commit}').strip()
        published = json.loads(git('cat-file', 'blob', revision + ':' + DOCS + '/AGENTS.json'))
        check(published.get('agents') == rows, 'Specified final published ledger differs from execution state')
        check(git('rev-parse', revision + ':src').strip() == commits[-1]['src_tree'], 'Specified final published production differs from checkpoint9')
        check(git('merge-base', '--is-ancestor', FINAL, revision) == '', 'Specified final publication does not descend from checkpoint9')
        published_check = {'commit': revision, 'tree': git('rev-parse', revision + '^{tree}').strip(),
                           'ledger_matches_execution_state': published.get('agents') == rows,
                           'remote_visibility': 'not checked by this offline validator; use worker59 publication receipt'}

    selection = read_json(root / 'w09a-final/selection-final.json')
    assertions = read_json(root / 'w09a-final/assertion-results-unique.json')
    summary = read_json(root / 'w09a-final/results-summary.json')
    identities = [(a['file'], a['full_name'], a['same_name_occurrence']) for a in assertions]
    assertion_files = {a['file'] for a in assertions}
    check(len(assertions) == len(set(identities)) == 1852 and len(assertion_files) == 128, 'Local unit result is not 1852 unique cases in 128 physical files')
    check(all(a['status'] == 'passed' for a in assertions), 'Local final unit assertion is not passed')
    check(set(selection['files']) == assertion_files, 'Local selection and actual physical result files differ')
    check(summary['before_head'] == summary['after_head'] == FINAL and summary['source_guard_stable'], 'Local final unit source identity/stability mismatch')
    workflow = git('cat-file', 'blob', FINAL + ':.github/workflows/engine-runtime-validation.yml')
    ci_files = {p for p in final_tree if re.fullmatch(r'tests/engine-[^/]+\.test\.ts', p)}
    adjacent = {'tests/circuit-frame-transport.test.ts', 'tests/circuit-preparation-lifetime.test.ts',
                'tests/festival-renderer-loader-lifecycle.test.ts', 'tests/surface-channel-backpressure.test.ts'}
    ci_files |= adjacent
    check(all(p in workflow for p in adjacent), 'Final focused workflow lost a reviewed adjacent test')
    ci_cases = sum(a['file'] in ci_files for a in assertions)
    check(len(ci_files) == 42 and ci_files <= assertion_files and ci_cases == 506, 'Focused 506/42 is not the stated subset of local1852/128')
    ci = read_json(root / 'checkpoint9-ci.json')
    ci_log = ANSI.sub('', record(root / 'checkpoint9-ci.log').decode(errors='replace'))
    check(ci['commit'] == FINAL and ci['tree'] == FINAL_TREE and ci['conclusion'] == 'success', 'Focused CI receipt identity/result mismatch')
    check(bool(re.search(r'Test Files\s+42 passed\s*\(42\)', ci_log)) and bool(re.search(r'Tests\s+506 passed\s*\(506\)', ci_log)) and bool(re.search(r'\b37 passed \(', ci_log)), 'Focused CI raw log counts differ')
    artifact = read_json(root / 'checkpoint9-artifacts.json')['artifacts'][0]
    check(artifact['workflow_run']['head_sha'] == FINAL and artifact['id'] == ci['artifact_id'] and
          artifact['digest'] == 'sha256:' + ci['artifact_digest'], 'Focused CI reported artifact provenance mismatch')

    broad = read_json(root / 'checkpoint9-broad/unit-summary.json')
    broad_files, broad_failures, broad_partitions = [], [], []
    for shard in range(1, 5):
        log = ANSI.sub('', record(root / f'checkpoint9-broad/unit-{shard}.log').decode(errors='replace'))
        observed = re.findall(r'[✓❯]\s+(tests/[^\s]+\.test\.ts)\s+\((\d+) tests?[^\n]*', log)
        failures = re.findall(r'\bFAIL\s+(tests/[^\n]+)', log)
        broad_files.extend(p for p, n in observed)
        broad_failures.extend(failures)
        broad_partitions.append({'shard': shard, 'physical_files': len(observed),
                                 'tests': sum(int(n) for p, n in observed), 'failed_cases': failures})
    total_broad = sum(p['tests'] for p in broad_partitions)
    check(len(broad_files) == len(set(broad_files)) == broad['physical_files'] == 901, 'Broad CI files are missing or double counted')
    check(total_broad == broad['tests'] == 9598 and total_broad - len(broad_failures) == broad['passed'] == 9594 and len(broad_failures) == broad['failed'] == 4, 'Broad CI raw count mismatch')
    check(set(broad_failures) == set(broad['failed_cases']) and broad['commit'] == FINAL, 'Broad CI case/source receipt mismatch')
    correlation = read_json(root / 'w10a-work/unit-failure-correlation.json')
    inherited = {x['file'] + ' > ' + x['original_title'] for x in correlation['failures'] if x['category'] == 'baseline_confirmed_content_i18n'}
    check(set(broad_failures) == inherited and not correlation['uncorrelated'], 'Final four failures differ from baseline-established failure partition')
    check(assertion_files <= set(broad_files), 'Expanded local files are not contained in broad CI file inventory')
    for failure in broad_failures:
        path = failure.split(' > ', 1)[0]
        check(baseline_tree[path] == final_tree[path], 'Inherited failure test file changed: ' + path)

    build = read_json(root / 'w09b-work/w09b-static-build-manifest.json')
    check(build['passed'] and len(build['checks']) == 5 and all(x['exitCode'] == 0 for x in build['checks']), 'Static/build gate is incomplete or failed')
    check(build['expectedHead'] == FINAL and not build['changedSourcePaths'], 'Static/build source identity/stability mismatch')
    for step in build['checks']:
        record(step['log'])
        check(input_receipts[str(Path(step['log']))]['sha256'] == step['logSha256'], 'Static/build raw log hash mismatch: ' + step['name'])
    native_path = root / 'w09c-native-gate-manifest.json'
    native_result = {'status': 'pending'}
    if native_path.exists():
        native = read_json(native_path)
        cases = read_json(root / 'w09c-case-results.json')
        check(native.get('passed') is True and native['expectedHead'] == FINAL and native['expectedTree'] == FINAL_TREE, 'Final local native gate/source mismatch')
        check(len(cases) == 37 and len({(c['file'], c['title']) for c in cases}) == 37 and len({c['file'] for c in cases}) == 9, 'Native result is not 37 unique cases in nine files')
        check(all(len(c['results']) == 1 and c['results'][0]['status'] == 'passed' and c['results'][0]['retry'] == 0 for c in cases), 'Native case retried or did not pass once')
        check(native['buildIdentity'] == build['buildIdentity'] and not native['changedSourcePaths'] and not native['changedDistPaths'] and not native['changedDistFromBuildPaths'], 'Local native/build source or dist continuity mismatch')
        native_result = {'status': 'passed', 'cases': 37, 'files': 9, 'backend': native['backend'],
                         'finished_at': native['finishedAt'], 'same_selection_as_ci': True,
                         'not_added_to_ci_browser_count': True}
    else:
        pending.append('Final local native/replay receipt is absent')

    manifest_path = root / 'w09f-draft/validation/w09f-draft-source-manifest.json'
    draft_manifest = read_json(manifest_path)
    for item in draft_manifest['copied_evidence']:
        path = root / 'w09f-draft' / item['draft_path']
        record(path)
        check(input_receipts[str(path)]['bytes'] == item['bytes'] and input_receipts[str(path)]['sha256'] == item['sha256'], 'Draft copied evidence hash/size mismatch: ' + item['draft_path'])

    doc_root = repo / DOCS
    overlay = root / 'w09f-draft'
    virtual = {p.resolve(): p for p in doc_root.rglob('*') if p.is_file()}
    if args.draft_overlay:
        for p in overlay.rglob('*'):
            if p.is_file():
                virtual[(doc_root / p.relative_to(overlay)).resolve()] = p
    links = []
    for virtual_path, actual in sorted(virtual.items()):
        if actual.suffix != '.md':
            continue
        content = actual.read_text(errors='replace')
        content = re.sub(r'^```.*?^```\s*$', '', content, flags=re.M | re.S)
        for match in re.finditer(r'(?<!!)\[[^\]\n]+\]\(([^\s)]+)(?:\s+"[^"]*")?\)', content):
            target = match.group(1).strip('<>')
            if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith('#'):
                continue
            parsed = urllib.parse.urlsplit(target)
            resolved = (virtual_path.parent / urllib.parse.unquote(parsed.path)).resolve()
            exists = resolved in virtual or resolved.exists()
            links.append({'from': str(virtual_path.relative_to(repo)), 'target': target, 'exists': exists})
            check(exists, 'Broken local document target: ' + str(virtual_path.relative_to(repo)) + ' -> ' + target)

    report = {
        'schema': 1, 'worker': 57, 'captured_utc': dt.datetime.now(dt.timezone.utc).isoformat(),
        'mode': 'offline audit of coordinator records and existing evidence; no workload reruns',
        'verdict': 'inconsistent' if errors else ('pending' if pending else 'consistent_final_record'),
        'require_final': args.require_final, 'errors': errors, 'pending': pending, 'warnings': warnings,
        'execution_record': {'started': len(rows), 'completed': len(complete), 'running': running, 'not_started': not_started,
                             'waves': [{'wave': w, 'started': sum(a['wave'] == w for a in rows), 'completed': sum(a['wave'] == w and a['status'] == 'complete' for a in rows), 'required': 6} for w in range(1, 11)],
                             'authority': 'Coordinator actual spawn/completion history persisted in state.json. Filenames, planned tasks, resumptions, followups, the coordinator and prior-task agents are not independent starts.',
                             'independent_start_proof_limit': 'This offline validator does not have the historical orchestration log. It independently checks record uniqueness, identity, wave allocation and evidence consistency, not process creation.'},
        'working_ledger': {'started': len(wr), 'completed': sum(a['status'] == 'complete' for a in wr), 'matches_execution_state': working_matches, 'TASKS_matches_AGENTS': task_rows == wr},
        'historical_checkpoint9_ledger': {'started': len(frozen_rows), 'completed': sum(a['status'] == 'complete' for a in frozen_rows), 'intentional_source_freeze_snapshot': True},
        'reports': reports, 'source': {'baseline': BASE, 'tested_commit': FINAL, 'tested_tree': FINAL_TREE, 'current_head': head,
                                     'production_src_tree': commits[-1]['src_tree'], 'production_leaves': len(src), 'production_changed_since_baseline': changed_src,
                                     'protected_leaves': len(protected), 'protected_changed': protected_changed,
                                     'checkpoints': commits, 'retained_first_parent_chain': chain,
                                     'report_bot_commits': sum(x['author'] == 'ci-report[bot]' for x in chain),
                                     'shallow_history': git('rev-parse', '--is-shallow-repository').strip() == 'true',
                                     'local_integration_identity_not_published_checkpoint': local_equivalent,
                                     'specified_final_publication': published_check},
        'validation': {'local_units': {'files': 128, 'unique_cases': 1852, 'passed': 1852},
                       'focused_ci_units': {'files': 42, 'cases': 506, 'entirely_subset_of_local_gate': True},
                       'focused_ci_browser': {'files': 9, 'cases': 37, 'backend': ci['backend']},
                       'broad_ci_units': {'files': 901, 'cases': total_broad, 'passed': total_broad-len(broad_failures), 'failed': len(broad_failures), 'failed_cases': broad_failures, 'partitions': broad_partitions, 'local_file_inventory_is_subset': assertion_files <= set(broad_files)},
                       'local_static_build': {'checks': 5, 'passed': build['passed'], 'build_identity': build['buildIdentity']},
                       'local_native': native_result,
                       'counting_rule': 'All these are separately attributed executions. No sum of overlapping unit runs, repeated browser selections, audit checks or historical measurements is reported.'},
        'documentation': {'overlay_used': args.draft_overlay, 'copied_evidence_hashes_checked': len(draft_manifest['copied_evidence']), 'local_link_targets_checked': len(links), 'broken_targets': [l for l in links if not l['exists']], 'anchor_fragments_checked': False},
        'input_receipts': input_receipts,
    }
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ('verdict', 'errors', 'pending', 'warnings')}, indent=2))
    print(json.dumps({'started': len(rows), 'complete': len(complete), 'handoffs_13_to_48_present': sum(r['individual_handoff'] is not None for r in reports[12:48]),
                      'actual_checkpoint_commits': len(commits), 'interleaved_report_bot_commits': report['source']['report_bot_commits'],
                      'protected_leaves_unchanged': len(protected)-len(protected_changed), 'local_link_targets': len(links), 'output': str(args.output) if args.output else None}, indent=2))
    return 1 if errors else (2 if args.require_final and pending else 0)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({'verdict': 'audit_error', 'reason': str(exc)}, indent=2))
        sys.exit(1)
