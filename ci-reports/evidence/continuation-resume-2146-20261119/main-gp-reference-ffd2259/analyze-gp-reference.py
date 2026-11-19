"""Audit the original main GP-reference failure without running a renderer.

The decoded image bytes, native metrics and original Playwright report remain
unaltered. This program only measures their differences; it sets no tolerance
and makes no assertion about the cause of a fresh-context pixel difference.
"""

from pathlib import Path
import gzip
import hashlib
import json

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
SOURCE = 'ffd22598335dfa2a074ebd466e1d53830bb8bb41'


def gl_hash(image):
    # Canvas PNG rows run top-to-bottom; the fixture's readPixels rows run
    # bottom-to-top. Preserve its exact FNV-1a arithmetic and all RGBA bytes.
    value = 2166136261
    for byte in image[::-1].tobytes():
        value = ((value ^ byte) * 16777619) & 0xffffffff
    return value


def main():
    attachments = ROOT / 'attachments'
    report = json.loads(gzip.decompress((ROOT / 'report-115f7b67105cc547e99c.json.gz').read_bytes()))
    case = report['tests'][0]
    result = case['results'][0]
    first = json.loads((attachments / '0-metrics.json').read_text())
    later = json.loads((attachments / '5-metrics.json').read_text())
    sequence = json.loads((attachments / 'same-instance-weather-metrics.json').read_text())
    original = np.asarray(Image.open(attachments / '0-gpr1-high-dry.png').convert('RGBA'))
    repeated = np.asarray(Image.open(attachments / '5-gpr1-high-dry.png').convert('RGBA'))
    assert original.shape == repeated.shape == (800, 1280, 4)
    assert gl_hash(original) == first['hash']
    assert gl_hash(repeated) == later['hash']
    difference = np.abs(original.astype(np.int16) - repeated.astype(np.int16))
    changed = np.any(difference, axis=2)
    ys, xs = np.where(changed)
    pixel_changes = [
        {'x': int(x), 'y': int(y), 'firstRGBA': original[y, x].tolist(), 'laterRGBA': repeated[y, x].tolist()}
        for y, x in zip(ys, xs)
    ]
    metric_difference = {k: [first.get(k), later.get(k)] for k in first if first.get(k) != later.get(k)}
    assert set(metric_difference) == {'instance', 'hash'}
    assert result['status'] == 'failed' and result['retry'] == 0
    assert sequence[0]['hash'] == sequence[3]['hash']
    assert sequence[1]['hash'] == sequence[2]['hash']
    assert sequence[0]['hash'] != sequence[1]['hash']
    summary = {
        'source': SOURCE,
        'runId': 44617126580,
        'jobId': 135890460489,
        'artifact': json.loads((ROOT / 'artifact-receipt.json').read_text()),
        'caseId': case['testId'],
        'title': case['title'],
        'result': result['status'],
        'retry': result['retry'],
        'originalErrors': result['errors'],
        'freshConstruction': {
            'firstHash': first['hash'],
            'laterHash': later['hash'],
            'pixelCount': int(changed.size),
            'changedPixels': int(changed.sum()),
            'changedComponents': int(np.count_nonzero(difference)),
            'maxComponentDifference': int(difference.max()),
            'pixelChanges': pixel_changes,
            'differentReportedMetrics': metric_difference,
            'pngReconstructsExactNativeHash': True,
        },
        'sameInstanceWeatherHashes': [sample['hash'] for sample in sequence],
        'interpretation': 'The final fresh-construction exact hash assertion fails. Earlier same-instance wet/held/dry checks pass. The cause of the four fresh-context pixel differences is not established. No tolerance, renderer source or assertion was changed.',
    }
    (ROOT / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({k: v for k, v in summary.items() if k not in {'originalErrors', 'artifact'}}))


if __name__ == '__main__':
    main()
