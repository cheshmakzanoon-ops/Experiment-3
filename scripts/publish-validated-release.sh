#!/usr/bin/env bash
# Consume a gated build; never rebuild it or push a deployment branch.
set -euo pipefail
release=${1:?Expected the validated artifact directory}
: "${VALIDATED_SHA:?}" "${GH_REPO:?}" "${VALIDATION_URL:?}"
[[ "$VALIDATED_SHA" =~ ^[0-9a-f]{40}$ ]]
test "$(cat "$release/SOURCE_COMMIT.txt")" = "$VALIDATED_SHA"
test -s "$release/index.html"
node --input-type=module - "$release" <<'NODE'
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const identity = JSON.parse(readFileSync(`${process.argv[2]}/BUILD_IDENTITY.json`, 'utf8'));
if (identity.version !== 1 || identity.commit !== process.env.VALIDATED_SHA ||
    !/^[0-9a-f]{64}$/.test(identity.fingerprint)) {
  throw new Error('Validated build identity differs from the gated source commit');
}
for (const [manifestPath, asset] of [
  ['src/rendering/supplied-player.manifest.json', 'supplied-player.glb.gz'],
  ['src/rendering/supplied-player-lods.manifest.json', 'supplied-player-lods.bin.gz'],
]) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bytes = readFileSync(`${process.argv[2]}/models/${asset}`);
  if (bytes.length !== manifest.compressedBytes ||
      createHash('sha256').update(bytes).digest('hex') !== manifest.compressedSHA256) {
    throw new Error(`Validated asset differs from its source manifest: ${asset}`);
  }
}
for (const [family, filename] of [
  ['track-signal-hardware', 'aurel-track-signal-hardware.glb'],
  ['track-boards', 'aurel-track-boards.glb'],
  ['broadcast-cameras', 'aurel-broadcast-cameras.glb'],
  ['aurel-vegetation', 'aurel-vegetation.glb'],
  ['aurel-quarry', 'aurel-quarry.glb'],
]) {
  const manifest = JSON.parse(readFileSync(`src/rendering/${family}.manifest.json`, 'utf8'));
  const asset = `models/${filename}`;
  if (manifest.url !== asset) throw new Error(`Unexpected trackside asset path: ${family}`);
  const bytes = readFileSync(`${process.argv[2]}/${asset}`);
  if (bytes.length !== manifest.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) {
    throw new Error(`Validated asset differs from its source manifest: ${asset}`);
  }
}
NODE
current=$(git ls-remote origin refs/heads/main | cut -f1)
if test "$current" != "$VALIDATED_SHA"; then
  echo 'Source advanced; no release published.' >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
# Fixed ZIP metadata makes reruns comparable without depending on extraction times.
python3 - "$release" "$out/apex-formula-playable.zip" <<'PY'
import pathlib, sys, zipfile
root = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError(f'Symlink in release: {path}')
        if path.is_file():
            entry = zipfile.ZipInfo(path.relative_to(root).as_posix(), (1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, path.read_bytes())
PY
(cd "$out" && sha256sum apex-formula-playable.zip > SHA256SUMS)
tag="playable-$VALIDATED_SHA"
if ! gh release view "$tag" >/dev/null 2>&1; then
  gh release create "$tag" --target "$VALIDATED_SHA" --draft \
    --title "Apex Formula · ${VALIDATED_SHA:0:7}" \
    --notes "Exact validated build of $VALIDATED_SHA. Validation: $VALIDATION_URL. Unzip and serve over HTTP; SOURCE_COMMIT.txt identifies the source. No hosting branch is required."
fi
# Recover an interrupted draft without clobbering any previously uploaded bytes.
for name in apex-formula-playable.zip SHA256SUMS; do
  if gh release view "$tag" --json assets --jq '.assets[].name' | grep -Fxq "$name"; then
    mkdir -p "$out/existing"
    gh release download "$tag" --pattern "$name" --dir "$out/existing"
    cmp "$out/$name" "$out/existing/$name"
  else
    gh release upload "$tag" "$out/$name"
  fi
done
current=$(git ls-remote origin refs/heads/main | cut -f1)
if test "$current" != "$VALIDATED_SHA"; then
  echo 'Source advanced during upload; retaining the source-addressed draft.' >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi
gh release edit "$tag" --draft=false --latest
printf 'Published validated source `%s`: https://github.com/%s/releases/tag/%s\n' \
  "$VALIDATED_SHA" "$GH_REPO" "$tag" >> "$GITHUB_STEP_SUMMARY"
