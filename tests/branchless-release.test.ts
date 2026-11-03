import { expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

it('publishes exact validated bytes, recovers reruns, and rejects altered or stale artifacts without pushing branches', () => {
  const root = mkdtempSync(join(tmpdir(), 'apex-release-'));
  const script = new URL('../scripts/publish-validated-release.sh', import.meta.url);
  try {
    const bin = join(root, 'bin'),
      release = join(root, 'release'),
      models = join(release, 'models'),
      manifests = join(root, 'src/rendering'),
      state = join(root, 'mock-release');
    for (const path of [bin, models, manifests]) mkdirSync(path, { recursive: true });
    copyFileSync(script, join(root, 'publish.sh'));
    // G15: the script certifies the artifact with the IP guard that sits next to it.
    for (const guard of ['ip-guard.mjs', 'ip-denylist.mjs'])
      copyFileSync(new URL(`../scripts/${guard}`, import.meta.url), join(root, guard));
    const sha = 'a'.repeat(40);
    writeFileSync(join(release, 'SOURCE_COMMIT.txt'), sha + '\n');
    writeFileSync(join(release, 'index.html'), '<html>exact tested build</html>');
    const identity = { version: 1, commit: sha, fingerprint: 'c'.repeat(64), variant: 'product' };
    writeFileSync(join(release, 'BUILD_IDENTITY.json'), JSON.stringify(identity));
    const families = [
      ['track-signal-hardware', 'aurel-track-signal-hardware.glb'],
      ['track-boards', 'aurel-track-boards.glb'],
      ['broadcast-cameras', 'aurel-broadcast-cameras.glb'],
      ['aurel-vegetation', 'aurel-vegetation.glb'],
      ['aurel-quarry', 'aurel-quarry.glb'],
      ['event-hall', 'aurel-event-hall.glb'],
      ['secondary-grandstands', 'aurel-secondary-grandstands.glb'],
    ];
    for (const [family, asset] of families) {
      const data = Buffer.from(`asset ${family}`);
      writeFileSync(join(models, asset), data);
      writeFileSync(
        join(manifests, `${family}.manifest.json`),
        JSON.stringify({
          exchange: `public/models/${asset}`,
          exchangeBytes: data.length,
          exchangeSHA256: createHash('sha256').update(data).digest('hex'),
          url: `models/${asset}`,
          bytes: data.length,
          sha256: createHash('sha256').update(data).digest('hex'),
        }),
      );
    }
    writeFileSync(
      join(bin, 'git'),
      '#!/usr/bin/env bash\nset -euo pipefail\ntest "$1" = ls-remote\nprintf "%s\\trefs/heads/main\\n" "$TEST_CURRENT"\n',
      { mode: 0o755 },
    );
    writeFileSync(
      join(bin, 'gh'),
      `#!/usr/bin/env python3
import os,sys,pathlib,shutil
args=sys.argv[1:]; root=pathlib.Path(os.environ['MOCK_RELEASE']); log=root.parent/'gh-calls'
with log.open('a') as f:f.write(' '.join(args)+'\\n')
assert args[0]=='release'
cmd=args[1]
if cmd=='view':
    if not root.exists(): sys.exit(1)
    if '--json' in args:
        for p in sorted(root.glob('*')):
            if p.name!='published': print(p.name)
elif cmd=='create': root.mkdir()
elif cmd=='upload':
    p=pathlib.Path(args[3]); shutil.copyfile(p,root/p.name)
elif cmd=='download':
    name=args[args.index('--pattern')+1]; destination=pathlib.Path(args[args.index('--dir')+1]);shutil.copyfile(root/name,destination/name)
elif cmd=='edit': (root/'published').write_text('yes')
else: raise ValueError(cmd)
`,
      { mode: 0o755 },
    );
    const env = {
      ...process.env,
      PATH: bin + ':' + process.env.PATH,
      VALIDATED_SHA: sha,
      GH_REPO: 'owner/repo',
      VALIDATION_URL: 'https://example.test/validation',
      GITHUB_STEP_SUMMARY: join(root, 'summary'),
      MOCK_RELEASE: state,
      TEST_CURRENT: sha,
    };
    const run = () =>
      spawnSync('bash', [join(root, 'publish.sh'), release], {
        cwd: root,
        env,
        encoding: 'utf8',
        timeout: 30000,
      });
    let result = run();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(existsSync(join(state, 'published'))).toBe(true);
    const bytes = readFileSync(join(state, 'apex-formula-playable.zip'));
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(readFileSync(join(state, 'SHA256SUMS'), 'utf8')).toContain(hash);
    result = run();
    expect(result.status).toBe(0);
    expect(readFileSync(join(state, 'apex-formula-playable.zip'))).toEqual(bytes);
    const callsBeforeNegativeCases = readFileSync(join(root, 'gh-calls'), 'utf8');
    for (const [family, asset] of families) {
      const path = join(models, asset);
      const original = readFileSync(path);
      // Equal-length byte corruption exercises the checksum, not just file size.
      const corrupt = Buffer.from(original);
      corrupt[0] ^= 1;
      writeFileSync(path, corrupt);
      expect(run().status).not.toBe(0);
      rmSync(path);
      expect(run().status).not.toBe(0);
      writeFileSync(path, original);
      const manifestPath = join(manifests, `${family}.manifest.json`);
      const originalManifest = readFileSync(manifestPath);
      const wrongPath = JSON.parse(originalManifest.toString());
      if (family === 'event-hall' || family === 'secondary-grandstands')
        wrongPath.exchange = 'public/models/other.glb';
      else wrongPath.url = 'models/other.glb';
      writeFileSync(manifestPath, JSON.stringify(wrongPath));
      expect(run().status).not.toBe(0);
      writeFileSync(manifestPath, originalManifest);
    }
    for (const invalid of [
      { ...identity, commit: 'b'.repeat(40) },
      { ...identity, fingerprint: 'invalid' },
      { ...identity, version: 2 },
      // G15: only a product build is publishable; owner and review QA builds never are.
      { ...identity, variant: 'owner' },
      { ...identity, variant: 'review' },
      { version: 1, commit: sha, fingerprint: 'c'.repeat(64) },
    ]) {
      writeFileSync(join(release, 'BUILD_IDENTITY.json'), JSON.stringify(invalid));
      expect(run().status).not.toBe(0);
    }
    writeFileSync(join(release, 'BUILD_IDENTITY.json'), JSON.stringify(identity));
    expect(readFileSync(join(root, 'gh-calls'), 'utf8')).toBe(callsBeforeNegativeCases);
    // G15: the owner-supplied real-brand model must never be in a published release. The
    // validated artifact is a product build, so its presence (any path) is refused.
    writeFileSync(join(models, 'supplied-player.glb.gz'), 'owner-only asset');
    expect(run().status).not.toBe(0);
    rmSync(join(models, 'supplied-player.glb.gz'));
    // G15: a real-brand identifier in any shipped file fails the artifact's own IP guard run,
    // in snake_case as well as in prose (and a clean artifact above passed the same run).
    for (const leak of ['const d={"redbull_wordmark":1}', 'tyre_pirelli', 'Honda']) {
      writeFileSync(join(release, 'index.html'), `<html>${leak}</html>`);
      const refused = run();
      expect(refused.status, leak).not.toBe(0);
      expect(refused.stderr, leak).toContain('IP guard');
    }
    writeFileSync(join(release, 'index.html'), '<html>exact tested build</html>');
    // A mismatched source identity also fails before interacting with release APIs.
    writeFileSync(join(release, 'SOURCE_COMMIT.txt'), 'b'.repeat(40));
    expect(run().status).not.toBe(0);
    const calls = readFileSync(join(root, 'gh-calls'), 'utf8');
    expect(calls).not.toContain('--clobber');
    expect(readFileSync(script, 'utf8')).not.toMatch(/git (push|switch|checkout|fetch)/);
    // Restore the validated input; a newer main leaves the release untouched.
    writeFileSync(join(release, 'SOURCE_COMMIT.txt'), sha + '\n');
    env.TEST_CURRENT = 'b'.repeat(40);
    expect(run().status).toBe(0);
    expect(readFileSync(join(root, 'gh-calls'), 'utf8')).toBe(calls);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
