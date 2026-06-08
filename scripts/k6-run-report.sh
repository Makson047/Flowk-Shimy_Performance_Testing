#!/bin/bash

# Usage:
#   ./scripts/k6-run-report.sh like.js
#   ./scripts/k6-run-report.sh discoveryLoadTest_test.js
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
  echo "❌ Please provide test file name from load-tests/. Example:"
  echo "   ./scripts/k6-run-report.sh like.js"
  echo "   ./scripts/k6-run-report.sh shimy/shimyFeedLoad.js"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_PATH="$ROOT_DIR/load-tests/$TEST_FILE"

if [ ! -f "$TEST_PATH" ]; then
  echo "❌ Test file not found: $TEST_PATH"
  exit 1
fi

# Route Shimy reports into reports/Shimy/, keep Flowk reports in reports/.
case "$TEST_FILE" in
  shimy/*) REPORTS_SUBDIR="Shimy" ;;
  *)       REPORTS_SUBDIR="" ;;
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
