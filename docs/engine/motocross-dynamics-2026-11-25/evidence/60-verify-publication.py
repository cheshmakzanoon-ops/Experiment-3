"""Read-only verification of the published motocross code commit.

Run from any directory. This reads Git objects and sibling acceptance evidence;
it does not fetch, check out, stage, reset, write evidence, or update any ref.
The optional worktree/index checks describe the current checkout, independently
of the immutable code-commit checks. A later documentation commit legitimately
has a different complete index, so omit --check-code-index after that commit.
"""

import argparse
import hashlib
import json
import stat
import subprocess
from pathlib import Path

CODE = '39d9d497880e92801a7d77de6af2639b4186bfcc'
PARENT = 'f3b39eb8e1b02fc0677086819fc384b6ceacefc2'
BASELINE = 'b527a7e01ea247f0233a2ec4f2850639bafbd887'
TREE = 'b7f379a7aaea0f807b5623b2c981190c6d1a3a17'
SOURCE = '5fea93841ed0da6949fe1dc2858c57f38b53595279222ab1550f74bfb6131096'
FINGERPRINT = 'd32aa557b2619b63883312be75df7735fb8ede13b801bf5315e642b2664c88bf'
EVIDENCE = Path(__file__).resolve().parent
REPO = EVIDENCE.parents[3]


def git(*args):
    return subprocess.check_output(['git', '-C', str(REPO), *args])


def entries(ref):
    result = {}
    for row in git('ls-tree', '-r', '-z', ref).split(b'\0'):
        if row:
            header, path = row.split(b'\t', 1)
            result[path.decode()] = tuple(header.decode().split())
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit', default=CODE)
    parser.add_argument('--verify-worktree', action='store_true')
    parser.add_argument('--check-code-index', action='store_true')
    args = parser.parse_args()
    assert args.commit == CODE, 'This evidence identifies one immutable code commit'
    assert git('rev-parse', CODE + '^{tree}').decode().strip() == TREE
    assert git('show', '-s', '--format=%P', CODE).decode().strip() == PARENT
    subprocess.check_call(['git', '-C', str(REPO), 'merge-base', '--is-ancestor', BASELINE, PARENT])
    candidate, baseline = entries(CODE), entries(BASELINE)
    assert len(candidate) == 10467
    protection = json.loads((EVIDENCE / '51-protected-scope.json').read_text())
    provenance = json.loads((EVIDENCE / '53-build-provenance.json').read_text())
    publication = provenance['publication']['publication_path_hashes']
    changed = sorted(filter(None, git('diff', '--name-only', '-z', PARENT, CODE).decode().split('\0')))
    assert changed == sorted(publication) and len(changed) == 59
    source_paths = sorted(path for path in candidate if path.startswith('src/'))
    fingerprint_paths = sorted(source_paths + ['package-lock.json', 'index.html', 'vite.config.ts'])
    assert len(source_paths) == 1126 and len(fingerprint_paths) == 1129
    assert all(path.isascii() for path in fingerprint_paths)
    protected = {}
    for path, mode, oid, sha256, size in protection['protected_rows']:
        assert candidate[path] == baseline[path] == (mode, 'blob', oid), path
        protected[path] = (sha256, size)
    assert len(protected) == 1772
    required = sorted(set(fingerprint_paths) | set(publication) | set(protected))
    process = subprocess.Popen(['git', '-C', str(REPO), 'cat-file', '--batch'],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    hashes, sizes = {}, {}
    content_fingerprint = hashlib.sha256()
    for path in required:
        mode, kind, oid = candidate[path]
        assert kind == 'blob' and mode in ('100644', '100755'), path
        process.stdin.write((oid + '\n').encode())
        process.stdin.flush()
        actual_oid, actual_kind, size = process.stdout.readline().decode().strip().split()
        assert actual_oid == oid and actual_kind == 'blob', path
        data = process.stdout.read(int(size))
        assert len(data) == int(size) and process.stdout.read(1) == b'\n', path
        digest = hashlib.sha256(data).hexdigest()
        hashes[path], sizes[path] = digest, len(data)
        if path in publication:
            assert digest == publication[path], path
        if path in protected:
            assert (digest, len(data)) == protected[path], path
        if path in fingerprint_paths:
            content_fingerprint.update(path.encode() + b'\0' + data + b'\0')
        if args.verify_worktree:
            current = REPO / path
            assert stat.S_ISREG(current.lstat().st_mode), path
            assert hashlib.sha256(current.read_bytes()).hexdigest() == digest, path
            current_mode = '100755' if current.stat().st_mode & 0o111 else '100644'
            assert current_mode == mode, path
    process.stdin.close()
    assert process.wait() == 0
    source_digest = hashlib.sha256(''.join(path + '\0' + hashes[path] + '\n' for path in source_paths).encode()).hexdigest()
    assert source_digest == SOURCE
    assert content_fingerprint.hexdigest() == FINGERPRINT
    index_equal = None
    if args.check_code_index:
        index = {}
        for row in git('ls-files', '--stage', '-z').split(b'\0'):
            if row:
                header, path = row.split(b'\t', 1)
                mode, oid, stage = header.decode().split()
                assert stage == '0', path
                index[path.decode()] = (mode, 'commit' if mode == '160000' else 'blob', oid)
        index_equal = index == candidate
        assert index_equal
    result = {
        'code_commit': CODE, 'code_tree': TREE, 'sole_parent': PARENT,
        'baseline_is_parent_ancestor': True, 'tree_entries': len(candidate),
        'changed_paths': len(changed), 'changed_bytes': sum(sizes[path] for path in changed),
        'source_files': len(source_paths), 'source_sha256': source_digest,
        'fingerprint_inputs': len(fingerprint_paths), 'vite_fingerprint': content_fingerprint.hexdigest(),
        'protected_files': len(protected), 'protected_bytes': sum(size for _, size in protected.values()),
        'protected_bytes_and_modes_equal_baseline': True,
        'distinct_blob_paths_rehashed': len(required),
        'working_files_checked': len(required) if args.verify_worktree else 0,
        'working_files_equal_code_blobs': True if args.verify_worktree else None,
        'index_equals_complete_code_tree': index_equal,
        'local_head_at_observation': git('rev-parse', 'HEAD').decode().strip(),
        'mutations_performed': False,
        'remote_ref_checked_by_this_script': False,
        'scope': 'Immutable code publication content; separate GitHub GET evidence is needed for the live remote ref.'
    }
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
