#!/usr/bin/env python3
"""Check retained bytes and lossless compression only; no test or browser."""
import gzip
import hashlib
import json
from pathlib import Path
root = Path(__file__).resolve().parent
provenance = json.loads((root / 'packaging-provenance.json').read_text())
checked = 0
for row in provenance['files']:
    if row['mode'] == 'omitted':
        continue
    kept = (root / row['retainedPath']).read_bytes()
    assert len(kept) == row['retainedBytes']
    assert hashlib.sha256(kept).hexdigest() == row['retainedSha256']
    recovered = gzip.decompress(kept) if row['mode'] == 'gzip-lossless' else kept
    assert len(recovered) == row['originalBytes']
    assert hashlib.sha256(recovered).hexdigest() == row['originalSha256']
    checked += 1
manifest = (root / 'original-SHA256SUMS').read_bytes()
assert hashlib.sha256(manifest).hexdigest() == provenance['originalManifestSha256']
log = gzip.decompress((root / 'high-job-complete.log.gz').read_bytes())
assert len(log) == 68781
assert hashlib.sha256(log).hexdigest() == '35506673462793a26e3f013c3f01602748bc32c3b7adc78542c0537888305ee5'
print(json.dumps({'retainedOriginalFilesVerified': checked,
    'losslessJsonFilesVerified': sum(r['mode'] == 'gzip-lossless' for r in provenance['files']),
    'exactDecodedLogVerified': True, 'originalManifestIdentityVerified': True,
    'scope': 'Saved-file verification only; no browser, simulation, test, or network request.'}, indent=2))
