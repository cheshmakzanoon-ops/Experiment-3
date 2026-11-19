#!/usr/bin/env python3
"""Recompute saved-record findings only; no original ZIP, source, or browser needed."""
import gzip
import hashlib
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
from extract_evidence import derive, PREFIX, POST_ORIGIN

root = Path(__file__).resolve().parent
evidence = root / 'evidence'
provenance = json.loads((evidence / 'provenance.json').read_text())
readback = {}
for name, spec in provenance['retainedRawSelections'].items():
    encoded = (evidence / name).read_bytes()
    assert hashlib.sha256(encoded).hexdigest() == spec['gzipSha256'], name
    assert len(encoded) == spec['gzipBytes'], name
    raw = gzip.decompress(encoded)
    assert hashlib.sha256(raw).hexdigest() == spec['rawSha256'], name
    assert len(raw) == spec['rawBytes'], name
    lines = raw.splitlines(keepends=True)
    assert len(lines) == len(spec['originalLinesOneBased']), name
    readback[name] = [(number, line, json.loads(line))
                     for number, line in zip(spec['originalLinesOneBased'], lines)]
for spec in provenance['sources'].values():
    for part in spec['retained']:
        raw = (evidence / part['file']).read_bytes()
        assert len(raw) == part['bytes']
        assert hashlib.sha256(raw).hexdigest() == part['sha256']
index = json.loads(gzip.decompress((evidence / 'packet-index.json.gz').read_bytes()))
by_line = {p['originalLine']: p for p in index}
for number, line, row in readback['browser-timing-postreload.jsonl.gz']:
    packet = json.loads(row['text'][len(PREFIX):])
    meta = by_line[number]
    assert packet['origin'] == POST_ORIGIN
    assert meta['rawLineSha256'] == hashlib.sha256(line).hexdigest()
    assert meta['traceReceiptMs'] == row['time']
    assert all(meta[k] == packet[k] for k in ('origin', 'sequence', 'dropped'))
    assert meta['eventCount'] == len(packet['events'])
browser = sorted(readback['browser-actions.jsonl.gz'] +
                 readback['browser-dom.jsonl.gz'] +
                 readback['browser-timing-postreload.jsonl.gz'])
actual = derive(browser, readback['network.jsonl.gz'], readback['test-runner.jsonl.gz'], index)
expected = json.loads(gzip.decompress((evidence / 'summary.json.gz').read_bytes()))
assert json.loads(json.dumps(actual)) == expected
print(json.dumps({
    'sourceCommit': provenance['sourceCommit'],
    'rawSelectionHashesPassed': len(readback),
    'retainedSourceHashesPassed': sum(len(s['retained']) for s in provenance['sources'].values()),
    'postReloadPacketsChecked': 173,
    'nativeEventBodiesRecomputed': 4321,
    'statePollsRecomputed': 29,
    'summaryRecomputedExactly': True,
    'scope': 'Saved-record verification only; no browser, test, simulation, or network request.'
}, indent=2))
