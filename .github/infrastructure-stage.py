"""Temporary, checksum-guarded A01-A07 integration; no branch mutation."""
import base64
import hashlib
import json
import lzma
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import urllib.request

BASE = '1b82c5a4424b6f503649d0516a4217608c0d54c3'
PACK = 'ed543092cbbd1f74d735f991fabfaf57b67b8606efadf4853846c8340f0cb5b1'
SLUGS = ['concrete-barriers', 'steel-guardrails', 'catch-fence', 'impact-barriers', 'recovery-gates', 'marshal-posts', 'start-gantry']
STAGE = ['.github/infrastructure-stage.py', '.github/workflows/track-infrastructure-candidate.yml'] + [f'.github/infrastructure-candidate.{i:02d}.xzpart' for i in range(10)]
TEMP = Path(os.environ['RUNNER_TEMP'])

def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def payload():
    data = b''.join(Path(f'.github/infrastructure-candidate.{i:02d}.xzpart').read_bytes() for i in range(10))
    assert hashlib.sha256(data).hexdigest() == PACK, 'Candidate transport checksum mismatch'
    result = json.loads(lzma.decompress(data))
    assert result['base'] == BASE
    for name in result['paths']:
        p = PurePosixPath(name)
        assert not p.is_absolute() and '..' not in p.parts and p.parts[0] in ['src', 'scripts', 'tests', 'e2e', 'docs', '3dmodels.md', 'README.md'], name
        assert not Path(name).is_symlink(), name
    assert len(result['paths']) == 49 and len(set(result['paths'])) == 49
    return result

def prepare():
    p = payload()
    subprocess.run(['git', 'merge-base', '--is-ancestor', BASE, 'HEAD'], check=True)
    changed = git('diff', '--name-only', BASE, 'HEAD').splitlines()
    assert set(changed) == set(STAGE), ('Concurrent changes require reconciliation', changed)
    patch = TEMP / 'infrastructure.patch'
    patch.write_text(p['patch'])
    subprocess.run(['git', 'apply', '--check', str(patch)], check=True)
    subprocess.run(['git', 'apply', str(patch)], check=True)
    for name, text in p['files'].items():
        assert name in p['paths'] and not Path(name).exists(), name
        Path(name).parent.mkdir(parents=True, exist_ok=True)
        Path(name).write_text(text)
    allowed = set(p['paths'])
    assert set(git('diff', '--name-only').splitlines()) <= allowed
    assert sha('package-lock.json') == 'd85b97d2e51497b62414087966db13b740b174fe4b96663d29447644948d2969'
    (TEMP / 'infrastructure-paths.json').write_text(json.dumps(p['paths']))
    print('Restored 49 bounded source files; physical simulation, track definitions, supplied assets and permanent gates remain unchanged.')

def collect():
    generated = TEMP / 'infrastructure-export'
    paths = json.loads((TEMP / 'infrastructure-paths.json').read_text())
    comparison = []
    for name in SLUGS:
        manifest_path = Path(f'src/rendering/{name}.manifest.json')
        expected = json.loads(manifest_path.read_text())
        actual = json.loads((generated / manifest_path).read_text())
        # Different CPU hosts need not produce byte-identical glTF vertex deduplication.
        # Never pass off a regenerated file as the local file: retain both identities,
        # require every construction field exactly, then rerun all geometry/render tests.
        identity = {'bytes', 'sha256'}
        assert {k: v for k, v in actual.items() if k not in identity} == {k: v for k, v in expected.items() if k not in identity}, ('Authored construction changed', name)
        comparison.append({'assetId': actual['assetId'], 'local': {k: expected[k] for k in sorted(identity)},
                           'hosted': {k: actual[k] for k in sorted(identity)}, 'constructionManifestEqual': True})
        shutil.copy2(generated / manifest_path, manifest_path)
        for path in [f'public/models/aurel-{name}.glb', f'scripts/aurel-{name}.blend']:
            shutil.copy2(generated / path, path)
            paths.append(path)
        assert sha('public/' + actual['url']) == actual['sha256'], name
        assert Path('public/' + actual['url']).stat().st_size == actual['bytes'], name
    local = json.loads(Path('docs/TRACK_INFRASTRUCTURE_AUTHORING.json').read_text())
    hosted = json.loads((generated / 'authoring-receipt.json').read_text())
    assert {k:v for k,v in local.items() if k != 'assets'} == {k:v for k,v in hosted.items() if k != 'assets'}
    for a, b in zip(local['assets'], hosted['assets'], strict=True):
        assert {k:v for k,v in a.items() if k not in ['glbSHA256', 'bytes']} == {k:v for k,v in b.items() if k not in ['glbSHA256', 'bytes']}
    shutil.copy2(generated / 'authoring-receipt.json', 'docs/TRACK_INFRASTRUCTURE_AUTHORING.json')
    provenance = Path('docs/TRACK_INFRASTRUCTURE_PROVENANCE.json')
    record = json.loads(provenance.read_text())
    record['crossHostReexport'] = {'initialByteEqualityGate': 'failed in run 37148700907; not visual approval',
                                  'constructionComparison': comparison,
                                  'acceptance': 'New hosted bytes require independent geometry comparison and complete candidate checks before publication.'}
    provenance.write_text(json.dumps(record, indent=2) + '\n')
    doc = Path('docs/TRACK_INFRASTRUCTURE_ASSET_PACK.md')
    doc.write_text(doc.read_text() + '\n## Cross-host export identity\n\nThe first hosted export stopped on byte inequality against local Blender output.\nAll construction-manifest fields (source, triangle counts, draws, materials, bounds,\nsockets and LODs) are required to remain exact. Local and hosted byte identities\nare separately retained in the provenance record. Hosted files are new candidates: \nall loader, geometry and production-browser checks rerun against their own exact\nretained hashes. Byte-identical export across CPU hosts is not claimed.\n')
    (TEMP / 'infrastructure-paths.json').write_text(json.dumps(paths))
    print('Retained exact hosted bytes and original local identities; all source/construction fields match. Geometry and browser acceptance remain mandatory.')

def archive():
    paths = json.loads((TEMP / 'infrastructure-paths.json').read_text())
    subprocess.run(['git', 'add', '--', *paths], check=True)
    subprocess.run(['git', 'rm', '--', *STAGE], check=True)
    tree = git('write-tree')
    changes = set(git('diff', '--cached', '--name-only', BASE).splitlines())
    assert changes == set(paths), ('Unexpected source mutation', changes ^ set(paths))
    with (TEMP / 'infrastructure-source.tar.gz').open('wb') as output:
        subprocess.run(['git', 'archive', '--format=tar.gz', tree], stdout=output, check=True)
    receipt = {'base': BASE, 'stagingCommit': os.environ['GITHUB_SHA'], 'tree': tree, 'payloadSHA256': PACK,
               'sourceArchiveSHA256': sha(TEMP / 'infrastructure-source.tar.gz'),
               'files': {p: sha(p) for p in paths}, 'removedTransport': STAGE}
    (TEMP / 'infrastructure-source.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('Sealed exact tested source tree', tree)

def api(route, body=None):
    headers = {'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
    request = urllib.request.Request('https://api.github.com/repos/' + os.environ['GITHUB_REPOSITORY'] + route,
                                     data=None if body is None else json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)

def seal():
    receipt = json.loads((TEMP / 'source/infrastructure-source.json').read_text())
    assert receipt['stagingCommit'] == os.environ['GITHUB_SHA'] and receipt['base'] == BASE
    assert sha(TEMP / 'source/infrastructure-source.tar.gz') == receipt['sourceArchiveSHA256']
    assert api('/git/ref/heads/main')['object']['sha'] == os.environ['GITHUB_SHA'], 'main advanced; reconcile without overwriting'
    entries = []
    for path, digest in receipt['files'].items():
        assert sha(path) == digest, path
        encoded = base64.b64encode(Path(path).read_bytes()).decode()
        blob = api('/git/blobs', {'content': encoded, 'encoding': 'base64'})
        entries.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
    entries.extend({'path': path, 'mode': '100644', 'type': 'blob', 'sha': None} for path in STAGE)
    parent = api('/git/commits/' + os.environ['GITHUB_SHA'])
    tree = api('/git/trees', {'base_tree': parent['tree']['sha'], 'tree': entries})
    assert tree['sha'] == receipt['tree'], ('Published tree must equal tested source', tree['sha'], receipt['tree'])
    commit = api('/git/commits', {'message': 'feat(venue): integrate authored A01-A07 track infrastructure\n\nRetain the supplied player, rivals, crew, venue and physical boundaries. Integrate seven checksum-gated Blender kits with bounded LODs, closed recovery routes, original lamp apertures and deterministic snapshot presentation. Preserve native sources and production-renderer evidence. Final art, aborted-start race control and hardware approval remain separate.', 'tree': tree['sha'], 'parents': [os.environ['GITHUB_SHA']]})
    receipt['candidateCommit'] = commit['sha']
    receipt['validationRun'] = os.environ['GITHUB_RUN_ID']
    receipt['branchAdvanced'] = False
    (TEMP / 'publication.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('Unreferenced passing candidate:', commit['sha'], '; main deliberately unchanged pending image review.')

if __name__ == '__main__':
    {'prepare': prepare, 'collect': collect, 'archive': archive, 'seal': seal}[sys.argv[1]]()
