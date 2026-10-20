"""Publish the late integration's limited validation scope; never run checks here."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import tempfile

ROOT = Path('/workspace/scratch/b60b57e087a1/Experiment-3')
INPUT = Path('/dev/shm/horizon-b60-validation')
EVIDENCE = ROOT / 'docs/production/horizon-rear-verges-practice-evidence'
VERIFY = EVIDENCE / 'verification'
BACKUP = VERIFY / 'pre-late'
DOCUMENT = ROOT / 'docs/production/HORIZON_REAR_VERGES_PRACTICE_REVISION.md'
COMPILED_BASE = '6537fa7b2fe437c6b52cfca8ca9f6f4a7f1da416'
COMPILED_FP = 'f9038749a41da649beb24746d8e94c58d4d06348a2d9c38bcc97f4e527703000'
PUBLICATION_BASE = '0fb423ef8d278122745319d0e852a7ee53203a59'
PUBLICATION_FP = 'e64e4224af341b31c340f5dad8ec689acfa43c9aac8c0b42c2f86907316e3419'
PHYSICS_FP = '6b5a79e62f11d0f9c985011a08df7f6a8dac76391324e34c530f2e2b9a122313'
CHANGED = ['src/rendering/recorded-tire.ts', 'src/simulation/ai.ts',
           'src/simulation/bike-ai.ts', 'src/simulation/offroad/ai.ts']
PHASES = ['late-integration-tests', 'late-integration-eslint']
TEST_PATTERN = ('recorded carcass deformation|recorded GPU tire binding|waits for current traffic before helping|GPU inspection offsets prescribe supported chassis')


def require(ok, message):
    if not ok:
        raise RuntimeError('Refusing late finalization: ' + message)


def raw(path):
    require(path.is_file(), 'missing artifact ' + str(path))
    return path.read_bytes()


def read_json(path):
    return json.loads(raw(path))


def encoded(value):
    return (json.dumps(value, indent=2) + '\n').encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def verify_current(identity):
    paths = [p for p in (ROOT / 'src').rglob('*') if p.is_file()]
    paths += [ROOT / p for p in ['package-lock.json', 'index.html', 'vite.config.ts']]
    digest, hashes = hashlib.sha256(), {}
    for path in sorted(paths, key=lambda p: p.relative_to(ROOT).as_posix()):
        name, data = path.relative_to(ROOT).as_posix(), raw(path)
        require(name not in hashes, 'duplicate source name')
        hashes[name] = sha(data)
        digest.update(name.encode() + b'\0' + data + b'\0')
    require(hashes == identity['files'] and len(hashes) == identity['fileCount'] == 789,
            'publication source file set or bytes changed')
    require(digest.hexdigest() == identity['fingerprint'] == PUBLICATION_FP and
            identity['integratedBase'] == PUBLICATION_BASE, 'publication identity changed')
    return hashes


def verify_hashes(hashes):
    for name, value in hashes.items():
        require(sha(raw(ROOT / name)) == value, 'recorded source/fixture changed: ' + name)


def replace_once(text, old, new):
    require(text.count(old) == 1, 'unexpected report anchor: ' + old[:90])
    return text.replace(old, new, 1)


def replace_span(text, start, end, new):
    require(text.count(start) == text.count(end) == 1, 'missing/duplicate report boundary')
    a, b = text.index(start), text.index(end)
    require(a < b, 'reversed report boundaries')
    return text[:a] + new + text[b:]


def write_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name + '.', delete=False) as f:
            temporary = Path(f.name)
            f.write(data)
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def main():
    writes = {}
    def plan(path, data, immutable=False):
        if immutable and path.exists():
            require(raw(path) == data, 'historical artifact would change: ' + str(path))
        require(path not in writes or writes[path] == data, 'conflicting planned output')
        writes[path] = data

    # The preserved starting point makes subsequent explicit reruns safe.
    originals = {}
    for name, current_path in [('revision.md', DOCUMENT), ('reference-audit.json', EVIDENCE / 'reference-audit.json'),
                               ('publication-audit.json', VERIFY / 'publication-audit.json')]:
        origin = BACKUP / name if (BACKUP / name).exists() else current_path
        originals[name] = raw(origin)
        plan(BACKUP / name, originals[name], immutable=True)
    prior = json.loads(originals['publication-audit.json'])
    require(prior['integratedBase'] == COMPILED_BASE and prior['productionFingerprint'] == COMPILED_FP,
            'pre-late publication identity differs')
    for name, value in prior['publishedArtifactSha256'].items():
        data = originals['reference-audit.json'] if name == 'reference-audit.json' else raw(EVIDENCE / name)
        require(sha(data) == value, 'prior evidence changed: ' + name)
    compiled_bytes, build_bytes = raw(VERIFY / 'source-identity.json'), raw(VERIFY / 'BUILD_IDENTITY.json')
    compiled, built = json.loads(compiled_bytes), json.loads(build_bytes)
    require(compiled['integratedBase'] == COMPILED_BASE and compiled['fingerprint'] == COMPILED_FP and
            built['fingerprint'] == COMPILED_FP and built['version'] == 1, 'retained compiled identity changed')
    compiled_gate = read_json(VERIFY / 'post-gp-validation.json')
    require(compiled_gate['passed'] is True and compiled_gate['sourceStable'] is True and
            compiled_gate['sourceFingerprint'] == compiled_gate['finalSourceFingerprint'] == COMPILED_FP and
            len(compiled_gate['steps']) == 3 and all(s['passed'] and s['exitCode'] == 0 for s in compiled_gate['steps']),
            'retained full compilation gate is not a pass')

    identity = read_json(INPUT / 'publication-source-identity.json')
    current = verify_current(identity)
    changes = sorted(p for p in set(current) | set(compiled['files']) if current.get(p) != compiled['files'].get(p))
    require(changes == CHANGED, 'incoming production changes differ from four reviewed files')
    impact = read_json(INPUT / 'late-integration-impact.json')
    require(impact['priorBase'] == COMPILED_BASE and impact['priorProductionFingerprint'] == COMPILED_FP and
            impact['publicationBase'] == PUBLICATION_BASE and impact['publicationFingerprint'] == PUBLICATION_FP and
            impact['productionFileCount'] == 789 and impact['changedProductionSources'] == CHANGED,
            'impact review identity/scope differs')
    festival = read_json(VERIFY / 'festival-integration.json')['files']
    require(impact['festivalModuleHashes'] == festival and len(festival) == impact['unchangedFestivalFiles'] == 81,
            'Festival identity proof differs')
    verify_hashes(festival)
    require(impact['historicalPhysicsFingerprintMatchesCurrentAggregate'] is False and
            impact['changedSimulationFiles'] == CHANGED[1:] and
            all(impact[k] is False for k in ['componentCapturesRerun', 'physicalDrivesRerun',
                                            'fullProjectTypescriptAndBuildRerun']), 'late review overstates scope')
    gate = read_json(INPUT / 'late-integration-validation.json')
    require(gate['passed'] is True and gate['sourceStable'] is True and gate['integratedBase'] == PUBLICATION_BASE and
            gate['sourceFingerprint'] == gate['finalSourceFingerprint'] == PUBLICATION_FP, 'late gate incomplete/failed')
    require([s['name'] for s in gate['steps']] == PHASES, 'late gate phase names differ')
    require(gate['testNamePattern'] == TEST_PATTERN, 'late name-filter scope differs')
    test_command = gate['steps'][0]['command']
    require(test_command.count(TEST_PATTERN) == 1 and test_command.index(TEST_PATTERN) > 0 and
            test_command[test_command.index(TEST_PATTERN) - 1] == '--testNamePattern',
            'late Vitest command does not use the exact recorded name filter')
    for step in gate['steps']:
        require(step['passed'] is True and step['exitCode'] == 0 and step['log'] == step['name'] + '.log',
                'late phase failed or log path differs')
        raw(INPUT / step['log'])
    lint = read_json(INPUT / 'late-integration-lint-files.json')
    require(lint == impact['requiredLintFiles'] and len(lint) == len(set(lint)) == 9 and
            gate['steps'][1]['command'][3:] == lint, 'late lint scope differs')
    tests = read_json(INPUT / 'late-integration-tests.json')
    names = ['tests/' + Path(f['name']).name for f in tests['testResults']]
    require(sorted(names) == sorted(gate['testFiles']) == sorted(impact['requiredFocusedTestFiles']) and
            len(names) == 3 and tests['success'] is True and tests['numFailedTests'] == 0, 'late test scope/result differs')
    counts = {Path(f['name']).name: sum(a['status'] == 'passed' for a in f['assertionResults']) for f in tests['testResults']}
    passed, pending = sum(counts.values()), tests['numPendingTests']
    require(passed == tests['numPassedTests'] > 0 and all(n > 0 for n in counts.values()), 'late assertion totals differ')
    require(gate['testCounts'] == {k: tests[k] for k in ['numPassedTests', 'numFailedTests', 'numPendingTests', 'numTotalTests']},
            'late command receipt/test totals disagree')
    # Preserve the interrupted attempt without inferring test success or failure.
    initial_dir = INPUT / 'late-integration-initial'
    initial = read_json(initial_dir / 'late-integration-validation.json')
    require(initial['passed'] is False and initial['steps'] == [] and
            initial['integratedBase'] == PUBLICATION_BASE and initial['sourceFingerprint'] == PUBLICATION_FP,
            'initial interrupted receipt scope/outcome changed')
    require(raw(initial_dir / 'late-integration-tests.log') == b'' and
            raw(initial_dir / 'late-integration-eslint.log') == b'' and
            not (initial_dir / 'late-integration-tests.json').exists(), 'initial missing-output provenance changed')
    raw(initial_dir / 'late-integration-checks.py')
    note = read_json(initial_dir / 'interruption-note.json')
    require(note['status'] == 'incomplete' and note['testOutcome'] == 'not established' and
            note['completedTestResultFile'] is False and note['originalGateRetainedUnmodified'] is True and
            note['productionSourceChanged'] is False and note['observedLintResult']['exitCode'] == 0,
            'root interruption note scope/outcome changed')
    for path in initial_dir.rglob('*'):
        if path.is_file():
            plan(VERIFY / 'late-integration-initial' / path.relative_to(initial_dir), raw(path), immutable=True)
    # Retained pictures are untouched; verify their recorded narrow module/fixture hashes only.
    cars, verges, hud = [read_json(EVIDENCE / p / 'review.json') for p in ['cars', 'verges', 'hud']]
    require(all(r['passed'] is True for r in [cars, verges, hud]), 'retained component result changed')
    for hashes in [cars['sourceBoundary']['after']['files'], cars['sourceBoundary']['fixtures'], hud['sourceSha256'],
                   {p: v['after'] for p, v in verges['source'].items()}, verges['introducedSource'],
                   {'e2e/fixtures/horizon-verge.ts': verges['fixtureSha256'],
                    'e2e/fixtures/horizon-verge.html': verges['fixtureHtmlSha256']}]:
        verify_hashes(hashes)
    session = read_json(EVIDENCE / 'session/review.json')
    require(session['passed'] is False and session['steps'] == [] and session['captures'] == [], 'historical browser result changed')

    prefix = 'horizon-rear-verges-practice-evidence/'
    link = lambda label, path: '[' + label + '](' + prefix + path + ')'
    document = originals['revision.md'].decode()
    for marker in ['VALIDATION_START', 'VALIDATION_END', 'PUBLICATION_START', 'PUBLICATION_END']:
        require(document.count('<!-- ROOT_' + marker + ' -->') == 1, 'ROOT marker missing')
    document = replace_once(document,
        '**Verified 2026-10-20. Latest combined-application TypeScript, lint, and build checks passed. Accepted physical and component/HUD receipts retain their documented source scopes. The bounded full-world browser review did not complete.**',
        '**Verified 2026-10-20. The publication tree passed targeted late-integration tests and lint. Full TypeScript/build and physical driving receipts remain scoped to earlier identified sources. The bounded full-world browser review did not complete.**')
    intro = (f'The publication parent is `{PUBLICATION_BASE}` with canonical production fingerprint `{PUBLICATION_FP}` across **789 files**. The '
             + link('publication source manifest', 'verification/publication-source-identity.json')
             + ' identifies the actual published tree. Its late gate passed **' + str(passed) + ' selected assertions from three incoming test files**, with **' + str(pending) + ' unrelated pending/skipped cases as reported**, and lint of **9 files**; '
             + link('the receipt', 'verification/late-integration-validation.json') + ' retains the exact commands and counts. The Vitest selection was `' + TEST_PATTERN + '`, not an unfiltered run of all three files.\n\n'
             + f'The latest successful **full TypeScript and production build remain scoped to `{COMPILED_BASE}` / `{COMPILED_FP}`**. '
             + link('source-identity.json', 'verification/source-identity.json') + ' and '
             + link('BUILD_IDENTITY.json', 'verification/BUILD_IDENTITY.json')
             + ' deliberately retain that compiled identity. **Neither full TypeScript nor the production bundle was rerun after the four latest production changes.** The successful seven-phase physical/integration gate and RH3 drives remain at `844725` / `a8d081390e9bbe7ab3cd9ed45d7eb4ed75d9a2a2ef6dedb35bcb6b522703d404`.\n\n'
             + 'The four latest production changes are `src/rendering/recorded-tire.ts`, `src/simulation/ai.ts`, `src/simulation/bike-ai.ts`, and `src/simulation/offroad/ai.ts`. The '
             + link('reviewed impact record', 'verification/late-integration-impact.json')
             + ' confirms all **81 Festival files** remain byte-identical. The three AI-file changes mean the aggregate physical input fingerprint **does not match the retained driving fingerprint on the publication tree**. The old 157-file equality proof remains historical through `6537`, not a current claim.\n\n'
             + 'The read-only impact review found the new `trafficRefreshed` behavior is read by `DirtBikeAIDriver`; Festival and the physical runner use the unchanged `RouteDriver`. The tyre update supplies one CPU-computed sine/cosine uniform to lit, depth, and distance passes. The accepted car fixture has inactive recorded contact (`contactShape.w = 0`), and catalogue `WheelAssembly` supplies phase 0. These are control-flow observations, not new rendered-pixel or driving results.\n\n')
    document = replace_span(document, 'The final integrated parent is ', '| Check | Result and source scope |', intro)
    rows = {
        '| Full project TypeScript |': '| Full project TypeScript | Retained successful 6537fa7 compilation; not rerun for the later four production changes | ' + link('6537 compiler log', 'verification/post-gp-typescript.log') + ' |',
        '| Lint |': '| Lint | Earlier full pass, 36 files at 844725, 27 at 6537fa7, then all 9 latest incoming files | ' + link('27-file receipt', 'verification/post-gp-validation.json') + ', ' + link('latest lint log', 'verification/late-integration-eslint.log') + ', ' + link('9-file list', 'verification/late-integration-lint-files.json') + ' |',
        '| Integrated physics/identity assertions |': '| Integrated physics/identity assertions | Retained **26 passes at 844725**; no claim of unchanged aggregate physics inputs on the publication tree | ' + link('Historical assertions', 'verification/integration-tests.json') + ', ' + link('late impact scope', 'verification/late-integration-impact.json') + ' |',
        '| Production bundle |': '| Production bundle | Retained successful 6537fa7 build; emitted identity matches its compiled manifest, not the newer publication manifest | ' + link('6537 build log', 'verification/post-gp-production-build.log') + ', ' + link('retained build identity', 'verification/BUILD_IDENTITY.json') + ' |',
        '| RH3 practice physics |': '| RH3 practice physics | Retained accepted clean and rejected off-road attempts at 844725; not rerun after the latest AI changes | ' + link('Clean', 'physical-clean.json') + ', ' + link('off-road', 'physical-off-road.json') + ' |',
    }
    for start, new in rows.items():
        matches = [line for line in document.splitlines() if line.startswith(start)]
        require(len(matches) == 1, 'verification row missing: ' + start)
        document = replace_once(document, matches[0], new)
    document = replace_once(document, '| --- | --- | --- |\n| Full project TypeScript |',
        '| --- | --- | --- |\n| Late targeted integration | **' + str(passed) + ' selected assertions passed from 3 files**, ' + str(pending)
        + ' pending/skipped as reported | ' + link('Test results', 'verification/late-integration-tests.json') + ', '
        + link('two-phase recipe', 'verification/late-integration-checks.py') + ' |\n| Full project TypeScript |')
    interruption_history = ('### Preserved verification history\n\nThe first late test attempt has an indeterminate outcome following an execution-transport interruption. Its '
        + link('original receipt', 'verification/late-integration-initial/late-integration-validation.json')
        + ' remains `steps: []` / `passed: false`, its '
        + link('test output log', 'verification/late-integration-initial/late-integration-tests.log')
        + ' is empty, and no Vitest result JSON or final receipt was produced. The process disappeared; its cause was not established. No passed or failed test assertions are inferred. The '
        + link('root interruption note', 'verification/late-integration-initial/interruption-note.json')
        + ' retains the separately observed lint exit 0, and the '
        + link('original unfiltered runner', 'verification/late-integration-initial/late-integration-checks.py')
        + ' remains intact. The subsequent successful run used the exact name filter above under the same isolated-worker, 120-second test, and 600-second command bounds; unrelated cases remain skipped as reported.\n\n')
    document = replace_once(document, '### Preserved verification history\n\n', interruption_history)
    document = replace_once(document, 'The latest emitted `BUILD_IDENTITY.json` has version 1 and the final canonical fingerprint.',
        'The retained `BUILD_IDENTITY.json` has version 1 and the `6537` compiled fingerprint. It is deliberately different from the current publication fingerprint.')
    document = replace_once(document, 'The successful final TypeScript and build receipts above supersede that incomplete phase,',
        'The successful 6537 TypeScript and build receipts above supersede that incomplete phase at their recorded scope,')
    document = replace_once(document, '### Warnings observed in the latest production build', '### Warnings observed in the retained 6537 production build')
    document = replace_once(document, 'The latest successful combined-source build emitted the observations below.',
        'The retained successful 6537 combined-source build emitted the observations below; it predates the four latest production changes.')
    document = replace_once(document, '[latest command recipe]', '[6537 command recipe]')
    document = replace_once(document, '[latest build recipe]', '[6537 build recipe]')
    old_physics = f'Both retained receipts match the rechecked 157-file physics/runner fingerprint `{PHYSICS_FP}` over `src/core`, `src/simulation`, the lockfile, and the physical runner.'
    new_physics = f'Both retained receipts record the 157-file physics/runner fingerprint `{PHYSICS_FP}` over `src/core`, `src/simulation`, the lockfile, and the physical runner. That aggregate was verified unchanged through 6537. The three subsequent AI source changes make the current aggregate different; these drives were not rerun on the publication tree.'
    document = replace_once(document, old_physics, new_physics)
    document = replace_once(document, 'the current receipts contain the new physics fingerprint and newly measured sector values.',
        'the 844725 receipts contain their then-current physics fingerprint and newly measured sector values.')
    publication = (f'Publication parent: `{PUBLICATION_BASE}`; actual production fingerprint: `{PUBLICATION_FP}` across 789 files. Last full compilation: `{COMPILED_BASE}` / `{COMPILED_FP}`. Accepted physical/integration gate: `84472529313a7f8912513eeb1b698566fab1b2bc` / `a8d081390e9bbe7ab3cd9ed45d7eb4ed75d9a2a2ef6dedb35bcb6b522703d404`. Captured car and attempted full-session source remains `e5817a170c0f827f0c4cafc97dfea0559e87c0a8eb3c0a286fcc4fb276aeae2b`; original component/reference baseline remains `93576d20a3b52cc5e28959910b4b408418f53d3b`. The '
        + link('current publication audit', 'verification/publication-audit.json') + ', '
        + link('pre-late audit', 'verification/pre-late/publication-audit.json') + ', and '
        + link('pre-GP audit', 'verification/pre-gp/publication-audit.json')
        + ' retain those distinct scopes. The Git commit containing this document identifies publication. Existing Saltmarsh geometry and earlier front/wheel work remain the foundation, not newly attributed features.\n\n')
    document = replace_span(document, '<!-- ROOT_PUBLICATION_START -->\n\n', '<!-- ROOT_PUBLICATION_END -->',
                            '<!-- ROOT_PUBLICATION_START -->\n\n' + publication)
    require(document.split('## What changed', 1)[1].split('## Verification and publication', 1)[0] ==
            originals['revision.md'].decode().split('## What changed', 1)[1].split('## Verification and publication', 1)[0],
            'implementation/reference prose changed')
    ledger = json.loads(originals['reference-audit.json'])
    scope = ledger['implementation_mapping_scope']
    scope.update({'integrated_base': PUBLICATION_BASE, 'production_source_fingerprint': PUBLICATION_FP,
        'compiled_base': COMPILED_BASE, 'compiled_source_fingerprint': COMPILED_FP,
        'publication_source_manifest': 'verification/publication-source-identity.json',
        'full_typescript_and_build_rerun_after_late_changes': False,
        'historical_physics_fingerprint_matches_current_aggregate': False,
        'late_changed_production_files': CHANGED, 'late_targeted_assertions_passed': passed,
        'late_lint_files': 9, 'late_unchanged_festival_files': 81,
        'late_test_name_pattern': TEST_PATTERN, 'late_pending_or_skipped_as_reported': pending,
        'initial_late_test_outcome': 'Indeterminate after transport interruption; no test JSON or final receipt',
        'post_gp_physics_equality_scope_ends_at': COMPILED_BASE,
        'state': 'The publication tree passed targeted late-integration tests and lint. Full TypeScript/build remain scoped to 6537, physical/integration checks to 844725, and component/HUD images to their original receipts. No fresh full-world pass is claimed.',
        'component_scope_note': 'All 81 Festival files and recorded component modules remain unchanged. The later shared tyre shader and three AI files were reviewed and received targeted checks; no images or physical drives were rerun. The prior 157-file physical equality proof is historical through 6537 and does not describe the current aggregate.'})
    ledger['status'] = 'All 100 compressed references remain hash-verified and contact-sheet reviewed; nine individually inspected. Publication identity is separate from retained compiled, physical, component and failed full-world receipt scopes.'
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for name in ['publication-source-identity.json', 'late-integration-validation.json', 'late-integration-tests.json',
                 'late-integration-lint-files.json', 'late-integration-impact.json', 'late-integration-checks.py'] + [s['log'] for s in gate['steps']]:
        plan(VERIFY / name, raw(INPUT / name), immutable=True)
    plan(VERIFY / 'finalize-late-integration.py', raw(Path(__file__)), immutable=True)
    plan(EVIDENCE / 'reference-audit.json', encoded(ledger))
    plan(DOCUMENT, (document.rstrip() + '\n').encode())
    audit = {'verifiedAt': timestamp, 'integratedBase': PUBLICATION_BASE, 'productionFingerprint': PUBLICATION_FP,
        'productionFileCount': 789, 'exactCurrentFileSetAndBytesVerified': True,
        'publicationSourceManifest': 'publication-source-identity.json',
        'compiledBase': COMPILED_BASE, 'compiledFingerprint': COMPILED_FP,
        'compiledSourceManifest': 'source-identity.json', 'builtOutputIdentity': built,
        'builtOutputMatchesCompiledSource': True, 'builtOutputMatchesPublicationSource': False,
        'fullProjectTypescriptAndBuildRerunAfterLateChanges': False,
        'latestGate': 'late-integration-validation.json', 'latestPhasesPassed': PHASES,
        'latestAssertionsPassed': passed, 'latestPassedByFile': counts, 'latestPendingAsReported': pending, 'latestLintFiles': 9,
        'latestTestNamePattern': TEST_PATTERN, 'latestTestSelectionIsFiltered': True,
        'initialLateAttemptOutcome': 'indeterminate; no test JSON or final receipt',
        'initialLateAttemptPreserved': 'late-integration-initial/interruption-note.json',
        'changedProductionSources': CHANGED, 'festivalFilesUnchanged': 81,
        'historicalPhysicsFingerprintMatchesCurrentAggregate': False, 'changedSimulationFiles': CHANGED[1:],
        'retainedPhysicsFingerprint': PHYSICS_FP, 'physicalDrivesRerun': False, 'componentCapturesRerun': False,
        'retainedPhysicalTimesSeconds': prior['retainedPhysicalTimesSeconds'],
        'retainedFestivalTestsPassed': prior['retainedFestivalTestsPassed'],
        'retainedIntegrationAssertionsPassed': prior['retainedIntegrationAssertionsPassed'],
        'impactReview': 'late-integration-impact.json', 'priorPublicationAudit': 'pre-late/publication-audit.json',
        'fullWorldBrowserPassed': False, 'nativeDrivingStepsPassed': 0, 'fullWorldCapturesPassed': 0,
        'historicalFailureAndCleanupReceiptsUnmodified': True, 'rootMarkersRetained': True}
    artifacts = {p: raw(p) for p in EVIDENCE.rglob('*') if p.is_file() and p != VERIFY / 'publication-audit.json'}
    artifacts.update({p: data for p, data in writes.items() if p.is_relative_to(EVIDENCE)})
    audit['publishedArtifactSha256'] = {p.relative_to(EVIDENCE).as_posix(): sha(data) for p, data in sorted(artifacts.items())}
    plan(VERIFY / 'publication-audit.json', encoded(audit))
    verify_current(identity)
    require(raw(VERIFY / 'source-identity.json') == compiled_bytes and raw(VERIFY / 'BUILD_IDENTITY.json') == build_bytes,
            'retained compiled identities changed during preparation')
    require(VERIFY / 'source-identity.json' not in writes and VERIFY / 'BUILD_IDENTITY.json' not in writes,
            'refusing to rewrite retained compiled identities')
    for path, data in writes.items():
        write_atomic(path, data)
    print(json.dumps({'finalized': True, 'publicationFingerprint': PUBLICATION_FP,
                      'compiledFingerprintRetained': COMPILED_FP, 'targetedAssertionsPassed': passed,
                      'latestLintFiles': 9, 'publishedFiles': len(writes)}, indent=2))


if __name__ == '__main__':
    main()
