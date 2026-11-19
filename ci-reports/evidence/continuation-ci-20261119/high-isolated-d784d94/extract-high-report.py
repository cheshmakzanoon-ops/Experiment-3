from pathlib import Path
import base64
import hashlib
import io
import json
import re
import sys
import zipfile

archive = Path(sys.argv[1])
output = Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
attachment_manifest = []
with zipfile.ZipFile(archive) as outer:
    html = outer.read('playwright-report/index.html').decode('utf-8')
    match = re.search(r'<script[^>]+id="playwrightReportBase64"[^>]*>(.*?)</script>', html, re.S)
    if not match:
        raise RuntimeError('Embedded Playwright report was not found')
    payload = match.group(1).strip().split('base64,', 1)[-1]
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(payload))) as inner:
        (output / 'report-metadata.json').write_bytes(inner.read('report.json'))
        selected = []
        for name in inner.namelist():
            if not name.endswith('.json') or name == 'report.json':
                continue
            raw = inner.read(name)
            data = json.loads(raw)
            if not isinstance(data, dict):
                continue
            tests = [test for test in data.get('tests', [])
                     if 'High production scene presents' in test.get('title', '')]
            if not tests:
                continue
            (output / 'test-detail.json').write_bytes(raw)
            selected.extend(tests)
            for test in tests:
                for result in test.get('results', []):
                    for attachment in result.get('attachments', []):
                        attachment_name = attachment.get('name', '')
                        if attachment.get('contentType') == 'application/json' and 'body' in attachment:
                            safe_name = Path(attachment_name).name
                            if not safe_name.endswith('.json'):
                                safe_name += '.json'
                            body = attachment['body'].encode('utf-8')
                            json.loads(body)
                            (output / safe_name).write_bytes(body)
                            attachment_manifest.append({
                                'name': attachment_name,
                                'file': safe_name,
                                'bytes': len(body),
                                'sha256': hashlib.sha256(body).hexdigest(),
                                'source': 'inline Playwright result attachment',
                            })
                        elif attachment.get('path'):
                            path = 'playwright-report/' + attachment['path']
                            info = outer.getinfo(path)
                            attachment_manifest.append({
                                'name': attachment_name,
                                'archivePath': path,
                                'bytes': info.file_size,
                                'compressedBytes': info.compress_size,
                                'extracted': False,
                            })
    if len(selected) != 1:
        raise RuntimeError(f'Expected one High test; found {len(selected)}')
    for name in ['browser-backend.json', 'browser-progress.json']:
        if name in outer.namelist():
            (output / name).write_bytes(outer.read(name))

(output / 'attachment-manifest.json').write_text(json.dumps(attachment_manifest, indent=2) + '\n')
test = selected[0]
summary = {
    'title': test['title'],
    'outcome': test.get('outcome'),
    'durationMs': test.get('duration'),
    'results': [{key: result.get(key) for key in ['status', 'duration', 'retry', 'errors']}
                for result in test.get('results', [])],
}
commands_path = output / 'high-gp-startup-commands.json'
if commands_path.exists():
    commands = json.loads(commands_path.read_text())
    late = commands.get('latePrograms', [])
    uploads = commands.get('slowUploads', [])
    summary['latePrograms'] = [{
        key: record.get(key) for key in ['sequence', 'stage', 'program', 'framebuffer', 'cubeFace', 'viewport', 'stack']
    } | {
        shader: {key: (record.get(shader) or {}).get(key)
                 for key in ['shader', 'hash', 'shaderName', 'sourceLength', 'truncated']}
        for shader in ['vertex', 'fragment']
    } for record in late]
    summary['slowUploadCount'] = len(uploads)
    summary['lastStarted'] = commands.get('lastStarted')
    summary['lastCompleted'] = commands.get('lastCompleted')
(output / 'quick-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
