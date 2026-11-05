#!/bin/bash
# usage: capbuild.sh <tag> <git-rev|WORKTREE>
# Capture-only build: the given source with the 45 s GPU-fence deadline relaxed
# for contended software rendering. Never committed; output in scratch dist-<tag>.
set -e
W=/home/user/Experiment-3/.claude/worktrees/agent-a86a2314095fca118
S=/tmp/claude-0/-home-user-Experiment-3/77bc90d5-fa90-573c-91d6-9e500a2bf2c9/scratchpad/mx
D=$S/src-$1
rm -rf "$D"; mkdir -p "$D"
FILES="src index.html vite.config.ts package.json package-lock.json tsconfig.json scripts"
if [ "$2" = "WORKTREE" ]; then
  (cd $W && cp -r $FILES "$D"/)
else
  (cd $W && git archive "$2" $FILES | tar -x -C "$D")
fi
ln -s $W/node_modules "$D/node_modules"
ln -s $W/public "$D/public"
sed -i 's/const deadline = performance.now() + 45000;/const deadline = performance.now() + 1800000;/' "$D/src/rendering/renderer.ts"
grep -q "performance.now() + 1800000" "$D/src/rendering/renderer.ts"
cd "$D" && npx vite build --outDir "$S/dist-$1" --emptyOutDir --logLevel warn 2>&1 | grep -v "chunk\|manualChunks\|dynamic import\|Adjust chunk" || true
ls "$S/dist-$1/index.html"
