#!/bin/bash

# Usage:
#   ./scripts/k6-run-report.sh flowk/discoveryLoadTest.js
#   ./scripts/k6-run-report.sh flowk/feedLoad.js
#   ./scripts/k6-run-report.sh shimy/shimyFeedLoad.js
#
# Optional env knobs (forwarded to k6 via --env):
#   PROFILE=smoke|load|stress    (test-specific)
#   MODE=send|typing             (only for shimyChatLoad.js)
#   LAT, LON                     (override geo center for Shimy feed)
#   TIMELINE=1                   write raw NDJSON so the report can
#                                draw RPS / latency / VUs over time
#                                (warning: file can be tens of MB on
#                                 long stress runs)

set -e

TEST_FILE="$1"

if [ -z "$TEST_FILE" ]; then
  echo "❌ Please provide test file path from load-tests/. Example:"
  echo "   ./scripts/k6-run-report.sh flowk/discoveryLoadTest.js"
  echo "   ./scripts/k6-run-report.sh shimy/shimyFeedLoad.js"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_PATH=""
for candidate in \
  "$ROOT_DIR/load-tests/$TEST_FILE" \
  "$ROOT_DIR/$TEST_FILE" \
  "$ROOT_DIR/load-tests/flowk/$TEST_FILE" \
  "$ROOT_DIR/load-tests/shimy/$TEST_FILE"; do
  if [ -f "$candidate" ]; then
    TEST_PATH="$candidate"
    break
  fi
done

if [ -z "$TEST_PATH" ]; then
  echo "❌ Test file not found. Tried:"
  for candidate in \
    "$ROOT_DIR/load-tests/$TEST_FILE" \
    "$ROOT_DIR/$TEST_FILE" \
    "$ROOT_DIR/load-tests/flowk/$TEST_FILE" \
    "$ROOT_DIR/load-tests/shimy/$TEST_FILE"; do
      echo "   $candidate"
  done
  exit 1
fi

# Route reports by project name: Flowk and Shimy each get their own folder.
case "$TEST_FILE" in
  shimy/*) REPORTS_SUBDIR="Shimy" ;;
  flowk/*) REPORTS_SUBDIR="Flowk" ;;
  *)
    case "$(basename "$TEST_PATH")" in
      *.js)
        if [ -d "$ROOT_DIR/load-tests/shimy" ] && [ -f "$ROOT_DIR/load-tests/shimy/$(basename "$TEST_PATH")" ]; then
          REPORTS_SUBDIR="Shimy"
        else
          REPORTS_SUBDIR="Flowk"
        fi
        ;;
    esac
    ;;
esac

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
if [ -n "$REPORTS_SUBDIR" ]; then
  RUN_DIR="$ROOT_DIR/load-tests/reports/$REPORTS_SUBDIR/$TIMESTAMP"
else
  RUN_DIR="$ROOT_DIR/load-tests/reports/$TIMESTAMP"
fi
mkdir -p "$RUN_DIR"

SUMMARY_JSON="$RUN_DIR/summary.json"
REPORT_HTML="$RUN_DIR/summary.html"
RAW_NDJSON="$RUN_DIR/raw.ndjson"
META_JSON="$RUN_DIR/meta.json"

# Persist the run "context" — k6 doesn't know about test file path / profile /
# mode by default, so we capture them here. The compare-index uses this to
# show which test + profile each row corresponds to.
cat > "$META_JSON" <<EOF
{
  "testFile": "$TEST_FILE",
  "timestamp": "$TIMESTAMP",
  "profile": "${PROFILE:-load}",
  "mode": "${MODE:-}",
  "timelineEnabled": ${TIMELINE:-0}
}
EOF

K6_OUT_ARGS=()
if [ "${TIMELINE:-0}" = "1" ]; then
  K6_OUT_ARGS+=("--out" "json=$RAW_NDJSON")
  echo "🕒 Timeline output enabled — raw samples → $RAW_NDJSON"
fi

# Forward useful envs to k6 if set in the parent shell.
K6_ENV_ARGS=()
for v in PROFILE MODE LAT LON USER_LIMIT; do
  if [ -n "${!v:-}" ]; then
    K6_ENV_ARGS+=("--env" "$v=${!v}")
  fi
done

echo "🚀 Running k6 test: $TEST_FILE"
echo "   Output dir: $RUN_DIR"
if ! k6 run "$TEST_PATH" \
      --summary-export="$SUMMARY_JSON" \
      "${K6_OUT_ARGS[@]}" \
      "${K6_ENV_ARGS[@]}"; then
  echo "⚠️ k6 finished but thresholds were not met. Continuing to generate report..."
fi

echo "📄 Generating HTML / CSV / Markdown report..."
node "$ROOT_DIR/tools/k6-html-report.mjs" \
  "$SUMMARY_JSON" \
  "$TEST_FILE" \
  "$TIMESTAMP" \
  "$RAW_NDJSON"

# Refresh the per-app comparison index so all Shimy runs show up in one place.
if [ -n "$REPORTS_SUBDIR" ]; then
  echo "🗂  Updating comparison index for $REPORTS_SUBDIR..."
  node "$ROOT_DIR/tools/k6-compare-index.mjs" \
    "$ROOT_DIR/load-tests/reports/$REPORTS_SUBDIR" \
    "$REPORTS_SUBDIR" || echo "   (index update skipped: $?)"
fi

echo "🌐 Opening HTML report in browser..."
open "$REPORT_HTML"

echo "✅ Done. Report saved under:"
echo "   $RUN_DIR"
