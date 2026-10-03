"""Temporary exact-artifact continuation. A successful seal never advances main."""
import base64
import hashlib
import json
import lzma
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tarfile
import urllib.request

BASE = '1b82c5a4424b6f503649d0516a4217608c0d54c3'
PREVIOUS = 'b2a7feceecee439358f4e0166bd9869e4c1a1a42'
ARCHIVE = '59b454d5aec6f8529e11f8b5e16725b8a34c05f6e6a7704053c145384a84798e'
DELTA = '2ff142d2de48180f595c67aeab4c588b9e087f1cc8b00977cb1094bec60f38fb'
STAGE = ['.github/infrastructure-stage.py', '.github/workflows/track-infrastructure-candidate.yml', '.github/infrastructure-resume.xz'] + [f'.github/infrastructure-candidate.{i:02d}.xzpart' for i in range(10)]
OVERRIDES = {'e2e/56-track-infrastructure.spec.ts', 'scripts/infrastructure-render-budget.ts', 'tests/infrastructure-render-budget.test.ts', 'docs/TRACK_INFRASTRUCTURE_RENDER_BASELINE.json', 'docs/TRACK_INFRASTRUCTURE_REVIEW.md'}
TEMP = Path(os.environ['RUNNER_TEMP'])

def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def safe(path):
    p = PurePosixPath(path)
    assert not p.is_absolute() and '..' not in p.parts and not Path(path).is_symlink(), path
    return path

def api(route, body=None):
    request = urllib.request.Request('https://api.github.com/repos/' + os.environ['GITHUB_REPOSITORY'] + route,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)

def prepare():
    # Restore the successful authoring output, not a fresh CPU-dependent export.
    archive = TEMP / 'source/infrastructure-source.tar.gz'
    assert sha(archive) == ARCHIVE
    old = json.loads((TEMP / 'source/infrastructure-source.json').read_text())
    assert old['base'] == BASE and old['stagingCommit'] == PREVIOUS and old['sourceArchiveSHA256'] == ARCHIVE
    assert len(old['files']) == 63
    subprocess.run(['git', 'merge-base', '--is-ancestor', PREVIOUS, 'HEAD'], check=True)
    assert set(git('diff', '--name-only', BASE, 'HEAD').splitlines()) == set(STAGE), 'Concurrent source changes require reconciliation'
    packet = Path('.github/infrastructure-resume.xz').read_bytes()
    assert hashlib.sha256(packet).hexdigest() == DELTA
    overrides = json.loads(lzma.decompress(packet))['files']
    assert set(overrides) == OVERRIDES
    jobs = api('/actions/runs/37149330552/jobs?per_page=100')['jobs']
    required = {111279712309, 111281373674, 111281373676, 111281373687}
    passing = {j['id'] for j in jobs if j['status'] == 'completed' and j['conclusion'] == 'success'}
    assert required <= passing, 'Original authoring and identical-runtime journeys must pass'
    with tarfile.open(archive) as tf:
        tf.extractall('.', filter='data')
    for path, digest in old['files'].items():
        assert sha(safe(path)) == digest, path
    for path, content in overrides.items():
        safe(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(content)
    # Only these observer/test/doc files may differ from the old candidate.
    for path, digest in old['files'].items():
        if path not in OVERRIDES:
            assert sha(path) == digest, path
    paths = sorted(set(old['files']) | OVERRIDES)
    assert len(paths) == 67
    assert sha('package-lock.json') == 'd85b97d2e51497b62414087966db13b740b174fe4b96663d29447644948d2969'
    subprocess.run(['git', 'add', '--', *paths], check=True)
    subprocess.run(['git', 'rm', '--', *STAGE], check=True)
    assert set(git('diff', '--cached', '--name-only', BASE).splitlines()) == set(paths)
    tree = git('write-tree')
    target = TEMP / 'infrastructure-reviewed-source.tar.gz'
    with target.open('wb') as output:
        subprocess.run(['git', 'archive', '--format=tar.gz', tree], stdout=output, check=True)
    receipt = {'base': BASE, 'stagingCommit': os.environ['GITHUB_SHA'], 'tree': tree,
        'sourceArchiveSHA256': sha(target), 'originalArchiveSHA256': ARCHIVE,
        'originalEvidenceRun': 37149330552, 'identicalRuntimeJourneyJobs': sorted(required - {111279712309}),
        'deltaSHA256': DELTA, 'removedTransport': STAGE,
        'files': {p: sha(p) for p in paths}}
    (TEMP / 'infrastructure-reviewed-source.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('Sealed 67 final source paths. All original candidate runtime/assets are byte-identical; observer accounting is corrected. Fresh check and six surveys remain required.')

def restore():
    folder = TEMP / 'reviewed'
    receipt = json.loads((folder / 'infrastructure-reviewed-source.json').read_text())
    assert receipt['stagingCommit'] == os.environ['GITHUB_SHA'] and receipt['base'] == BASE
    assert sha(folder / 'infrastructure-reviewed-source.tar.gz') == receipt['sourceArchiveSHA256']
    with tarfile.open(folder / 'infrastructure-reviewed-source.tar.gz') as tf:
        tf.extractall('.', filter='data')
    for path, digest in receipt['files'].items():
        assert sha(safe(path)) == digest, path
    for path in STAGE:
        Path(path).unlink(missing_ok=True)
    print('Restored sealed corrected source without temporary transport.')

def seal():
    receipt = json.loads((TEMP / 'reviewed/infrastructure-reviewed-source.json').read_text())
    assert receipt['stagingCommit'] == os.environ['GITHUB_SHA']
    assert api('/git/ref/heads/main')['object']['sha'] == os.environ['GITHUB_SHA'], 'main advanced; no overwrite'
    restore()
    entries = []
    for path, digest in receipt['files'].items():
        assert sha(path) == digest, path
        blob = api('/git/blobs', {'content': base64.b64encode(Path(path).read_bytes()).decode(), 'encoding': 'base64'})
        entries.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
    entries.extend({'path': p, 'mode': '100644', 'type': 'blob', 'sha': None} for p in STAGE)
    parent = api('/git/commits/' + os.environ['GITHUB_SHA'])
    tree = api('/git/trees', {'base_tree': parent['tree']['sha'], 'tree': entries})
    assert tree['sha'] == receipt['tree'], 'Publication tree differs from tested archive'
    commit = api('/git/commits', {'message': 'feat(venue): integrate authored A01-A07 track infrastructure\n\nRetain the current cars, people, venue and physical boundaries. Integrate seven Blender asset families, closed recovery gates, LODs and recorded start lights. Preserve exact native sources and geometry validation. Correct multi-pass survey accounting with strict direct-scene and matched full-frame budgets. Final art, hardware and aborted-start race control remain separate.', 'tree': tree['sha'], 'parents': [os.environ['GITHUB_SHA']]})
    receipt.update(candidateCommit=commit['sha'], validationRun=os.environ['GITHUB_RUN_ID'], branchAdvanced=False)
    (TEMP / 'publication.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('Passing immutable candidate:', commit['sha'], '; main remains unchanged for final review.')

if __name__ == '__main__':
    {'prepare': prepare, 'restore': restore, 'seal': seal}[sys.argv[1]]()
