#!/usr/bin/env python3
"""Losslessly compact an already frozen local High package. No network or tests."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

EXPECTED_MANIFEST = 'f76333afd975f7124ef50ce37cc013809a783c14533b38d08bd29b91911841b9'
OMIT = {
    'high-d784d94.zip': 'Full 107 MB GitHub artifact; original retained externally.',
    'high/trace.zip': 'Full 54 MB Playwright trace; original retained externally.',
    'high-job-complete.log': 'Exact decoded bytes retained losslessly in high-job-complete.log.gz.',
    'job-log-response.json': 'Original transport wrapper omitted; decoded complete log and run/job metadata retained.',
}

README = '''# Compact isolated High evidence — d784d94

This is a repository-ready, lossless copy of the targeted records from the
already frozen `ci-high-isolated-d784d94` package. It performs no new diagnosis,
browser run, test, download, source modification, or validation of a correction.
The original frozen package remains unchanged.

## Identity and result

- [Workflow 44559369205](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44559369205).
- [High job 135684104524](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44559369205/job/135684104524).
- Server commit: `d784d94c9ee1d4c0d50d0e0f7f59b91639a218a6`.
- Git tree: `b0eb64883e62199a789ba351385718ec80e07a89`.
- Diagnostic branch: `ci/high-late-startup-20261119`.
- Recorded conclusion: **failure**. The 90,000 ms state predicate expected
  `paused` and received `loading`; no accepted High frame-completion result.

`original-README.md` is the full, byte-identical original interpretation and its
limitations. Its artifact-path references describe the full original directory,
not this compact layout. `original-SHA256SUMS` is the byte-identical full-package
manifest; its SHA-256 is
`f76333afd975f7124ef50ce37cc013809a783c14533b38d08bd29b91911841b9`.

## Retained evidence

Every original file other than the four explicitly omitted files below is
retained. Small files remain byte-identical. The three large JSON bodies are
gzip-compressed without parsing, projection, truncation, or field removal:

- `high/high-gp-last-diagnostic.json.gz`
- `high/high-gp-startup-commands.json.gz`
- `high/test-detail.json.gz`

Their complete decompressed bytes were checked against their original hashes.
All native analyses, late-program identities, slow-upload stacks, source findings
and source hashes, inline diagnostics, backend/progress facts, attachment/report
metadata, published identity, run/job snapshots, artifact/download receipts,
the original extraction helper, and the exact native console gzip remain.
`high/native-console-records.jsonl.gz` is the original unmodified compressed file.

The original complete job log gzip also remains byte-identical. Its decompressed
bytes were checked against the full plaintext log: **68,781 bytes**, SHA-256
`35506673462793a26e3f013c3f01602748bc32c3b7adc78542c0537888305ee5`.

The source's late-program and upload-stack capture bounds are unchanged by this
packaging. In particular, the marshal fragment was already truncated in the
original capture, and the later upload calls already lacked new stack records
after the bounded allowance was exhausted. Lossless packaging does not recover
information that the original instrumentation did not retain. No underlying
GPU-cause or successful corrective-test claim is added here.

## Omitted files and provenance

| Original file | Bytes | SHA-256 |
| --- | ---: | --- |
| `high-d784d94.zip` | 107,392,120 | `ac132ac4890f1fc728af150468f5473e2bb73a63a6555bf3dc5d3db116bc1d4d` |
| `high/trace.zip` | 54,558,637 | `81e7597be3f9e6868edada8ab3b221ddb63da0c55ea2d14f37db3f2ffa91985f` |
| `high-job-complete.log` | 68,781 | `35506673462793a26e3f013c3f01602748bc32c3b7adc78542c0537888305ee5` |
| `job-log-response.json` | 72,043 | `06d88f7bc7a4847fc943ebe10534d0465fcfca0ee8aba2d1e7910535aabecc91` |

`packaging-provenance.json` maps every original file to its retained form or
explicit omission, with original and retained hashes/sizes. It records checks
of the entire original manifest before and after copying. The two ZIPs remain
in the full frozen external package; the decoded log is recoverable from the
retained gzip. The response-wrapper bytes themselves are not reconstructible
from this compact copy.

The original report-extraction helper is preserved as evidence. Re-extracting
the complete HTML report or arbitrary omitted trace entries with it still
requires the full original ZIP. The compact copy does not claim to reproduce
unselected trace content or unseen program/resource identities.

## Local verification and packaging replay

The following checks only saved files; it runs no application code or browser:

```bash
cd /path/to/ci-high-isolated-d784d94-evidence
sha256sum -c SHA256SUMS
python -B verify_evidence.py
gzip -dc high/high-gp-startup-commands.json.gz
```

To repeat the exact selection/compression from the still-frozen original into a
new directory:

```bash
python -B package_evidence.py \\
  --original /path/to/ci-high-isolated-d784d94 \\
  --out /path/to/new-high-evidence
```

The packager refuses an existing output and requires the exact original manifest.
`verification.json` records successful compact-file verification. `SHA256SUMS`
covers all compact files except itself. This directory is now frozen as evidence.
'''

VERIFIER = '''#!/usr/bin/env python3
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
'''


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--original', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    assert not args.out.exists(), 'Refusing to overwrite output'
    manifest = (args.original / 'SHA256SUMS').read_bytes()
    assert digest(manifest) == EXPECTED_MANIFEST
    expected = {}
    for line in manifest.decode().splitlines():
        file_hash, name = line.split('  ', 1)
        expected[name] = file_hash
    actual_names = {str(p.relative_to(args.original)) for p in args.original.rglob('*')
                    if p.is_file() and p.name != 'SHA256SUMS'}
    assert actual_names == set(expected), 'Original file inventory changed'
    before = {}
    for name, file_hash in expected.items():
        data = (args.original / name).read_bytes()
        assert digest(data) == file_hash, name
        before[name] = {'bytes': len(data), 'sha256': file_hash}
    assert gzip.decompress((args.original / 'high-job-complete.log.gz').read_bytes()) == (
        args.original / 'high-job-complete.log').read_bytes()
    args.out.mkdir(parents=True)
    output_rows = []
    for name in sorted(expected):
        row = {'originalPath': name, 'originalBytes': before[name]['bytes'],
               'originalSha256': before[name]['sha256']}
        if name in OMIT:
            row.update({'mode': 'omitted', 'reason': OMIT[name]})
        else:
            data = (args.original / name).read_bytes()
            target = 'original-README.md' if name == 'README.md' else name
            compress = name.endswith('.json') and len(data) > 50000
            payload = gzip.compress(data, mtime=0) if compress else data
            if compress:
                target += '.gz'
            dest = args.out / target
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(payload)
            recovered = gzip.decompress(dest.read_bytes()) if compress else dest.read_bytes()
            assert recovered == data and digest(recovered) == expected[name], name
            row.update({'mode': 'gzip-lossless' if compress else 'byte-identical',
                        'retainedPath': target, 'retainedBytes': len(payload),
                        'retainedSha256': digest(payload)})
        output_rows.append(row)
    assert (args.original / 'SHA256SUMS').read_bytes() == manifest
    for name, file_hash in expected.items():
        assert digest((args.original / name).read_bytes()) == file_hash, name
    (args.out / 'original-SHA256SUMS').write_bytes(manifest)
    (args.out / 'README.md').write_text(README)
    (args.out / 'verify_evidence.py').write_text(VERIFIER)
    (args.out / 'package_evidence.py').write_bytes(Path(__file__).read_bytes())
    provenance = {'originalDirectoryName': args.original.name,
        'originalManifestSha256': EXPECTED_MANIFEST,
        'originalFileCountIncludingManifest': len(expected) + 1,
        'originalTotalBytesIncludingManifest': sum(x['bytes'] for x in before.values()) + len(manifest),
        'originalAllHashesPassedBeforeAndAfter': True,
        'retainedBytesRecoveredExactly': True,
        'exactDecodedLogMatchesOriginalPlaintext': True,
        'scope': 'Packaging only; original files unchanged. No source edits, downloads, tests, or browser runs.',
        'files': output_rows}
    (args.out / 'packaging-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    import subprocess, sys
    check = subprocess.run([sys.executable, '-B', str(args.out / 'verify_evidence.py')],
                           capture_output=True, text=True)
    assert check.returncode == 0, check.stderr
    (args.out / 'verification.json').write_text(check.stdout)
    all_files = sorted(p for p in args.out.rglob('*') if p.is_file())
    final_manifest = ''.join(digest(p.read_bytes()) + '  ' + str(p.relative_to(args.out)) + '\n'
                             for p in all_files)
    (args.out / 'SHA256SUMS').write_text(final_manifest)
    total = sum(p.stat().st_size for p in args.out.rglob('*') if p.is_file())
    assert total < 2000000
    print(json.dumps({'path': str(args.out), 'files': len(all_files) + 1, 'bytes': total,
        'sha256SumsSha256': digest(final_manifest.encode()),
        'originalManifestUnchanged': EXPECTED_MANIFEST,
        'retainedOriginalFiles': sum(r['mode'] != 'omitted' for r in output_rows),
        'losslessCompressedJsonFiles': sum(r['mode'] == 'gzip-lossless' for r in output_rows),
        'omittedFiles': sorted(OMIT), 'verification': json.loads(check.stdout)}, indent=2))


if __name__ == '__main__':
    main()
