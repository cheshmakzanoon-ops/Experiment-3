"""Temporary bounded transport and evidence seal; never advances main."""
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

BASE = 'f952d587fa9a3ccfae562611371bb18cea2987a4'
PACK = '8b393e9400995c7242b06e0e5bd97cf21ca77aacb2d4dbfe063da6917d4cf67c'
N_PARTS = 7
ASSETS = ['track-signal-hardware','track-boards','broadcast-cameras']
STAGE = ['.github/operations-stage.py','.github/workflows/trackside-operations-candidate.yml'] + [f'.github/operations-candidate.{i:02d}.xzpart' for i in range(N_PARTS)]
TEMP = Path(os.environ['RUNNER_TEMP'])

def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def git(*args): return subprocess.check_output(['git', *args], text=True).strip()

def prepare():
    data=b''.join(Path(f'.github/operations-candidate.{i:02d}.xzpart').read_bytes() for i in range(N_PARTS))
    assert hashlib.sha256(data).hexdigest()==PACK, 'Transport checksum'
    p=json.loads(lzma.decompress(data))
    assert p['base']==BASE
    subprocess.run(['git','merge-base','--is-ancestor',BASE,'HEAD'],check=True)
    assert set(git('diff','--name-only',BASE,'HEAD').splitlines())==set(STAGE), 'Concurrent source changes require reconciliation'
    for path in p['paths']:
        v=PurePosixPath(path)
        assert not v.is_absolute() and '..' not in v.parts and v.parts[0] in ['src','scripts','tests','e2e','docs','3dmodels.md','README.md']
        assert not Path(path).is_symlink()
    patch=TEMP/'operations.patch';patch.write_text(p['patch'])
    subprocess.run(['git','apply','--check',str(patch)],check=True)
    subprocess.run(['git','apply',str(patch)],check=True)
    for name,text in p['files'].items():
        assert name in p['paths'] and not Path(name).exists(),name
        Path(name).parent.mkdir(parents=True,exist_ok=True);Path(name).write_text(text)
    for name,digest in p['hashes'].items(): assert sha(name)==digest,name
    assert set(git('diff','--name-only').splitlines()) <= set(p['paths'])
    (TEMP/'operations-paths.json').write_text(json.dumps(p['paths']))
    print('Restored bounded operations source; protected physics, supplied assets and permanent CI unchanged.')

def collect():
    generated=TEMP/'operations-export'
    paths=json.loads((TEMP/'operations-paths.json').read_text())
    comparisons=[]
    for name in ASSETS:
        mp=Path(f'src/rendering/{name}.manifest.json')
        local=json.loads(mp.read_text());hosted=json.loads((generated/mp).read_text())
        excluded=['bytes','sha256']
        assert {k:v for k,v in local.items() if k not in excluded}=={k:v for k,v in hosted.items() if k not in excluded}, ('Construction mismatch',name)
        comparisons.append({'assetId':local['assetId'],'local':{k:local[k] for k in excluded},'hosted':{k:hosted[k] for k in excluded},'constructionEqual':True})
        shutil.copy2(generated/mp,mp)
        for path in [f'public/models/aurel-{name}.glb',f'scripts/aurel-{name}.blend']:
            shutil.copy2(generated/path,path);paths.append(path)
        assert sha('public/'+hosted['url'])==hosted['sha256']
    shutil.copy2(generated/'authoring-receipt.json','docs/TRACKSIDE_OPERATIONS_AUTHORING.json')
    provenance=Path('docs/TRACKSIDE_OPERATIONS_PROVENANCE.json');p=json.loads(provenance.read_text())
    p['hostedExport']={'identities':comparisons,'acceptance':'Exact hosted bytes must pass geometry and actual production browser gates. Cross-host byte identity is not claimed.'}
    provenance.write_text(json.dumps(p,indent=2)+'\n')
    (TEMP/'operations-paths.json').write_text(json.dumps(paths))

def archive():
    paths=json.loads((TEMP/'operations-paths.json').read_text())
    subprocess.run(['git','add','--',*paths],check=True)
    subprocess.run(['git','rm','--',*STAGE],check=True)
    assert set(git('diff','--cached','--name-only',BASE).splitlines())==set(paths), 'Unexpected mutation'
    tree=git('write-tree')
    with (TEMP/'operations-source.tar.gz').open('wb') as out:
        subprocess.run(['git','archive','--format=tar.gz',tree],stdout=out,check=True)
    (TEMP/'operations-source.json').write_text(json.dumps({'base':BASE,'stagingCommit':os.environ['GITHUB_SHA'],'tree':tree,'archiveSHA256':sha(TEMP/'operations-source.tar.gz'),'files':{p:sha(p) for p in paths},'removedTransport':STAGE},indent=2)+'\n')
    print('Exact exported candidate tree:',tree)

def restore():
    folder=TEMP/'source';p=json.loads((folder/'operations-source.json').read_text())
    assert p['stagingCommit']==os.environ['GITHUB_SHA'] and sha(folder/'operations-source.tar.gz')==p['archiveSHA256']
    subprocess.run(['tar','-xzf',str(folder/'operations-source.tar.gz')],check=True)
    for name in STAGE: Path(name).unlink(missing_ok=True)
    for path,digest in p['files'].items(): assert sha(path)==digest,path

def api(route,body=None):
    request=urllib.request.Request('https://api.github.com/repos/'+os.environ['GITHUB_REPOSITORY']+route,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'})
    with urllib.request.urlopen(request,timeout=120) as r:return json.load(r)

def seal():
    folder=TEMP/'source';p=json.loads((folder/'operations-source.json').read_text())
    assert p['stagingCommit']==os.environ['GITHUB_SHA'] and sha(folder/'operations-source.tar.gz')==p['archiveSHA256']
    assert api('/git/ref/heads/main')['object']['sha']==os.environ['GITHUB_SHA'],'main advanced; reconcile'
    entries=[]
    for path,digest in p['files'].items():
        assert sha(path)==digest,path
        blob=api('/git/blobs',{'content':base64.b64encode(Path(path).read_bytes()).decode(),'encoding':'base64'})
        entries.append({'path':path,'type':'blob','mode':'100644','sha':blob['sha']})
    entries.extend({'path':path,'type':'blob','mode':'100644','sha':None} for path in STAGE)
    parent=api('/git/commits/'+os.environ['GITHUB_SHA'])
    tree=api('/git/trees',{'base_tree':parent['tree']['sha'],'tree':entries})
    assert tree['sha']==p['tree'],'Published source must equal tested tree'
    commit=api('/git/commits',{'message':'feat(venue): integrate A08-A10 trackside operations and local displays\n\nAdd three original Blender families, 18 approach boards plus two sector markers, passive split housings and 20 broadcast-camera installations. Preserve all current cars, people, physics and replay optics. Bind retained LED meshes to recorded local marshal witnesses with bounded palette ownership. Include native sources, provenance, geometry and production-render tests. Final art, hardware approval, mechanical camera tracking and Vellamar remain separate.','tree':tree['sha'],'parents':[os.environ['GITHUB_SHA']]})
    p.update(candidateCommit=commit['sha'],validationRun=os.environ['GITHUB_RUN_ID'],branchAdvanced=False)
    (TEMP/'operations-publication.json').write_text(json.dumps(p,indent=2)+'\n')
    print('Passing source commit, not yet on main:',commit['sha'])

if __name__=='__main__': {'prepare':prepare,'collect':collect,'archive':archive,'restore':restore,'seal':seal}[sys.argv[1]]()
