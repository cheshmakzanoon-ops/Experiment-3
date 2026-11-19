#!/usr/bin/env python3
"""Extract recorded menu-job report evidence from an existing artifact ZIP."""
import base64
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import zipfile

archive = Path(sys.argv[1])
output = Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
summary = []
manifest = []


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def keep(path, body, source, compress=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = gzip.compress(body, mtime=0) if compress else body
    path.write_bytes(payload)
    recovered = gzip.decompress(path.read_bytes()) if compress else path.read_bytes()
    assert recovered == body
    manifest.append({'file': str(path.relative_to(output)), 'originalBytes': len(body),
                     'originalSha256': hashlib.sha256(body).hexdigest(),
                     'retainedBytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest(),
                     'compression': 'gzip-lossless' if compress else None, 'source': source})


with zipfile.ZipFile(archive) as outer:
    names = set(outer.namelist())
    html = outer.read('playwright-report/index.html').decode('utf-8')
    match = re.search(r'<script[^>]+id="playwrightReportBase64"[^>]*>(.*?)</script>', html, re.S)
    if not match:
        raise RuntimeError('Embedded Playwright report was not found')
    payload = match.group(1).strip().split('base64,', 1)[-1]
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(payload))) as inner:
        keep(output / 'report-metadata.json', inner.read('report.json'), 'embedded report.json')
        for name in inner.namelist():
            if not name.endswith('.json') or name == 'report.json':
                continue
            raw = inner.read(name)
            data = json.loads(raw)
            tests = data.get('tests', []) if isinstance(data, dict) else []
            if not tests:
                continue
            keep(output / 'report-files' / (Path(name).name + '.gz'), raw,
                 'embedded Playwright report ' + name, compress=True)
            for test in tests:
                case_number = len(summary) + 1
                case = output / 'cases' / f'{case_number:02d}'
                details = {k: test.get(k) for k in (
                    'testId', 'title', 'path', 'location', 'projectName', 'outcome', 'duration')}
                details['caseDirectory'] = str(case.relative_to(output))
                details['results'] = []
                for attempt, result in enumerate(test.get('results', [])):
                    entry = {k: result.get(k) for k in ('status', 'duration', 'retry', 'startTime', 'errors')}
                    entry['attachments'] = []
                    for attachment_number, attachment in enumerate(result.get('attachments', [])):
                        info = {k: attachment.get(k) for k in ('name', 'contentType', 'path')}
                        safe_name = re.sub(r'[^A-Za-z0-9._-]+', '-', str(attachment.get('name', 'attachment')))
                        prefix = f'attempt-{attempt:02d}-attachment-{attachment_number:02d}-'
                        if attachment.get('contentType') == 'application/json' and 'body' in attachment:
                            body = attachment['body'].encode('utf-8')
                            json.loads(body)
                            target = case / (prefix + safe_name + ('' if safe_name.endswith('.json') else '.json') + '.gz')
                            keep(target, body, 'inline Playwright result attachment', compress=True)
                            info['retainedFile'] = str(target.relative_to(output))
                        elif attachment.get('path'):
                            artifact_path = 'playwright-report/' + attachment['path']
                            item = outer.getinfo(artifact_path)
                            info.update({'artifactPath': artifact_path, 'bytes': item.file_size,
                                         'compressedBytes': item.compress_size, 'extracted': False})
                            # Preserve original native menu traces only after an observed failure.
                            if (attachment.get('name') == 'trace'
                                    and 'menu access:' in test.get('title', '')
                                    and result.get('status') != 'passed'):
                                body = outer.read(artifact_path)
                                target = case / (prefix + 'trace.zip')
                                keep(target, body, artifact_path)
                                info.update({'extracted': True, 'retainedFile': str(target.relative_to(output))})
                        entry['attachments'].append(info)
                    details['results'].append(entry)
                summary.append(details)
    for name in ['browser-backend.json', 'browser-progress.json', 'test-results/.last-run.json']:
        if name in names:
            keep(output / Path(name).name, outer.read(name), name)

write_json(output / 'tests-summary.json', summary)
write_json(output / 'attachment-manifest.json', manifest)
print(json.dumps({'tests': len(summary), 'outcomes': [
    {'case': t['caseDirectory'], 'title': t['title'], 'outcome': t['outcome'],
     'duration': t['duration'], 'results': [{'status': r['status'], 'retry': r['retry']}
                                        for r in t['results']]}
    for t in summary]}, indent=2))
