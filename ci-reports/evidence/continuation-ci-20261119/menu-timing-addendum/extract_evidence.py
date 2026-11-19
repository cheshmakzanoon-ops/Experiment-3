#!/usr/bin/env python3
"""Read an already downloaded Playwright trace; never run a browser or test.

Python 3 standard library + read-only git show/rev-parse. Output must not exist.
All retained JSONL records are byte-exact original lines, compressed losslessly.
"""
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

COMMIT = 'd8d87c73a8f3e921e865acdc02c61e84b8c877a7'
TREE = '51077ee3c9103d7faf139b622aa806bf8652d1f6'
ZIP_SHA = '0c34a460c3b08af3df75d2b8e35c9334574a4d804ea0b502d29f46acc65ff1d2'
ZIP_BYTES = 32854438
PREFIX = '__APEX_MENU_TIMING__'
POST_ORIGIN = 1795101643928
ENTRY_SHA = {
    '0-trace.trace': 'b2a1a39febedd890fda63540a52b497e1b9d5c79b848ec766a155ed149e4b04c',
    '0-trace.network': '2f734d2718942b856cc514f87317a8e2e938e257f232d780e8240def4c481106',
    'test.trace': '6b06b3c00fff998dac55fcd17ca8dfb014c2dea4927c5f4bcb28fc91030dbfa3',
}
SNAPSHOTS = {
    'after@call@2622', 'before@call@2650', 'after@call@2652',
    'before@call@2664', 'before@call@2670',
}
SOURCE_RANGES = {
    'e2e/30-menu-access.spec.ts': None,
    'e2e/menu-timing-evidence.ts': None,
    'src/rendering/gpu-frame-gate.ts': None,
    'src/rendering/renderer.ts': [(957, 988), (1084, 1125)],
    'src/rendering/pit-material-warmup.ts': [(108, 143)],
    'src/ui/loading-copy.ts': [(67, 85)],
}
TRACE_SOURCE = {
    'e2e/30-menu-access.spec.ts': 'resources/src@9e5851f4b9d5a468cbd5eac1e7c1bab3209b2fa2.txt',
    'e2e/menu-timing-evidence.ts': 'resources/src@499a5f23d2b4590da1198acf34f8134ffe345432.txt',
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()
    path.write_bytes(gzip.compress(data, mtime=0) if path.suffix == '.gz' else data)


def records(data):
    return [(i, line, json.loads(line))
            for i, line in enumerate(data.splitlines(keepends=True), 1)]


def pw_value(value):
    # Only used for the small human-readable summary; original serialization stays.
    if value.get('v') == 'null':
        return None
    if 'o' in value:
        return {item['k']: pw_value(item['v']) for item in value['o']}
    if 'a' in value:
        return [pw_value(item) for item in value['a']]
    for key in ('s', 'n', 'b', 'v'):
        if key in value:
            return value[key]
    return value


def literal_nodes(value, wanted):
    found = {}
    if isinstance(value, list):
        if len(value) >= 2 and isinstance(value[1], dict):
            node_id = value[1].get('id')
            if node_id in wanted:
                found[node_id] = value
        for item in value:
            found.update(literal_nodes(item, wanted))
    elif isinstance(value, dict):
        for item in value.values():
            found.update(literal_nodes(item, wanted))
    return found


def derive(browser, network, test_rows, packet_index):
    rows = [r for _, _, r in browser]
    calls = defaultdict(dict)
    for row in rows:
        if row.get('type') in ('before', 'after'):
            calls[row['callId']][row['type']] = row
    polls = []
    for call_id, pair in calls.items():
        before = pair.get('before', {})
        if before.get('params', {}).get('expression') != '() => window.apexDiagnostics().state':
            continue
        after = pair['after']
        polls.append({
            'callId': call_id, 'startTraceMs': before['startTime'],
            'endTraceMs': after['endTime'],
            'durationMs': after['endTime'] - before['startTime'],
            'result': pw_value(after['result']['value']),
            'error': after.get('error'),
        })
    assert len(polls) == 29 and all(p['result'] == 'loading' and p['error'] is None for p in polls)
    setup = []
    for n in range(2592, 2624, 2):
        pair = calls[f'call@{n}']; b, a = pair['before'], pair['after']
        item = {'callId': b['callId'], 'method': b['method'],
                'startTraceMs': b['startTime'], 'endTraceMs': a['endTime'],
                'params': b['params'], 'error': a.get('error')}
        if n != 2598:
            item['result'] = a.get('result')
        setup.append(item)
    renderer = pw_value(calls['call@2598']['after']['result']['value'])
    click_start = calls['call@2622']['before']['startTime']
    snapshots = []
    for row in rows:
        if row.get('type') != 'frame-snapshot':
            continue
        s = row['snapshot']
        snapshots.append({
            'snapshotName': s['snapshotName'], 'traceTimestampMs': s['timestamp'],
            'secondsSinceClickStart': (s['timestamp'] - click_start) / 1000,
            'literalNodes': literal_nodes(s['html'], {
                'loadingStage', 'loadingPercent', 'loadingText', 'loadingSession'}),
        })
    cockpit = next(s for s in snapshots if s['snapshotName'] == 'before@call@2670')
    assert cockpit['literalNodes']['loadingText'][2] == 'Waiting for completed cockpit GPU work…'
    assert cockpit['literalNodes']['loadingPercent'][2] == '94%'
    native = []
    for row in rows:
        if row.get('type') == 'console':
            packet = json.loads(row['text'][len(PREFIX):])
            assert packet['origin'] == POST_ORIGIN
            native.extend(packet['events'])
    assert len(native) == 4321
    post_index = [p for p in packet_index if p['origin'] == POST_ORIGIN]
    assert [p['sequence'] for p in post_index] == list(range(1, 174))
    assert all(p['dropped'] == 0 for p in post_index)
    fence_starts = {}
    creations = {}
    wait_starts = {}
    waits = defaultdict(list)
    deletes = defaultdict(list)
    for event in native:
        kind = event['kind']; context = event.get('context')
        if kind == 'fence-start':
            assert context not in fence_starts
            fence_starts[context] = event
        elif kind == 'fence-end':
            creations[(context, event['fence'])] = {
                'start': fence_starts.pop(context), 'end': event}
        elif kind == 'wait-start':
            key = (context, event['fence']); assert key not in wait_starts
            wait_starts[key] = event
        elif kind == 'wait-end':
            key = (context, event['fence'])
            waits[key].append({'start': wait_starts.pop(key), 'end': event})
        elif kind == 'fence-delete':
            deletes[(context, event['fence'])].append(event)
    assert not fence_starts and not wait_starts
    selected_fences = {}
    for fence in (10, 11, 12, 13):
        key = (1, fence); pairs = waits[key]
        item = dict(creations[key])
        item.update({'completedWaitCount': len(pairs),
                     'resultCounts': dict(Counter(p['end']['result'] for p in pairs)),
                     'firstWait': pairs[0] if pairs else None,
                     'lastWait': pairs[-1] if pairs else None,
                     'deletions': deletes[key]})
        if fence == 13:
            item['allCompletedWaits'] = pairs
            item['creationEndToLastTimeoutMs'] = pairs[-1]['end']['at'] - item['end']['at']
            item['firstToLastWaitResultMs'] = pairs[-1]['end']['at'] - pairs[0]['end']['at']
            assert len(pairs) == 11 and all(p['end']['result'] == 37147 for p in pairs)
            assert all(p['start']['flags'] == 0 and p['start']['timeout'] == 0 for p in pairs)
            assert not deletes[key]
        selected_fences[str(fence)] = item
    raf_starts = {e['id'] for e in native if e['kind'] == 'app-raf-start'}
    raf_ends = {e['id'] for e in native if e['kind'] == 'app-raf-end'}
    assert raf_starts == raf_ends
    ns = [r['snapshot'] for _, _, r in network]
    assert len(ns) == 144
    epochs = {}
    for p in packet_index:
        group = epochs.setdefault(str(p['origin']), {
            'packets': 0, 'emittedEvents': 0, 'maximumReportedDropped': 0, 'sequences': []})
        group['packets'] += 1; group['emittedEvents'] += p['eventCount']
        group['maximumReportedDropped'] = max(group['maximumReportedDropped'], p['dropped'])
        group['sequences'].append(p['sequence'])
    errors = [r for _, _, r in test_rows if r.get('type') == 'error']
    assert len(errors) == 1 and 'Timeout 60000ms' in errors[0]['message']
    return {
        'units': {'nativeEventAtAndDuration': 'milliseconds within performance.timeOrigin epoch',
                  'origin': 'performance.timeOrigin, epoch milliseconds',
                  'traceCallTimesAndSnapshotTimestamp': 'trace monotonic milliseconds',
                  'consoleTime': 'trace receipt time; not native event time'},
        'documentEpochs': epochs, 'setupCalls': setup,
        'initialShowroom': {k: renderer[k] for k in ('presentationPurpose', 'construction', 'gpuFrameQueue')},
        'statePolls': polls, 'loadingSnapshotObservations': snapshots,
        'postReload': {
            'origin': POST_ORIGIN, 'eventCounts': dict(Counter(e['kind'] for e in native)),
            'contextsAndVisibility': [e for e in native if e['kind'] in ('context', 'context-lost', 'visibility')],
            'fencesOnWorldContext1': selected_fences,
            'longTasksAtLeast5000Ms': [e for e in native if e['kind'] == 'long-task' and e['duration'] >= 5000],
            'lastTimer': [e for e in native if e['kind'] == 'timer'][-1],
            'recordedRafStarts': len(raf_starts), 'recordedRafEnds': len(raf_ends),
            'unmatchedRafIds': sorted(raf_starts ^ raf_ends),
        },
        'network': {
            'snapshots': len(ns), 'statusCounts': dict(Counter(s['response']['status'] for s in ns)),
            'recordedFailureText': [s for s in ns if s.get('_failureText') or s['response'].get('_failureText')],
            'requestStartRangeTraceMs': [min(s['_monotonicTime'] for s in ns), max(s['_monotonicTime'] for s in ns)],
            'compiledBundleContentRecords': [
                {'url': s['request']['url'], 'content': s['response']['content']}
                for s in ns if '/assets/index-CbShg41_.js' in s['request']['url']],
        },
        'failure': errors[0],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--trace', type=Path, required=True)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    assert not args.out.exists(), 'Refusing to overwrite an existing evidence directory'
    original = args.trace.read_bytes()
    assert len(original) == ZIP_BYTES and sha(original) == ZIP_SHA, 'Wrong original ZIP'
    def git(*words):
        return subprocess.check_output(['git', '-C', str(args.repo), *words])
    assert git('rev-parse', COMMIT + '^{tree}').decode().strip() == TREE
    with zipfile.ZipFile(args.trace) as archive:
        raw = {name: archive.read(name) for name in ENTRY_SHA}
        for name, data in raw.items():
            assert sha(data) == ENTRY_SHA[name], name
        browser = records(raw['0-trace.trace'])
        network = records(raw['0-trace.network'])
        test_rows = records(raw['test.trace'])
        packets = []
        post_rows = []
        for line_no, line, row in browser:
            if row.get('type') != 'console':
                continue
            assert row['messageType'] == 'debug' and row['text'].startswith(PREFIX)
            packet = json.loads(row['text'][len(PREFIX):])
            # Header/count projection only; initial-document event bodies are omitted.
            packets.append({'originalLine': line_no, 'rawLineSha256': sha(line),
                            'traceReceiptMs': row['time'], 'origin': packet['origin'],
                            'sequence': packet['sequence'], 'dropped': packet['dropped'],
                            'eventCount': len(packet['events'])})
            if packet['origin'] == POST_ORIGIN:
                post_rows.append((line_no, line, row))
        assert len(packets) == 239 and len(post_rows) == 173
        selected = {
            'browser-actions.jsonl.gz': [r for r in browser if r[2]['type'] in (
                'context-options', 'before', 'after', 'log', 'event')],
            'browser-dom.jsonl.gz': [r for r in browser if r[2]['type'] == 'frame-snapshot'
                and r[2]['snapshot']['snapshotName'] in SNAPSHOTS],
            'browser-timing-postreload.jsonl.gz': post_rows,
            'network.jsonl.gz': network,
            'test-runner.jsonl.gz': test_rows,
        }
        assert len(selected['browser-dom.jsonl.gz']) == 5
        args.out.mkdir(parents=True)
        receipt = {
            'sourceCommit': COMMIT, 'sourceTree': TREE,
            'originalZip': {'sha256': ZIP_SHA, 'bytes': len(original),
                'entryCount': len(archive.infolist()),
                'uncompressedBytes': sum(i.file_size for i in archive.infolist())},
            'originalEntries': {n: {'bytes': len(b), 'sha256': sha(b), 'lines': len(records(b))}
                                for n, b in raw.items()},
            'originalBrowserTypeCounts': dict(Counter(r[2]['type'] for r in browser)),
            'retainedRawSelections': {}, 'sources': {},
            'checks': {'originalZipAndEntryHashesMatched': True,
                'pinnedSourceTreeMatched': True,
                'everyRetainedRawLineByteEqualToOriginal': True,
                'allPostReloadConsoleRecordsRetainedWithoutEventProjection': True,
                'allPacketHeaderCountFieldsCheckedAgainstOriginal': True,
                'traceEmbeddedTestAndFixtureByteEqualToPinnedGitSource': True},
            'omissions': [
                'Initial-document native event bodies; all 239 packet headers/counts remain.',
                '93 unselected DOM snapshots and all 162 screencast-frame records.',
                'ZIP resource bodies/screenshots/assets and 0-trace.stacks.',
                'Full renderer/pit-material/loading-copy source outside the stated exact ranges.',
                'Compiled bundle body was absent from the original recorded network content.',
            ],
        }
        for name, chosen in selected.items():
            payload = b''.join(line for _, line, _ in chosen)
            encoded = gzip.compress(payload, mtime=0)
            (args.out / name).write_bytes(encoded)
            restored = gzip.decompress((args.out / name).read_bytes())
            assert restored == payload
            original_lines = (raw['0-trace.network'] if name == 'network.jsonl.gz'
                              else raw['test.trace'] if name == 'test-runner.jsonl.gz'
                              else raw['0-trace.trace']).splitlines(keepends=True)
            assert restored.splitlines(keepends=True) == [original_lines[n - 1] for n, _, _ in chosen]
            receipt['retainedRawSelections'][name] = {
                'originalEntry': '0-trace.network' if name == 'network.jsonl.gz' else
                    'test.trace' if name == 'test-runner.jsonl.gz' else '0-trace.trace',
                'originalLinesOneBased': [n for n, _, _ in chosen],
                'rawBytes': len(payload), 'rawSha256': sha(payload),
                'gzipBytes': len(encoded), 'gzipSha256': sha(encoded),
            }
        index_bytes = (json.dumps(packets, separators=(',', ':')) + '\n').encode()
        (args.out / 'packet-index.json.gz').write_bytes(gzip.compress(index_bytes, mtime=0))
        restored_index = json.loads(gzip.decompress((args.out / 'packet-index.json.gz').read_bytes()))
        assert restored_index == packets
        for p in restored_index:
            _, line, row = browser[p['originalLine'] - 1]
            raw_packet = json.loads(row['text'][len(PREFIX):])
            assert p['rawLineSha256'] == sha(line) and p['traceReceiptMs'] == row['time']
            assert all(p[k] == raw_packet[k] for k in ('origin', 'sequence', 'dropped'))
            assert p['eventCount'] == len(raw_packet['events'])
        for path, ranges in SOURCE_RANGES.items():
            source = git('show', COMMIT + ':' + path)
            meta = {'fullBytes': len(source), 'fullSha256': sha(source),
                    'gitBlob': git('rev-parse', COMMIT + ':' + path).decode().strip(),
                    'retained': []}
            if path in TRACE_SOURCE:
                entry = TRACE_SOURCE[path]
                embedded = archive.read(entry)
                assert embedded == source
                meta['traceEmbeddedSource'] = {'entry': entry, 'bytes': len(embedded), 'sha256': sha(embedded)}
            spans = [(1, len(source.splitlines()))] if ranges is None else ranges
            for first, last in spans:
                name = path if ranges is None else path + f'.lines-{first}-{last}.txt'
                dest = args.out / 'sources' / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                part = source if ranges is None else b''.join(source.splitlines(keepends=True)[first - 1:last])
                dest.write_bytes(part)
                assert dest.read_bytes() == b''.join(source.splitlines(keepends=True)[first - 1:last])
                meta['retained'].append({'file': 'sources/' + name, 'firstLine': first,
                    'lastLine': last, 'bytes': len(part), 'sha256': sha(part)})
            receipt['sources'][path] = meta
        # Recompute substantive findings from the exact retained records, not memory.
        retained_browser = sorted(selected['browser-actions.jsonl.gz'] +
                                  selected['browser-dom.jsonl.gz'] + post_rows)
        summary = derive(retained_browser, network, test_rows, restored_index)
        write_json(args.out / 'summary.json.gz', summary)
        write_json(args.out / 'provenance.json', receipt)
        print(json.dumps({'output': str(args.out), 'sourceCommit': COMMIT,
            'postReloadPackets': len(post_rows), 'postReloadEvents': 4321,
            'completedLoadingPolls': len(summary['statePolls']),
            'fence13CompletedTimeouts': summary['postReload']['fencesOnWorldContext1']['13']['completedWaitCount'],
            'allByteAndScopeChecksPassed': True}, indent=2))


if __name__ == '__main__':
    main()
