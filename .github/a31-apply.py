"""Temporary, narrowly scoped A31 candidate recovery. Never writes another asset."""
import base64
import hashlib
import json
import lzma
import os
from pathlib import Path
import subprocess

raw = base64.b64decode(''.join(Path(f'.github/a31-candidate-{i}.b64').read_text().strip() for i in range(3)), validate=True)
assert hashlib.sha256(raw).hexdigest() == 'd58200ae56b6eb64ca5c571c02217951ac0e09c875d20f944295a3358b691f6a'
data = json.loads(lzma.decompress(raw))
allowed = {'scripts/author-wheel-gun.py', 'scripts/verify-wheel-gun.py', 'src/rendering/wheel-gun.ts', 'src/rendering/wheel-gun-contact.ts', 'src/rendering/wheel-gun.manifest.json', 'tests/wheel-gun.test.ts', 'e2e/a31-wheel-gun.spec.ts', 'e2e/fixtures/a31-wheel-gun.ts', 'docs/A31_WHEEL_GUN.md', '.github/workflows/wheel-gun-authoring.yml'}
assert set(data['files']) == allowed
for name, text in data['files'].items():
    p = Path(name)
    assert not p.exists(), f'A31 path already exists: {name}'
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)
patch = Path(os.environ['RUNNER_TEMP']) / 'a31-shared.patch'
patch.write_text(data['patch'])
subprocess.run(['git', 'apply', '--3way', '--index', '--include=src/rendering/pit-crew.ts', '--include=src/rendering/pit-presentation.ts', str(patch)], check=True)
# Reviewed against renderer d2c2684c after A34 landed. Insertions keep every
# existing load, render and resource hook, with exact unique-anchor assertions.
p = Path('src/rendering/renderer.ts')
s = p.read_text()
assert "from './wheel-gun.ts'" not in s
replacements = [
    ("import { loadPitWallStation } from './pit-wall-station.ts';", "import { loadWheelGuns, WheelGunStorage } from './wheel-gun.ts';\nimport { measureWheelGunFits } from './wheel-gun-contact.ts';\nimport { loadPitWallStation } from './pit-wall-station.ts';"),
    ('  private suppliedPlayerAsset: SuppliedPlayerAsset | null = null;', '  private suppliedPlayerAsset: SuppliedPlayerAsset | null = null;\n  wheelGunStorage: WheelGunStorage | null = null;'),
    ('      renderer.circuit.pitWallStation = await loadPitWallStation(cancelled);', "      renderer.circuit.pitWallStation = await loadPitWallStation(cancelled);\n      progress({ completed: 0, total: 1, fraction: 0, label: 'Loading A31 authored wheel guns' });\n      renderer.pitCrew.installWheelGuns(await loadWheelGuns(cancelled));\n      renderer.textures.register(renderer.pitCrew.root);\n      renderer.wheelGunStorage = new WheelGunStorage(\n        renderer.pitCrew.wheelGuns!.prototype,\n        renderer.circuit.heroGarage.root,\n      );"),
    ('      this.cars.push(car);', '      this.cars.push(car);\n      this.pitCrew.setWheelGunFits(car.id, measureWheelGunFits(car));'),
    ('    this.circuit.heroGarage?.update(this.camera, this.quality, illumination);', '    this.circuit.heroGarage?.update(this.camera, this.quality, illumination);\n    this.wheelGunStorage?.update(this.camera);'),
]
for old, new in replacements:
    assert s.count(old) == 1, f'Changed renderer anchor: {old}'
    s = s.replace(old, new)
p.write_text(s)
subprocess.run(['git', 'add', '--', str(p)], check=True)
Path(os.environ['RUNNER_TEMP'], 'a31-owned.json').write_text(json.dumps(sorted(allowed | {'src/rendering/pit-crew.ts', 'src/rendering/pit-presentation.ts', 'src/rendering/renderer.ts', 'scripts/aurel-wheel-gun.blend', 'public/models/aurel-wheel-gun.glb'})))
