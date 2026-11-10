#!/usr/bin/env bash
# CI reporter: turns one GitHub Actions run into small, committed, human-readable evidence
# under ci-reports/ so a developer (or agent) with only `git` access can read CI results.
#
#   ci-report.sh <run_id> [--shots] [--artifact-pattern PATTERN] [--max-shots N] [--width PX] [--log-lines N]
#
# Needs: gh (GH_TOKEN with actions:read), jq, and for --shots ImageMagick `convert`.
# Output (overwritten each time, history keeps older versions):
#   ci-reports/<workflow-slug>.md        run summary + job table + failing-step digest
#   ci-reports/logs/<workflow-slug>/*.log  tail + error digest of every non-successful job
#   ci-reports/shots/<workflow-slug>/*.jpg downscaled screenshots (only with --shots)
set -euo pipefail

RUN_ID="${1:?usage: ci-report.sh <run_id> [options]}"
shift || true
SHOTS=0
PATTERN='*'
MAX_SHOTS=12
WIDTH=1280
LOG_LINES=250
while [ $# -gt 0 ]; do
  case "$1" in
    --shots) SHOTS=1 ;;
    --artifact-pattern) PATTERN="$2"; shift ;;
    --max-shots) MAX_SHOTS="$2"; shift ;;
    --width) WIDTH="$2"; shift ;;
    --log-lines) LOG_LINES="$2"; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
OUT=ci-reports
mkdir -p "$OUT"

RUN_JSON="$(gh api "repos/$REPO/actions/runs/$RUN_ID")"
WF_NAME="$(jq -r .name <<<"$RUN_JSON")"
SLUG="$(tr '[:upper:] ' '[:lower:]-' <<<"$WF_NAME" | tr -cd 'a-z0-9-' | cut -c1-60)"
LOGDIR="$OUT/logs/$SLUG"
SHOTDIR="$OUT/shots/$SLUG"
rm -rf "$LOGDIR" "$SHOTDIR"
mkdir -p "$LOGDIR"

JOBS_JSON="$(gh api --paginate "repos/$REPO/actions/runs/$RUN_ID/jobs?per_page=100" | jq -s '[.[].jobs[]]')"

strip() { sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g; s/^[0-9T:.\-]+Z //'; }

{
  echo "# $WF_NAME"
  echo
  echo "- run: $(jq -r .html_url <<<"$RUN_JSON")"
  echo "- commit: \`$(jq -r .head_sha <<<"$RUN_JSON" | cut -c1-10)\` · $(jq -r .head_commit.message <<<"$RUN_JSON" | head -1)"
  echo "- event: $(jq -r .event <<<"$RUN_JSON") · status: $(jq -r .status <<<"$RUN_JSON") · conclusion: **$(jq -r '.conclusion // "in progress"' <<<"$RUN_JSON")**"
  echo "- started: $(jq -r .run_started_at <<<"$RUN_JSON") · updated: $(jq -r .updated_at <<<"$RUN_JSON")"
  echo
  echo "| job | conclusion | minutes | failed steps |"
  echo "| --- | --- | ---: | --- |"
  jq -r '.[] | [ .name, (.conclusion // .status),
      ( if .started_at and .completed_at then (((.completed_at|fromdateiso8601) - (.started_at|fromdateiso8601))/60|floor|tostring) else "" end ),
      ([.steps[]? | select(.conclusion=="failure" or .conclusion=="timed_out" or .conclusion=="cancelled") | .name] | join("; ")) ]
      | "| " + (join(" | ")) + " |"' <<<"$JOBS_JSON"
} >"$OUT/$SLUG.md"

# Digest of every job that did not succeed.
jq -r '.[] | select(.conclusion != "success" and .conclusion != "skipped" and .conclusion != null) | "\(.id)\t\(.name)"' <<<"$JOBS_JSON" |
while IFS=$'\t' read -r JOB_ID JOB_NAME; do
  JSLUG="$(tr '[:upper:] ' '[:lower:]-' <<<"$JOB_NAME" | tr -cd 'a-z0-9-' | cut -c1-60)"
  FULL="$(mktemp)"
  if gh api "repos/$REPO/actions/jobs/$JOB_ID/logs" >"$FULL" 2>/dev/null; then
    {
      echo "### $JOB_NAME (job $JOB_ID)"
      echo "--- error digest (first 120 matching lines) ---"
      strip <"$FULL" | grep -n -E '(^|\s)([0-9]+\) |✘|Error:|ERROR|FAIL|Timeout|timed out|##\[error\]|Process completed with exit code|expect\()' | head -120 || true
      echo
      echo "--- last $LOG_LINES lines ---"
      strip <"$FULL" | tail -n "$LOG_LINES"
    } | head -c 90000 >"$LOGDIR/$JSLUG.log"
  else
    echo "logs unavailable (expired or not accessible)" >"$LOGDIR/$JSLUG.log"
  fi
  rm -f "$FULL"
done

if [ "$SHOTS" = 1 ]; then
  TMP="$(mktemp -d)"
  gh run download "$RUN_ID" -R "$REPO" -p "$PATTERN" -D "$TMP" || echo "no artifacts matched $PATTERN" >&2
  mkdir -p "$SHOTDIR"
  N=0
  while IFS= read -r IMG; do
    [ "$N" -ge "$MAX_SHOTS" ] && break
    NAME="$(echo "${IMG#"$TMP"/}" | tr '/ ' '__' | sed -E 's/\.(png|jpe?g)$//' | tail -c 90)"
    convert "$IMG" -resize "${WIDTH}x>" -strip -quality 72 "$SHOTDIR/$NAME.jpg" && N=$((N + 1))
  done < <(find "$TMP" -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' \) -size +4k | sort)
  {
    echo
    echo "Screenshots: $N image(s) in \`$SHOTDIR\` (pattern \`$PATTERN\`, max $MAX_SHOTS, width $WIDTH)."
  } >>"$OUT/$SLUG.md"
  rm -rf "$TMP"
fi

echo "wrote $OUT/$SLUG.md"
