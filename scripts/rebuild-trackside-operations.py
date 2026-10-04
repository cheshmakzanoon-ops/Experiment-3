"""Re-export only A08-A10 with the pinned toolchain into an explicit directory.

Usage: python scripts/rebuild-trackside-operations.py --blender /path/to/blender \
         --output-root /tmp/aurel-operations
This never rewrites supplied player, driver, cockpit, rival, pit or crowd assets.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

ASSETS = ('track-signal-hardware', 'track-boards', 'broadcast-cameras')

ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--blender', required=True, type=Path)
    parser.add_argument('--output-root', required=True, type=Path)
    args = parser.parse_args()
    blender = args.blender.resolve(strict=True)
    version = subprocess.check_output([str(blender), '--version'], text=True).splitlines()[0]
    if version != 'Blender 5.2.2 LTS':
        parser.error(f'Expected Blender 5.2.2 LTS; observed {version!r}')
    destination = args.output_root.resolve()
    if destination == ROOT or ROOT in destination.parents and not str(destination.relative_to(ROOT)).startswith('tmp/'):
        parser.error('Export to an external directory or tmp/, not over repository assets')
    for directory in ['scripts', 'public/models', 'src/rendering', 'logs']:
        (destination / directory).mkdir(parents=True, exist_ok=True)
    receipts = []
    for name in ASSETS:
        author = Path(f'scripts/author-{name}.py')
        shutil.copy2(ROOT / author, destination / author)
        command = [str(blender), '-b', '--factory-startup', '-t', '2', '--python-exit-code', '1',
                   '--python', str(destination / author)]
        for suffix, extra in [('author', []), ('roundtrip', ['--', '--check-source'])]:
            with (destination / f'logs/{name}-{suffix}.log').open('w') as log:
                subprocess.run(command + extra, stdout=log, stderr=subprocess.STDOUT, check=True)
        manifest_path = destination / f'src/rendering/{name}.manifest.json'
        manifest = json.loads(manifest_path.read_text())
        if (manifest['sourceSHA256'] != digest(ROOT / author)
                or manifest['sha256'] != digest(destination / 'public' / manifest['url'])
                or manifest['bytes'] != (destination / 'public' / manifest['url']).stat().st_size
                or manifest['authoredIn'] != '5.2.2 LTS'
                or manifest['finalArtApproved'] is not False):
            raise ValueError(f'Invalid generated receipt for {name}')
        receipts.append({
            'assetId': manifest['assetId'], 'authorSHA256': manifest['sourceSHA256'],
            'glbSHA256': manifest['sha256'], 'bytes': manifest['bytes'],
            'triangles': manifest['triangles'], 'editableRoundtrip': True,
        })
        print(f"{manifest['assetId']}: exported and reopened {manifest['bytes']} bytes", flush=True)
    (destination / 'authoring-receipt.json').write_text(json.dumps({
        'toolchain': version,
        'toolchainArchiveSHA256': '84098912789dc450e95697c4184fb8a90acbe5111c2ba4aede3fecb57806a168',
        'assets': receipts, 'finalArtApproved': False,
    }, indent=2) + '\n')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f'Infrastructure authoring failed: {error}', file=sys.stderr)
        sys.exit(1)
