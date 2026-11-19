#!/usr/bin/env python3
"""Copy frozen candidate menu evidence without redundant transport/poll files."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys

EXPECTED = '3acab8de8ead4050ab1d1c51ac552df1f141d83187cfd04e57bafcb42ae7f96e'
OMITTED = {
    'build-job-complete.log': 'Complete decoded bytes retained in build-job-complete.log.gz.',
    'menu-job-complete.log': 'Complete decoded bytes retained in menu-job-complete.log.gz.',
    'build-job-log-response.json': 'Redundant log transport wrapper; exact decoded log retained.',
    'menu-job-log-response.json': 'Redundant log transport wrapper; exact decoded log retained.',
    'artifacts-initial.json': 'Superseded by terminal artifacts-final.json.',
    'artifacts-after-menu.json': 'Superseded by terminal artifacts-final.json.',
    'jobs-menu-final.json': 'Superseded by terminal jobs-final.json.',
    'menu-steps-01.json': 'Intermediate installation status; initial/final jobs retained.',
    'published-commit-identity.json': 'Normalized duplicate; full published-git-commit.json retained.',
    'analyze-menu-trace.py': 'Unused utility; successful artifact has no trace ZIP and no failure analysis ran.',
}

VERIFIER = '''#!/usr/bin/env python3
"""Verify saved bytes, source identities and recorded results; never run a browser."""
import gzip, hashlib, json, zipfile
from pathlib import Path
p=Path(__file__).resolve().parent
prov=json.loads((p/'packaging-provenance.json').read_text())
checked=0
for r in prov['files']:
    if r['mode']=='omitted': continue
    b=(p/r['path']).read_bytes()
    assert len(b)==r['bytes'] and hashlib.sha256(b).hexdigest()==r['sha256'],r['path']
    checked+=1
assert hashlib.sha256((p/'ORIGINAL-SHA256SUMS').read_bytes()).hexdigest()==prov['originalManifestSha256']
for name,size,expected in [
    ('build-job-complete.log.gz',26923,'035a9b4c9abc2725288d17847d4b5b093b7e492586ee1134dff90e43d9fda1a4'),
    ('menu-job-complete.log.gz',60671,'383506e81728b3f053504e8307a5b3996ef485d12f02f6ac5a3272307f62d439')]:
    b=gzip.decompress((p/name).read_bytes())
    assert len(b)==size and hashlib.sha256(b).hexdigest()==expected
identity=json.loads((p/'source-identity.json').read_text())
commit=json.loads((p/'published-git-commit.json').read_text())
run=json.loads((p/'run-final.json').read_text())
assert identity['serverCommit']==commit['sha']==run['head_sha']=='a02e516cf3a58b33e4f783ecb37baafeed0e6ba5'
assert identity['localTree']==commit['tree']['sha']=='a9c5d75554b2805b42eea1f393e01e616bbc5d9d'
source_count=0
for path,spec in identity['sourceFiles'].items():
    f=p/'source'/path
    if f.exists():
        b=f.read_bytes();assert len(b)==spec['bytes'] and hashlib.sha256(b).hexdigest()==spec['sha256'];source_count+=1
parity=json.loads((p/'menu-workload-parity.json').read_text())
assert all(r['byteIdentical'] and r['baselineSha256']==r['candidateSha256'] for r in parity['checks'])
tests=json.loads((p/'menu/tests-summary.json').read_text())
assert len(tests)==7 and all(r['status']=='passed' and r['retry']==0 and not r['errors'] for t in tests for r in t['results'])
stats=json.loads((p/'menu/report-metadata.json').read_text())['stats']
assert stats=={'total':7,'expected':7,'unexpected':0,'flaky':0,'skipped':0,'ok':True}
for r in json.loads((p/'menu/attachment-manifest.json').read_text()):
    b=(p/'menu'/r['file']).read_bytes();assert len(b)==r['retainedBytes'] and hashlib.sha256(b).hexdigest()==r['sha256']
    raw=gzip.decompress(b) if r['compression']=='gzip-lossless' else b
    assert len(raw)==r['originalBytes'] and hashlib.sha256(raw).hexdigest()==r['originalSha256']
artifact=(p/'menu-a02e516.zip').read_bytes()
assert len(artifact)==698245 and hashlib.sha256(artifact).hexdigest()=='ce4f93913e6ead116caff1c41771804af99f03e37754b8cc6100c45bd7fd4a45'
summary=json.loads((p/'menu-result-summary.json').read_text());shot=summary['pausedGridTest']['screenshot']
with zipfile.ZipFile(p/'menu-a02e516.zip') as z:
    assert not any(n.endswith('.zip') for n in z.namelist())
    assert (p/shot['file']).read_bytes()==z.read(shot['artifactPath'])
print(json.dumps({'retainedOriginalFilesVerified':checked,'sourceCopiesVerified':source_count,
    'completeDecodedLogGzipVerified':2,'recordedPassedCasesVerified':7,
    'wholeMenuArtifactAndScreenshotVerified':True,'sourceTreeAndCommitVerified':True,
    'attachmentBytesVerified':True,
    'scope':'Saved evidence verification only; no browser, tests, simulation, network, or source changes.'},indent=2))
'''


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--original',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    assert not args.out.exists(),'Refusing to overwrite output'
    manifest=(args.original/'SHA256SUMS').read_bytes();assert sha(manifest)==EXPECTED
    entries={}
    for line in manifest.decode().splitlines():
        digest,name=line.split('  ',1);entries[name]=digest
    actual={str(p.relative_to(args.original)) for p in args.original.rglob('*') if p.is_file() and p.name!='SHA256SUMS'}
    assert set(entries)==actual
    for name,digest in entries.items():assert sha((args.original/name).read_bytes())==digest,name
    args.out.mkdir(parents=True)
    records=[]
    for name,digest in sorted(entries.items()):
        b=(args.original/name).read_bytes()
        reason=OMITTED.get(name)
        if name.startswith('jobs-poll-'):
            reason='Intermediate polling snapshot; initial and terminal job records retained.'
        row={'path':name,'bytes':len(b),'sha256':digest,'mode':'omitted' if reason else 'byte-identical'}
        if reason:row['reason']=reason
        else:
            target=args.out/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b)
            assert target.read_bytes()==b
        records.append(row)
    for name,digest in entries.items():assert sha((args.original/name).read_bytes())==digest,name
    assert (args.original/'SHA256SUMS').read_bytes()==manifest
    (args.out/'ORIGINAL-SHA256SUMS').write_bytes(manifest)
    (args.out/'package_evidence.py').write_bytes(Path(__file__).read_bytes())
    (args.out/'verify_evidence.py').write_text(VERIFIER)
    provenance={'originalDirectoryName':args.original.name,'originalManifestSha256':EXPECTED,
        'originalAllHashesPassedBeforeAndAfter':True,'allRetainedFilesByteIdentical':True,
        'fullMenuArtifactRetained':True,'sourceCommit':'a02e516cf3a58b33e4f783ecb37baafeed0e6ba5',
        'files':records}
    (args.out/'packaging-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
    (args.out/'PACKAGING.md').write_text('''# Compact evidence verification

All retained files are byte-identical to the frozen full collection. The full
698,245-byte menu artifact remains. Complete decoded logs are retained as gzip;
redundant plaintext logs, transport wrappers, intermediate polls, a normalized
duplicate commit receipt, and the unused trace-analysis utility are omitted.
Every original file, retained or omitted, has its size/hash and disposition in
`packaging-provenance.json`. `ORIGINAL-SHA256SUMS` identifies the untouched full
collection; use the normal `SHA256SUMS` to verify this compact copy.

```bash
sha256sum -c SHA256SUMS
python -B verify_evidence.py
```

The verifier checks saved records only. To recreate the extraction from the
included full artifact, use `extract-menu-report.py` as shown in README.md. To
repeat compact packaging from the frozen full collection into a new directory:

```bash
python -B package_evidence.py --original /path/to/ci-prewarm-menu-a02e516 --out /path/to/new-compact-evidence
```

No browser, test, simulation, download, or source modification is performed by
either verification or packaging. The original full collection was checked before
and after copying and remains unchanged.
''')
    check=subprocess.run([sys.executable,'-B',str(args.out/'verify_evidence.py')],capture_output=True,text=True)
    assert check.returncode==0,check.stderr
    (args.out/'verification.json').write_text(check.stdout)
    files=sorted(p for p in args.out.rglob('*') if p.is_file())
    output_manifest=''.join(sha(p.read_bytes())+'  '+str(p.relative_to(args.out))+'\n' for p in files)
    (args.out/'SHA256SUMS').write_text(output_manifest)
    total=sum(p.stat().st_size for p in args.out.rglob('*') if p.is_file());assert total<2000000
    print(json.dumps({'path':str(args.out),'files':len(files)+1,'bytes':total,
        'manifestSha256':sha(output_manifest.encode()),'originalManifestUnchanged':EXPECTED,
        'retainedOriginalFiles':sum(r['mode']=='byte-identical' for r in records),
        'omittedRedundantFiles':sum(r['mode']=='omitted' for r in records),
        'verification':json.loads(check.stdout)},indent=2))


if __name__=='__main__':main()
