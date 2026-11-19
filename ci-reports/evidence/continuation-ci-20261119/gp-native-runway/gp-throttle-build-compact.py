"""Build a compact archival supplement without changing either frozen source."""
from pathlib import Path
import gzip
import hashlib
import json
import shutil
import struct
import sys

base=Path(sys.argv[1]).resolve()
full=base/'gp-throttle-mixed3303-package'
out=base/'gp-throttle-mixed3303-supplement'
out.mkdir(exist_ok=False)
sha=lambda data:hashlib.sha256(data).hexdigest()
full_manifest=full/'SHA256SUMS'
expected_manifest='ddd04a0b9dbcc9c3342d85d2c27b2d00ab64b89fa779bc43ef3312a06ab650c3'
assert sha(full_manifest.read_bytes())==expected_manifest
for line in full_manifest.read_text().splitlines():
    expected,name=line.split('  ',1)
    assert sha((full/name).read_bytes())==expected, name
copies=[]
renames={'README.md':'full-observer-report.md','SHA256SUMS':'original-package-SHA256SUMS',
         'copy-provenance.json':'original-copy-provenance.json'}
for source in sorted(full.iterdir()):
    if source.name=='trace.json.gz':continue
    target=out/renames.get(source.name,source.name)
    raw=source.read_bytes();target.write_bytes(raw)
    assert target.read_bytes()==raw
    copies.append({'original':str(source),'payload':target.name,'bytes':len(raw),'sha256':sha(raw),'byteExact':True})
for source,name in [
    (base/'gp-baseline-throttle-only-evidence/candidate-production.patch','candidate-production.patch'),
    (base/'gp-baseline-throttle-only-evidence/gp-steering-throttle-ownership.test.ts','gp-steering-throttle-ownership.test.ts'),
    (base/'gp-baseline-throttle-only-evidence/fixture-provenance.json','candidate-fixture-provenance.json'),
    (base/'gp-throttle-compact-verify.py','gp-throttle-compact-verify.py'),
    (Path(__file__).resolve(),'gp-throttle-build-compact.py'),
]:
    raw=source.read_bytes();(out/name).write_bytes(raw)
    assert (out/name).read_bytes()==raw
    copies.append({'original':str(source),'payload':name,'bytes':len(raw),'sha256':sha(raw),'byteExact':True})
compressed=(full/'trace.json.gz').read_bytes()
raw=gzip.decompress(compressed)
assert sha(raw)=='752d7c5d3797bdb091fc17c20edf2a3d2758756c0d2f643e5e660073c29976f2'
assert raw==(base/'gp-throttle-mixed3303-diagnostic/trace.json').read_bytes()
d=json.loads(raw)
samples=[]
for index,s in enumerate(d['samples']):
    if s['id'] not in (0,2,4) or s['completed']!=1 or s['finishTime']!=0:continue
    samples.append({'sourceSampleIndex':index,**{k:s[k] for k in ['tick','id','completed','finishTime']},
      'ai':{'final':{k:s['ai']['final'][k] for k in ['planRecovery','steeringCorrection']},
            'pedals':s['ai']['pedals'],'steeringThrottle':{'result':s['ai']['steeringThrottle']['result']}}})
projected={'schema':'lossless-consumed-field-projection-v1','originalTrace':{'sha256':sha(raw),'bytes':len(raw)},
 'scope':'Complete native timing records and complete original substep aggregates; exact consumed fields for sampled GP lap-2 phase/throttle statistics.',
 'trackLength':d['trackLength'],'timing':d['timing'],'aggregates':d['aggregates'],'analysisSamples':samples,
 'sourceRecordCounts':{'samples':len(d['samples']),'planning':len(d['planning']),'timing':len(d['timing']),'aggregates':len(d['aggregates'])}}
projection_raw=(json.dumps(projected,separators=(',',':'),allow_nan=False)+'\n').encode()
projection_gzip=gzip.compress(projection_raw,compresslevel=9,mtime=0)
(out/'compact-analysis-inputs.json.gz').write_bytes(projection_gzip)
assert gzip.decompress(projection_gzip)==projection_raw
restored=json.loads(gzip.decompress((out/'compact-analysis-inputs.json.gz').read_bytes()))
leaf_count=0
def exact_subset(original,projected):
    global leaf_count
    if isinstance(projected,dict):
        for k,v in projected.items():
            assert k in original
            exact_subset(original[k],v)
    elif isinstance(projected,list):
        assert len(original)==len(projected)
        for x,y in zip(original,projected):exact_subset(x,y)
    else:
        assert type(original) is type(projected)
        if isinstance(original,float):assert struct.pack('>d',original)==struct.pack('>d',projected)
        else:assert original==projected
        leaf_count+=1
for field in ['trackLength','timing','aggregates']:exact_subset(d[field],restored[field])
assert len(restored['analysisSamples'])==len(samples)==2750
for sample in restored['analysisSamples']:
    index=sample['sourceSampleIndex']
    exact_subset(d['samples'][index],{k:v for k,v in sample.items() if k!='sourceSampleIndex'})
verification={'schema':'projection-verification-v1','fullOriginalGzipSha256':sha(compressed),
 'fullOriginalRawSha256':sha(raw),'fullOriginalRawBytes':len(raw),
 'externalOriginalAndFrozenOriginalByteEqual':True,
 'projectionRawSha256':sha(projection_raw),'projectionRawBytes':len(projection_raw),
 'projectionGzipSha256':sha(projection_gzip),'projectionGzipBytes':len(projection_gzip),
 'gzipRestorationByteExact':True,'allConsumedProjectedLeavesEqualToFullOriginal':True,
 'strictLeafComparisons':leaf_count,'floatComparison':'IEEE-754 binary64 bytes; no rounding or resampling',
 'records':{'nativeTiming':len(restored['timing']),'completeSubstepAggregates':len(restored['aggregates']),
            'sampledGpLap2Records':len(restored['analysisSamples'])},
 'consumedSampleFields':['tick','id','completed','finishTime','ai.final.planRecovery','ai.final.steeringCorrection',
                         'ai.pedals (complete object)','ai.steeringThrottle.result'],
 'sourceSampleIndex':'Metadata added to map each projected sample to the full original sample array; not a game field.',
 'scriptSha256':sha(Path(__file__).read_bytes())}
(out/'projection-verification.json').write_text(json.dumps(verification,indent=2)+'\n')
omissions={'schema':'compact-supplement-provenance-v1','disposition':'Unresolved diagnostic; no accepted physics change',
 'frozenFullPackage':str(full),'frozenFullPackageManifestSha256':expected_manifest,
 'frozenFullPackageFiles':len(list(full.iterdir())),'frozenFullPackageBytes':sum(p.stat().st_size for p in full.iterdir()),
 'omittedPayload':{'name':'trace.json.gz','compressedBytes':len(compressed),'compressedSha256':sha(compressed),
                   'restoredBytes':len(raw),'restoredSha256':sha(raw)},
 'omittedCoverage':['Full 11,706-record race sample trace; only the 2,750 exact fields consumed for phase/throttle statistics are projected.',
 'Full 6,283-record planning trace; the recorded transition window and reported transition/event results are preserved separately.',
 'Unselected physical snapshots, neighbor samples and method invocation detail outside the retained proof/analysis inputs.',
 'Individual 240 Hz substep states were never stored in the full original trace. Complete original substep aggregates ARE retained here; table recomputation is not independent reintegration.'],
 'unmodifiedCopies':copies,
 'preservation':'All original receipts, hashes, 96 native profile inputs, replay programs/results, tables and recorded transition calls are retained. No simulation, production edit, native rerun or acceptance test is performed by this builder.'}
(out/'supplement-provenance.json').write_text(json.dumps(omissions,indent=2)+'\n')
print(json.dumps({'supplement':str(out),'filesSoFar':len(list(out.iterdir())),
 'bytesSoFar':sum(p.stat().st_size for p in out.iterdir()),'projectionGzipBytes':len(projection_gzip),
 'strictLeafComparisons':leaf_count,'allProjectedConsumedFieldsExact':True,
 'frozenOriginalManifestSha256':sha(full_manifest.read_bytes())}))
