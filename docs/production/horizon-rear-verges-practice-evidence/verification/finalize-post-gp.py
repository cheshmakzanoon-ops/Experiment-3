"""Finalize post-GP documentation only after the separate three-phase gate passes.

No tests, browser, source edits, staging, or publication occur here. Historical
receipts remain byte-identical. Run explicitly after the revision owner reviews it.
"""
from pathlib import Path
import datetime
import hashlib
import json
import os
import re
import subprocess
import tempfile

ROOT = Path('/workspace/scratch/b60b57e087a1/Experiment-3')
INPUT = Path('/dev/shm/horizon-b60-validation')
EVIDENCE = ROOT / 'docs/production/horizon-rear-verges-practice-evidence'
VERIFY = EVIDENCE / 'verification'
BACKUP = VERIFY / 'pre-gp'
DOCUMENT = ROOT / 'docs/production/HORIZON_REAR_VERGES_PRACTICE_REVISION.md'
OLD_BASE = '84472529313a7f8912513eeb1b698566fab1b2bc'
OLD_FP = 'a8d081390e9bbe7ab3cd9ed45d7eb4ed75d9a2a2ef6dedb35bcb6b522703d404'
FINAL_BASE = '6537fa7b2fe437c6b52cfca8ca9f6f4a7f1da416'
FINAL_FP = 'f9038749a41da649beb24746d8e94c58d4d06348a2d9c38bcc97f4e527703000'
PHYSICS_FP = '6b5a79e62f11d0f9c985011a08df7f6a8dac76391324e34c530f2e2b9a122313'
CAPTURE_FP = 'e5817a170c0f827f0c4cafc97dfea0559e87c0a8eb3c0a286fcc4fb276aeae2b'
OLD_PHASES = ['integration-tests', 'physical-clean', 'physical-off-road', 'typescript',
              'eslint-integrated-changes', 'content', 'production-build']
NEW_PHASES = ['post-gp-typescript', 'post-gp-eslint', 'post-gp-production-build']
RESTORED = ['docs/TRACK_INFRASTRUCTURE_RENDER_BASELINE.json',
            'docs/production/motocross-reference-review-20261017.json',
            'docs/PLAYER_INDEX_CACHE_AUDIT.json']


def require(ok, message):
    if not ok:
        raise RuntimeError('Refusing post-GP finalization: ' + message)


def raw(path):
    require(path.is_file(), 'missing ' + str(path))
    return path.read_bytes()


def read_json(path):
    return json.loads(raw(path))


def encoded(value):
    return (json.dumps(value, indent=2) + '\n').encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def snapshot(paths):
    hashes, digest = {}, hashlib.sha256()
    for path in sorted(paths, key=lambda p: p.relative_to(ROOT).as_posix()):
        name, data = path.relative_to(ROOT).as_posix(), raw(path)
        require(name not in hashes, 'duplicate source path ' + name)
        hashes[name] = sha(data)
        digest.update(name.encode() + b'\0' + data + b'\0')
    return digest.hexdigest(), hashes


def verify_source(identity):
    files = [p for p in (ROOT / 'src').rglob('*') if p.is_file()]
    files += [ROOT / p for p in ['package-lock.json', 'index.html', 'vite.config.ts']]
    fingerprint, hashes = snapshot(files)
    require(hashes == identity['files'], 'exact production file set or bytes changed')
    require(len(hashes) == identity['fileCount'] == 789, 'unexpected production file count')
    require(fingerprint == identity['fingerprint'] == FINAL_FP, 'production fingerprint changed')
    require(identity['integratedBase'] == FINAL_BASE, 'unexpected production parent')
    return hashes


def verify_hashes(hashes):
    for name, expected in hashes.items():
        require(sha(raw(ROOT / name)) == expected, 'recorded module/fixture changed: ' + name)


def verify_gate(report, phases, base, fingerprint, directory):
    require(report['passed'] is True and report['sourceStable'] is True, 'gate incomplete or failed')
    require(report['integratedBase'] == base, 'gate parent differs')
    require(report['sourceFingerprint'] == report['finalSourceFingerprint'] == fingerprint,
            'gate source fingerprint differs')
    require([s['name'] for s in report['steps']] == phases, 'gate phase sequence differs')
    for step in report['steps']:
        require(step['passed'] is True and step['exitCode'] == 0, 'failed phase ' + step['name'])
        require(step['log'] == step['name'] + '.log', 'unexpected log path')
        raw(directory / step['log'])


def replace_once(text, old, new):
    require(text.count(old) == 1, 'unexpected report text: ' + old[:100])
    return text.replace(old, new, 1)


def replace_span(text, start, end, replacement):
    require(text.count(start) == text.count(end) == 1, 'missing or duplicate report boundary')
    left, right = text.index(start), text.index(end)
    require(left < right, 'reversed report boundary')
    return text[:left] + replacement + text[right:]


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
        require(path not in writes or writes[path] == data, 'conflicting output ' + str(path))
        writes[path] = data

    # Recover the same immutable starting point on subsequent explicit reruns.
    replacements = {'verification/source-identity.json': 'source-identity.json',
                    'verification/BUILD_IDENTITY.json': 'BUILD_IDENTITY.json',
                    'reference-audit.json': 'reference-audit.json'}
    originals = {}
    for source, backup in {**replacements, 'verification/publication-audit.json': 'publication-audit.json',
                          'verification/validation.json': 'validation.json',
                          'verification/typescript.log': 'typescript.log',
                          'verification/production-build.log': 'production-build.log'}.items():
        origin = BACKUP / backup if (BACKUP / backup).exists() else EVIDENCE / source
        originals[source] = raw(origin)
        plan(BACKUP / backup, originals[source], immutable=True)
    old_document = raw(BACKUP / 'revision.md') if (BACKUP / 'revision.md').exists() else raw(DOCUMENT)
    plan(BACKUP / 'revision.md', old_document, immutable=True)
    old_identity = json.loads(originals['verification/source-identity.json'])
    old_audit = json.loads(originals['verification/publication-audit.json'])
    old_build = json.loads(originals['verification/BUILD_IDENTITY.json'])
    require(old_identity['fingerprint'] == old_audit['productionFingerprint'] == OLD_FP,
            'prior source/audit identity changed')
    require(old_identity['integratedBase'] == old_audit['integratedBase'] == OLD_BASE and
            old_identity['fileCount'] == len(old_identity['files']) == 785, 'prior source scope changed')
    require(old_build['version'] == 1 and old_build['fingerprint'] == OLD_FP, 'prior built identity changed')
    for path, expected in old_audit['publishedArtifactSha256'].items():
        data = originals[path] if path in originals else raw(EVIDENCE / path)
        require(sha(data) == expected, 'prior published artifact changed: ' + path)

    identity = read_json(INPUT / 'post-gp-source-identity.json')
    current = verify_source(identity)
    proof = read_json(INPUT / 'post-gp-integration.json')
    require(proof['priorBase'] == OLD_BASE and proof['priorFingerprint'] == OLD_FP and
            proof['finalBase'] == FINAL_BASE and proof['finalFingerprint'] == FINAL_FP and
            proof['finalFileCount'] == 789, 'post-GP integration identity differs')
    changed = sorted(p for p in set(current) | set(old_identity['files'])
                     if current.get(p) != old_identity['files'].get(p))
    require(changed == sorted(proof['changedSources']), 'post-GP changed-source inventory differs')
    festival = read_json(VERIFY / 'festival-integration.json')
    require(len(festival['files']) == proof['unchangedFestivalFiles'] == 81 and
            festival['allFestivalFilesUnchanged'] is True, 'Festival proof count/state differs')
    verify_hashes(festival['files'])
    physics_paths = [p for folder in ['src/core', 'src/simulation']
                     for p in (ROOT / folder).rglob('*') if p.is_file()]
    physics_paths += [ROOT / 'package-lock.json', ROOT / 'scripts/horizon-practice-validation.ts']
    physics_fp, physics_hashes = snapshot(physics_paths)
    prior_physics = {p: h for p, h in old_identity['files'].items()
                     if p.startswith(('src/core/', 'src/simulation/')) or p == 'package-lock.json'}
    prior_physics['scripts/horizon-practice-validation.ts'] = festival['files']['scripts/horizon-practice-validation.ts']
    # The integration proof counts 156 production physics inputs; the separately checked runner makes 157.
    require(physics_hashes == prior_physics and proof['physicalFilesCompared'] == 156 and
            len(physics_hashes) == proof['physicalFilesCompared'] + 1 == 157,
            'physical input file set or bytes changed')
    require(physics_fp == proof['physicalSourceFingerprintRetained'] == PHYSICS_FP and
            proof['physicalFileSetAndBytesUnchanged'] is True, 'physical fingerprint differs')

    previous_gate = read_json(VERIFY / 'validation.json')
    verify_gate(previous_gate, OLD_PHASES, OLD_BASE, OLD_FP, VERIFY)
    gate = read_json(INPUT / 'post-gp-validation.json')
    verify_gate(gate, NEW_PHASES, FINAL_BASE, FINAL_FP, INPUT)
    lint_files = read_json(INPUT / 'post-gp-lint-files.json')
    require(len(lint_files) == len(set(lint_files)) == 27, 'latest lint count differs')
    require(gate['steps'][1]['command'][3:] == lint_files and
            gate['steps'][1]['command'][2] == 'node_modules/eslint/bin/eslint.js', 'latest lint scope differs')
    built = read_json(INPUT / 'post-gp-dist/BUILD_IDENTITY.json')
    require(built['version'] == 1 and built['fingerprint'] == FINAL_FP and
            built.get('commit') in [None, FINAL_BASE], 'latest built identity differs')
    for filename, count in [('pre-v15/tests.json', 63), ('integration-tests.json', 26)]:
        tests = read_json(VERIFY / filename)
        assertions = [a for f in tests['testResults'] for a in f['assertionResults']]
        require(tests['success'] is True and tests['numFailedTests'] == 0 and
                tests['numPassedTests'] == count and sum(a['status'] == 'passed' for a in assertions) == count,
                'retained test success/count changed: ' + filename)
    for name, clean in [('clean', True), ('off-road', False)]:
        physical = read_json(EVIDENCE / ('physical-' + name + '.json'))
        result, practice = physical['result'], physical['result']['practice']
        require(physical['passed'] is True and physical['sourceBefore'] == physical['sourceAfter'] == PHYSICS_FP,
                'retained physical receipt changed')
        require(result['completed'] is True and len(practice['splits']) == 3 and
                practice['valid'] is clean and practice['newBest'] is clean and
                practice['reason'] == (None if clean else 'off-road'), 'physical acceptance/rejection changed')

    cars, verges, hud = [read_json(EVIDENCE / p / 'review.json') for p in ['cars', 'verges', 'hud']]
    require(all(r['passed'] is True and r.get('errors', []) == [] for r in [cars, verges, hud]),
            'component receipt is not a pass')
    require(cars['sourceBoundary']['after']['fingerprint'] == CAPTURE_FP and
            len(cars['comparisons']) == len(verges['comparisons']) == 3 and
            len(hud['cases']) == 19 and all(c['passed'] for c in hud['cases']), 'component scope changed')
    verify_hashes(cars['sourceBoundary']['after']['files'])
    verify_hashes(cars['sourceBoundary']['fixtures'])
    verify_hashes({p: value['after'] for p, value in verges['source'].items()})
    verify_hashes(verges['introducedSource'])
    verify_hashes({'e2e/fixtures/horizon-verge.ts': verges['fixtureSha256'],
                   'e2e/fixtures/horizon-verge.html': verges['fixtureHtmlSha256']})
    verify_hashes(hud['sourceSha256'])
    inventory = read_json(EVIDENCE / 'car-lod-inventory.json')
    verify_hashes({'src/rendering/vehicle-bodies/' + p: h for p, h in inventory['sourceHashes'].items()})
    for folder, report in [('cars', cars), ('verges', verges)]:
        for variant in report['variants']:
            for view in variant['views']:
                image = view['image']
                require(sha(raw(EVIDENCE / folder / image['file'])) == image['sha256'], 'component PNG changed')
    for image in hud['visualInspection']['byteIdenticalScreenshots']:
        require(sha(raw(EVIDENCE / 'hud' / image['file'])) == image['sha256'], 'HUD PNG changed')
    session = read_json(EVIDENCE / 'session/review.json')
    require(session['passed'] is False and session['steps'] == [] and session['captures'] == [] and
            session['sourceFingerprint'] == CAPTURE_FP and session['budgetsMs']['startup'] == 180000 and
            session['failure']['phase'] == 'startup and initial production draw' and
            session['postRunCleanup']['ownedProcessesRemaining'] == [], 'historical session failure changed')

    failure = read_json(INPUT / 'post-gp-sparse-initial-validation.json')
    failure_log = raw(INPUT / 'post-gp-sparse-initial-typescript.log')
    require(failure['passed'] is False and failure['sourceStable'] is True and
            failure['sourceFingerprint'] == failure['finalSourceFingerprint'] == FINAL_FP and
            len(failure['steps']) == 1 and failure['steps'][0]['name'] == 'post-gp-typescript' and
            failure['steps'][0]['exitCode'] == 2, 'sparse-checkout failure provenance changed')
    restored_hashes = {}
    for name in RESTORED:
        expected = subprocess.check_output(['git', 'show', FINAL_BASE + ':' + name], cwd=ROOT)
        require(raw(ROOT / name) == expected and name not in current, 'restored fixture differs from tracked bytes')
        require(Path(name).name.encode() in failure_log, 'fixture missing from retained failure output')
        restored_hashes[name] = sha(expected)

    # Read the observed final build warnings/sizes, rather than assuming previous output.
    build_text = raw(INPUT / 'post-gp-production-build.log').decode(errors='replace')
    lines = [re.sub(r'\x1b\[[0-9;]*m', '', line) for line in build_text.splitlines()]
    warnings = list(dict.fromkeys(line.strip() for line in lines
                    if 'ExperimentalWarning:' in line or line.lstrip().startswith('(!)')))
    chunks = []
    for line in lines:
        match = re.search(r'(\S+\.js)\s+([\d,.]+)\s+kB\s+.*?gzip:\s*([\d,.]+)\s+kB', line)
        if match and float(match[2].replace(',', '')) > 500:
            chunks.append({'file': Path(match[1]).name, 'kB': float(match[2].replace(',', '')),
                           'gzipKB': float(match[3].replace(',', ''))})
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    document = old_document.decode()
    require(OLD_FP in document and FINAL_FP not in document, 'pre-GP report backup has unexpected identity')
    for marker in ['VALIDATION_START', 'VALIDATION_END', 'PUBLICATION_START', 'PUBLICATION_END']:
        require(document.count('<!-- ROOT_' + marker + ' -->') == 1, 'ROOT report marker missing')
    document = replace_once(document,
        '**Verified 2026-10-20. Final integration and physical checks passed; earlier component/HUD evidence retains its original scope. The bounded full-world browser review did not complete.**',
        '**Verified 2026-10-20. Latest combined-application TypeScript, lint, and build checks passed. Accepted physical and component/HUD receipts retain their documented source scopes. The bounded full-world browser review did not complete.**')
    prefix = 'horizon-rear-verges-practice-evidence/'
    link = lambda label, path: '[' + label + '](' + prefix + path + ')'
    introduction = (
        f'The final integrated parent is `{FINAL_BASE}`, adding the later MotoGP rendering/UI revision to the physics-v15 and MotoX-v16 integration. The recorded simulation identity remains version 16. The verified production source has canonical SHA-256 fingerprint `{FINAL_FP}`. The '
        + link('final source manifest', 'verification/source-identity.json')
        + ' records the exact **789-file** set and each file hash; the '
        + link('post-GP three-phase receipt', 'verification/post-gp-validation.json')
        + ' records successful full TypeScript, lint of 27 incoming files, and production compilation. The finalizer checks the exact file set and bytes again before writing this report.\n\n'
        + f'The successful **seven-phase physics/integration gate remains scoped to `{OLD_BASE}` / `{OLD_FP}`**, with its original 785-file source identity. '
        + link('That gate', 'verification/validation.json') + ', '
        + link('its source/build/audit snapshots', 'verification/pre-gp/publication-audit.json')
        + ', and both accepted driving receipts remain intact. The '
        + link('post-GP integration proof', 'verification/post-gp-integration.json')
        + ' and the finalizer independently confirm **81 Festival files** and the exact **156 core/simulation/lockfile inputs plus the validation runner (157 files total)** are byte-identical. Those measured scopes support retaining the earlier physical and Festival checks; they do not turn old component pictures into new whole-application captures.\n\n')
    document = replace_span(document, 'The final integrated parent is ', '| Check | Result and source scope |', introduction)
    rows = {
        '| Full project TypeScript |': '| Full project TypeScript | Passed on final 6537fa7 combined source | ' + link('Latest compiler log', 'verification/post-gp-typescript.log') + ' |',
        '| Lint |': '| Lint | Earlier full pass, 36 changed files at 844725, then all 27 newly changed TS/JS files after MotoGP integration | ' + link('Earlier full pass', 'verification/pre-v15/validation.json') + ', ' + link('36-file pass', 'verification/eslint-integrated-changes.log') + ', ' + link('latest lint log', 'verification/post-gp-eslint.log') + ', ' + link('27-file list', 'verification/post-gp-lint-files.json') + ' |',
        '| Runtime content |': '| Runtime content | Passed at 844725; retained with its original scope | ' + link('Content log', 'verification/content.log') + ' |',
        '| Final integration assertions |': '| Integrated physics/identity assertions | **26 passed** at 844725: air-relative aerodynamics 6, identity/schema 19, SC7 physical opening 1; measured physics inputs remain unchanged | ' + link('Parameterized results', 'verification/integration-tests.json') + ', ' + link('unchanged-input proof', 'verification/post-gp-integration.json') + ' |',
        '| Production bundle |': '| Production bundle | Passed on final 6537fa7 source with the actual Vite configuration; emitted identity matches the latest canonical fingerprint | ' + link('Latest build log', 'verification/post-gp-production-build.log') + ', ' + link('built identity', 'verification/BUILD_IDENTITY.json') + ' |',
        '| RH3 practice physics |': '| RH3 practice physics | Accepted clean lap and rejected intentional off-road benchmark recorded at 844725; all 156 core/simulation/lockfile inputs plus the runner still match | ' + link('Clean', 'physical-clean.json') + ', ' + link('off-road', 'physical-off-road.json') + ' |',
    }
    for start, replacement in rows.items():
        old_rows = [line for line in document.splitlines() if line.startswith(start)]
        require(len(old_rows) == 1, 'check table row missing: ' + start)
        document = replace_once(document, old_rows[0], replacement)
    build_identity_note = ('Its `commit: null` is preserved because the build preceded the publication commit; no commit identity is invented.'
                           if built.get('commit') is None else 'Its recorded commit is `' + built['commit'] + '`; the canonical source fingerprint remains the exact content identity.')
    document = replace_span(document, 'The emitted `BUILD_IDENTITY.json` has ', '\n\nThe final selected test receipt',
        'The latest emitted `BUILD_IDENTITY.json` has version 1 and the final canonical fingerprint. ' + build_identity_note
        + ' The earlier identity remains at ' + link('pre-gp/BUILD_IDENTITY.json', 'verification/pre-gp/BUILD_IDENTITY.json') + '.')
    history = ('### Preserved verification history\n\nThe first post-GP TypeScript attempt failed because sparse checkout omitted three tracked JSON fixtures: `docs/TRACK_INFRASTRUCTURE_RENDER_BASELINE.json`, `docs/production/motocross-reference-review-20261017.json`, and `docs/PLAYER_INDEX_CACHE_AUDIT.json`. The '
               + link('failed gate', 'verification/post-gp-sparse-initial-validation.json') + ' and '
               + link('original compiler output', 'verification/post-gp-sparse-initial-typescript.log')
               + ' remain failed and unedited. The fixtures were restored byte-identically to the integrated parent; '
               + link('restoration hashes', 'verification/post-gp-restored-fixtures.json')
               + ' record that check. They are outside the 789-file production fingerprint. No implementation changes or relaxed checks were used to resolve the missing imports.\n\n')
    document = replace_once(document, '### Preserved verification history\n\n', history)
    document = replace_once(document, 'The [final command recipe]', 'The retained 844725 [physics integration command recipe]')
    document = replace_once(document, '### Warnings observed in the final production build',
                           '### Warnings observed in the latest production build')
    warning_text = ('### Warnings observed in the latest production build\n\nThe latest successful combined-source build emitted the observations below. They are read from its actual log without assuming that a warning predates this revision. The earlier build remains available under '
                    + link('pre-gp/production-build.log', 'verification/pre-gp/production-build.log') + '.\n\n')
    warning_text += '\n'.join('- ' + warning for warning in warnings) if warnings else 'No warning lines matching the recorded build-warning markers were emitted.'
    if chunks:
        warning_text += '\n\nJavaScript chunks above 500 kB in the latest output:\n\n| Emitted file | Size, kB | Gzip, kB |\n| --- | ---: | ---: |\n'
        warning_text += '\n'.join(f"| `{c['file']}` | {c['kB']:,.2f} | {c['gzipKB']:,.2f} |" for c in chunks)
    warning_text += ('\n\nTemporary-output warnings and emitted bundle sizes do not establish browser startup time or hardware rendering performance. The '
                     + link('latest command recipe', 'verification/post-gp-checks.py') + ' and '
                     + link('latest build recipe', 'verification/post-gp-build.mjs')
                     + ' retain the fixed 600-second phase caps and actual production configuration.\n\n')
    document = replace_span(document, '### Warnings observed in the latest production build',
                            '### Final physics and retained UI scope', warning_text)
    document = replace_once(document, '### Final physics and retained UI scope', '### Retained physics and UI scope')
    document = replace_once(document, 'The final selected test receipt retains ',
                            'The retained selected test receipt from `844725` retains ')
    document = replace_once(document, 'The final test run keeps the recorded ',
                            'The retained selected test run keeps the recorded ')
    document = replace_once(document, 'The final physical checks and retained component/HUD successes keep their narrower scopes.',
                            'The retained physical checks and component/HUD successes keep their narrower scopes.')
    document = replace_once(document, 'Both new RH3 driving receipts supply ',
                            'Both RH3 driving receipts recorded at `844725` supply ')
    document = replace_once(document, 'Both final receipts match the freshly checked physics/runner fingerprint ',
                            'Both retained receipts match the rechecked 157-file physics/runner fingerprint ')
    publication = (f'Historical component/reference baseline: `93576d20a3b52cc5e28959910b4b408418f53d3b`. Captured car and attempted full-session graph: `{CAPTURE_FP}` on parent `c4f674e86de7d9a0e80812bdbf7ac885f2a71a53`. Accepted physics/integration gate: `{OLD_BASE}` / `{OLD_FP}`. Final integrated parent: `{FINAL_BASE}`; final production fingerprint: `{FINAL_FP}` across 789 files. The '
                   + link('current publication audit', 'verification/publication-audit.json') + ' and '
                   + link('preserved pre-GP audit', 'verification/pre-gp/publication-audit.json')
                   + ' retain those distinct scopes. The Git commit containing this document identifies publication. Existing Saltmarsh geometry and earlier front/wheel work remain the foundation, not newly attributed features.\n\n')
    document = replace_span(document, '<!-- ROOT_PUBLICATION_START -->\n\n', '<!-- ROOT_PUBLICATION_END -->',
                            '<!-- ROOT_PUBLICATION_START -->\n\n' + publication)
    require(document.split('## What changed', 1)[1].split('## Verification and publication', 1)[0] ==
            old_document.decode().split('## What changed', 1)[1].split('## Verification and publication', 1)[0],
            'implementation/reference prose changed')

    ledger = json.loads(originals['reference-audit.json'])
    scope = ledger['implementation_mapping_scope']
    require(scope['integrated_base'] == OLD_BASE and scope['production_source_fingerprint'] == OLD_FP,
            'prior reference-audit integration identity differs')
    scope.update({'integrated_base': FINAL_BASE, 'production_source_fingerprint': FINAL_FP,
                  'retained_physics_gate_base': OLD_BASE, 'retained_physics_gate_production_fingerprint': OLD_FP,
                  'retained_physics_input_fingerprint': PHYSICS_FP, 'post_gp_unchanged_festival_files': 81,
                  'post_gp_unchanged_physics_files': 156, 'post_gp_unchanged_physics_files_including_runner': 157,
                  'state': 'Implemented with successful latest combined-application TypeScript, 27-file lint and production build. The earlier seven-phase integration/physical gate, 63 Festival regressions, 26 selected assertions, component/HUD receipts and failed full-world attempt retain their original scopes.',
                  'component_scope_note': 'Car and failed-session reports retain their captured full-source identity; verge/HUD retain module and fixture hashes. All 81 Festival files, 156 core/simulation/lockfile inputs, and the physical runner remain unchanged through the last MotoGP integration. No final-source full-world browser pass is claimed.'})
    ledger['status'] = 'All 100 compressed references remain hash-verified and contact-sheet reviewed; nine individually inspected. Latest build/source identity is separated from retained physics, component captures and the failed full-world attempt.'

    for name in ['post-gp-validation.json', 'post-gp-integration.json', 'post-gp-source-identity.json',
                 'post-gp-lint-files.json', 'post-gp-checks.py', 'post-gp-build.mjs',
                 'post-gp-sparse-initial-validation.json', 'post-gp-sparse-initial-typescript.log'] + [s['log'] for s in gate['steps']]:
        plan(VERIFY / name, raw(INPUT / name), immutable=True)
    restored = {'integratedBase': FINAL_BASE, 'productionFingerprint': FINAL_FP,
                'allRestoredBytesMatchTrackedParent': True, 'outsideProductionSourceManifest': True,
                'implementationModifiedToFixImports': False, 'files': restored_hashes,
                'failureReceipt': 'post-gp-sparse-initial-validation.json',
                'failureLog': 'post-gp-sparse-initial-typescript.log'}
    plan(VERIFY / 'post-gp-restored-fixtures.json', encoded(restored), immutable=True)
    plan(VERIFY / 'finalize-post-gp.py', raw(Path(__file__)), immutable=True)
    plan(VERIFY / 'BUILD_IDENTITY.json', raw(INPUT / 'post-gp-dist/BUILD_IDENTITY.json'))
    published_identity = dict(identity, finalVerifiedAt=timestamp, allFilesUnchanged=True, exactFileSetVerified=True)
    plan(VERIFY / 'source-identity.json', encoded(published_identity))
    plan(EVIDENCE / 'reference-audit.json', encoded(ledger))
    plan(DOCUMENT, (document.rstrip() + '\n').encode())
    audit = {'verifiedAt': timestamp, 'integratedBase': FINAL_BASE, 'productionFingerprint': FINAL_FP,
             'productionFileCount': 789, 'exactCurrentFileSetAndBytesVerified': True,
             'builtOutputIdentityMatches': True, 'builtOutputIdentity': built,
             'finalCommandPhasesPassed': NEW_PHASES, 'latestLintFiles': 27,
             'retainedGate': {'integratedBase': OLD_BASE, 'productionFingerprint': OLD_FP, 'productionFileCount': 785,
                              'phasesPassed': OLD_PHASES, 'receipt': 'validation.json',
                              'sourceIdentity': 'pre-gp/source-identity.json', 'publicationAudit': 'pre-gp/publication-audit.json'},
             'festivalFilesUnchanged': 81, 'physicalInputFileSetAndBytesUnchanged': True, 'physicalFilesCompared': 156, 'physicalFilesIncludingRunner': 157,
             'retainedPhysicsFingerprint': PHYSICS_FP, 'retainedFestivalTestsPassed': 63,
             'retainedIntegrationAssertionsPassed': 26,
             'retainedIntegrationPendingOrSkippedAsReported': old_audit['finalIntegrationPendingOrSkippedAsReported'],
             'retainedPhysicalTimesSeconds': old_audit['finalPhysicalTimesSeconds'],
             'recordedSimulationVersion': old_audit['recordedSimulationVersion'],
             'finalBuildWarningBlocks': warnings, 'finalBuildLargeJavascriptChunks': chunks,
             'componentSourceHashesStillMatch': True, 'retainedCarAndSessionFingerprint': CAPTURE_FP,
             'fullWorldBrowserPassed': False, 'nativeDrivingStepsPassed': 0, 'fullWorldCapturesPassed': 0,
             'historicalFailureAndCleanupReceiptsUnmodified': True, 'postGpSparseFailurePreserved': True,
             'restoredFixturesMatchTrackedParent': True, 'rootMarkersRetained': True}
    # Include retained and newly prepared receipts; do not include this audit in its own hash map.
    artifacts = {p: raw(p) for p in EVIDENCE.rglob('*') if p.is_file() and p != VERIFY / 'publication-audit.json'}
    artifacts.update({p: data for p, data in writes.items() if p.is_relative_to(EVIDENCE)})
    audit['publishedArtifactSha256'] = {p.relative_to(EVIDENCE).as_posix(): sha(data)
                                       for p, data in sorted(artifacts.items())}
    plan(VERIFY / 'publication-audit.json', encoded(audit))
    verify_source(identity)
    for path, data in writes.items():
        write_atomic(path, data)
    print(json.dumps({'finalized': True, 'productionFingerprint': FINAL_FP, 'sourceFiles': 789,
                      'latestPhasesPassed': 3, 'retainedPhysicsFilesIncludingRunner': 157, 'publishedFiles': len(writes)}, indent=2))


if __name__ == '__main__':
    main()
