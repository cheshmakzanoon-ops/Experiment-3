#!/usr/bin/env bash
# Usage: qcap.sh <wt-dir> <port> <shot-name> [capture-matrix args...]
# Shader check then capture, both under the capture lock. Logs to $S/qcap-<shot-name>.log
S=${STUDIO_SCRATCH:-${TMPDIR:-/tmp}/apex-studio}
WT=$1; PORT=$2; NAME=$3; shift 3
LOG=$S/qcap-$NAME.log
cd $WT || exit 1
{
  echo "== shadercheck $(date +%T)"
  if [ -n "$QCAP_SKIP_CHECK" ]; then rc=0; else
  mkdir -p $S; flock $S/capture.lock timeout 400 node scripts/studio/tools/shadercheck.mjs http://127.0.0.1:$PORT 150
  rc=$?; fi
  echo "== shadercheck rc=$rc $(date +%T)"
  if [ $rc -ne 0 ]; then echo "SHADERCHECK FAILED"; exit 1; fi
  rm -rf $S/shots/$NAME
  flock $S/capture.lock timeout ${QCAP_TIMEOUT:-2700} node scripts/studio/capture-matrix.mjs $S/shots/$NAME --url http://127.0.0.1:$PORT "$@"
  echo "== capture rc=$? $(date +%T)"
} > $LOG 2>&1
