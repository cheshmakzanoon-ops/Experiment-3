"""Restore losslessly compressed historical artifacts outside the Git checkout."""

from pathlib import Path
from hashlib import sha256
from shutil import copytree
import gzip
import json
import sys


source = Path(__file__).resolve().parent
if len(sys.argv) != 2:
    raise SystemExit('Usage: python restore-evidence.py /absolute/new-external-directory')
destination = Path(sys.argv[1]).resolve()
repository = next((path for path in source.parents if (path / '.git').exists()), None)
if destination.exists():
    raise SystemExit('Destination already exists; choose a fresh external directory.')
if repository and destination.is_relative_to(repository):
    raise SystemExit('Restore outside the Git checkout to keep archived code separate.')
if destination.is_relative_to(source):
    raise SystemExit('Destination cannot be inside the evidence archive.')

mapping = json.loads((source / 'compression-map.json').read_text())
copytree(source, destination)
for entry in mapping['entries']:
    stored = (destination / entry['storedRelativePath']).resolve()
    target = (destination / entry['originalRelativePath']).resolve()
    if not stored.is_relative_to(destination) or not target.is_relative_to(destination):
        raise SystemExit('Invalid relative path in compression map.')
    compressed = stored.read_bytes()
    if sha256(compressed).hexdigest() != entry['storedSha256']:
        raise SystemExit(f'Compressed hash mismatch: {stored}')
    payload = gzip.decompress(compressed)
    if len(payload) != entry['payloadBytes'] or sha256(payload).hexdigest() != entry['payloadSha256']:
        raise SystemExit(f'Payload hash mismatch: {stored}')
    with target.open('xb') as output:
        output.write(payload)

print(f"Restored {len(mapping['entries'])} historical payloads into {destination}")
