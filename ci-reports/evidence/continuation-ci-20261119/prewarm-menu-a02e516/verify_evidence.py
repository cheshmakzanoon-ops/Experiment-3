#!/usr/bin/env python3
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
