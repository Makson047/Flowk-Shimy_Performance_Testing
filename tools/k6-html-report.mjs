import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

// -----------------------------------------------------------------------------
// CLI ARGS
// Arg 1: path to k6 summary JSON                     (required)
// Arg 2: test file name that was executed            (optional, recommended)
// Arg 3: timestamp of the run (YYYYMMDD_HHMMSS)      (optional, recommended)
// Arg 4: path to raw NDJSON from `--out json=...`    (optional; enables timeline)
const summaryPath = process.argv[2];
const testFileName = process.argv[3] || 'N/A';
const runTimestamp = process.argv[4] || 'N/A';
const rawNdjsonPath = process.argv[5] || '';

if (!summaryPath) {
  console.error(
    '❌ Usage: node tools/k6-html-report.mjs <path/to/summary.json> [test-file.js] [timestamp] [raw.ndjson]'
  );
  process.exit(1);
}

// -----------------------------------------------------------------------------
// READ SUMMARY
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

const outDir = path.dirname(summaryPath);
const baseOut = path.join(outDir, 'summary');

// -----------------------------------------------------------------------------
// METRIC LABELS
const LABELS = {
  http_reqs: 'Total HTTP Requests',
  http_req_failed: 'Failed Requests',
  http_req_duration: 'Total Request Duration (ms)',
  http_req_connecting: 'Connection Time (ms)',
  http_req_tls_handshaking: 'TLS Handshaking Time (ms)',
  http_req_sending: 'Request Send Time (ms)',
  http_req_receiving: 'Response Receive Time (ms)',
  http_req_waiting: 'Waiting Time (TTFB) (ms)',
  data_sent: 'Data Sent (bytes)',
  data_received: 'Data Received (bytes)',
  vus: 'Virtual Users (VUs)',
  vus_max: 'Max Virtual Users',
  iterations: 'Total Iterations',
  iteration_duration: 'Iteration Duration (ms)',
  'http_req_duration{expected_response:true}':
    'Expected Response Duration (ms)',
  http_req_blocked: 'Blocked Time (ms)',

  // HTTP custom counters
  request_success: 'Successful HTTP requests (custom)',
  request_failures: 'Failed HTTP requests incl. timeouts (custom)',
  errors_4xx: 'HTTP 4xx errors',
  errors_5xx: 'HTTP 5xx errors',
  errors_network: 'Network / connection errors',
  feed_latency_ms: 'Shimy feed latency (ms, Trend)',

  // WS custom counters
  socket_connection_failures: 'WebSocket handshake failures (custom)',
  socket_messages_received: 'WebSocket messages received (custom)',
  socket_session_duration: 'WebSocket session duration (ms, Trend)',
  socket_sessions_ok: 'Successful WebSocket handshakes (custom)',

  // Shimy chat custom
  chat_messages_sent: 'Chat messages sent (chat.send)',
  chat_typing_sent: 'Chat typing events sent (chat.typing)',
  chat_delivery_latency_ms: 'Chat delivery latency (ms, Trend)',
  ws_close_4409: 'WS closes with code 4409 (duplicate session)',
  ws_close_4401: 'WS closes with code 4401 (invalid token)',
};

// -----------------------------------------------------------------------------
// HELPERS
const getMetricRaw = (key) => summary.metrics[key];
const getMetric = (key) =>
  summary.metrics[key]?.value || summary.metrics[key] || {};

const fmtOrNA = (v, digits = 2) =>
  v === null || v === undefined
    ? 'n/a'
    : typeof v === 'number'
    ? v.toFixed(digits)
    : String(v);

const formatValue = (val, key = '') => {
  const unit = LABELS[key]?.match(/\((.*?)\)/)?.[1] || '';
  if (typeof val === 'number') return `${val.toFixed(2)} ${unit}`;
  if (typeof val === 'object') {
    return Object.entries(val)
      .map(([k, v]) => `${k}: ${Number(v).toFixed(2)} ${unit}`)
      .join('\n');
  }
  return val;
};

function safeGetVusMax() {
  const raw = getMetricRaw('vus_max');
  if (raw === undefined || raw === null) return 'n/a';
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'object') {
    return raw.value ?? raw.max ?? raw.avg ?? 'n/a';
  }
  return 'n/a';
}

function percentile(arr, p) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

// -----------------------------------------------------------------------------
// TIMELINE — parse raw NDJSON (if provided)
//
// k6 emits one JSON object per line for each Point/Metric. We bucket samples
// into 5-second windows and compute per-window VUs, RPS, p95 latency, etc.
// This lets the HTML show how the test evolved over time, not just the totals.
const BUCKET_SEC = 5;

async function parseTimeline(ndjsonPath) {
  if (!ndjsonPath || !fs.existsSync(ndjsonPath)) return null;

  const buckets = new Map();
  const rl = createInterface({
    input: createReadStream(ndjsonPath),
    crlfDelay: Infinity,
  });

  let firstTs = null;
  for await (const line of rl) {
    if (!line) continue;
    let p;
    try {
      p = JSON.parse(line);
    } catch (_) {
      continue;
    }
    if (p.type !== 'Point' || !p.data) continue;

    const t = new Date(p.data.time).getTime();
    if (!Number.isFinite(t)) continue;
    if (firstTs === null) firstTs = t;
    const sec = Math.floor((t - firstTs) / 1000 / BUCKET_SEC) * BUCKET_SEC;

    let b = buckets.get(sec);
    if (!b) {
      b = {
        vus: 0,
        httpReqs: 0,
        durations: [],
        rtts: [],
        wsSessions: 0,
        wsHandshakeFails: 0,
        errors4xx: 0,
        errors5xx: 0,
        errorsNet: 0,
        chatRtts: [],
        feedLatencies: [],
      };
      buckets.set(sec, b);
    }

    const v = p.data.value;
    switch (p.metric) {
      case 'vus':
        b.vus = Math.max(b.vus, v);
        break;
      case 'http_reqs':
        b.httpReqs += v;
        break;
      case 'http_req_duration':
        b.durations.push(v);
        break;
      case 'chat_delivery_latency_ms':
        b.chatRtts.push(v);
        break;
      case 'feed_latency_ms':
        b.feedLatencies.push(v);
        break;
      case 'socket_sessions_ok':
        b.wsSessions += v;
        break;
      case 'socket_connection_failures':
        b.wsHandshakeFails += v;
        break;
      case 'errors_4xx':
        b.errors4xx += v;
        break;
      case 'errors_5xx':
        b.errors5xx += v;
        break;
      case 'errors_network':
        b.errorsNet += v;
        break;
    }
  }

  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  return sorted.map(([sec, b]) => ({
    t: sec,
    vus: b.vus,
    rps: b.httpReqs / BUCKET_SEC,
    p95: percentile(b.durations, 0.95),
    chatRttP95: percentile(b.chatRtts, 0.95),
    feedLatencyP95: percentile(b.feedLatencies, 0.95),
    wsSessions: b.wsSessions,
    wsHandshakeFails: b.wsHandshakeFails,
    errors4xx: b.errors4xx,
    errors5xx: b.errors5xx,
    errorsNet: b.errorsNet,
  }));
}

// -----------------------------------------------------------------------------
// HTTP-style metrics
const httpReqsMetric = getMetricRaw('http_reqs') || {};
const totalRequests = httpReqsMetric.count ?? httpReqsMetric.value ?? null;
const rpsAvg = httpReqsMetric.rate ?? null;

const durationMetric = getMetric('http_req_duration') || {};
// k6 stores the median under "med"; "p(50)"/"median" are only present if the
// test enables them via summaryTrendStats. Fall back through all three.
const latencyP50 =
  durationMetric['p(50)'] ??
  durationMetric['p(50.00)'] ??
  durationMetric.median ??
  durationMetric.med ??
  null;
const latencyP95 = durationMetric['p(95)'] ?? null;
const latencyP99 =
  durationMetric['p(99)'] ?? durationMetric['p(99.00)'] ?? null;

const connectMetric = getMetric('http_req_connecting') || {};
const sendMetric = getMetric('http_req_sending') || {};
const receiveMetric = getMetric('http_req_receiving') || {};
const waitMetric = getMetric('http_req_waiting') || {};

const durationChartData = {
  labels: ['Avg', 'Min', 'Max', 'p(90)', 'p(95)'],
  series: getMetric('http_req_duration') || {},
};

// Error breakdown counters. k6 omits a Counter from summary.json if it never
// incremented — so a clean HTTP run shows no `errors_4xx` key at all. We still
// render the KPI box (with explicit zeros) for any test that issued HTTP
// requests, so a successful run looks "0 / 0 / 0" instead of an empty gap.
const err4xxCount = getMetricRaw('errors_4xx')?.count ?? 0;
const err5xxCount = getMetricRaw('errors_5xx')?.count ?? 0;
const errNetCount = getMetricRaw('errors_network')?.count ?? 0;
const hasErrorBreakdown = totalRequests !== null && totalRequests > 0;

// -----------------------------------------------------------------------------
// WS-style metrics
const socketOkMetric = getMetricRaw('socket_sessions_ok') || null;
const socketFailMetric = getMetricRaw('socket_connection_failures') || null;
const socketDurationMetric = getMetricRaw('socket_session_duration') || null;
const socketMsgMetric = getMetricRaw('socket_messages_received') || null;

const wsSessionsOk = socketOkMetric?.count ?? null;
const wsSessionsFail = socketFailMetric?.count ?? null;
const wsMsgTotal = socketMsgMetric?.count ?? null;

const wsSessionDurAvgMs = socketDurationMetric?.avg ?? null;
const wsSessionDurP95Ms =
  socketDurationMetric?.percentiles?.['p(95)'] ??
  socketDurationMetric?.['p(95)'] ??
  null;
const wsSessionDurMaxMs = socketDurationMetric?.max ?? null;

// Chat delivery latency (Shimy chat.send → chat.message round-trip)
const chatRttMetric = getMetricRaw('chat_delivery_latency_ms') || null;
const chatRttAvg = chatRttMetric?.avg ?? null;
const chatRttP50 =
  chatRttMetric?.['p(50)'] ?? chatRttMetric?.med ?? null;
const chatRttP95 = chatRttMetric?.['p(95)'] ?? null;
const chatRttP99 = chatRttMetric?.['p(99)'] ?? null;
const chatRttMax = chatRttMetric?.max ?? null;
const hasChatRtt = chatRttMetric != null;

const chatMessagesSent = getMetricRaw('chat_messages_sent')?.count ?? null;
const chatTypingSent = getMetricRaw('chat_typing_sent')?.count ?? null;
const ws4409 = getMetricRaw('ws_close_4409')?.count ?? null;
const ws4401 = getMetricRaw('ws_close_4401')?.count ?? null;

// -----------------------------------------------------------------------------
// PASS / FAIL CALC
const customReqSuccess = getMetricRaw('request_success');
const customReqFail = getMetricRaw('request_failures');
let passCountFinal = null;
let failCountFinal = null;
let passFailSource = '';

if (customReqSuccess || customReqFail) {
  passCountFinal = customReqSuccess?.count ?? 0;
  failCountFinal = customReqFail?.count ?? 0;
  passFailSource = 'custom-http';
} else if (socketOkMetric || socketFailMetric) {
  passCountFinal = socketOkMetric?.count ?? 0;
  failCountFinal = socketFailMetric?.count ?? 0;
  passFailSource = 'custom-ws';
} else {
  const httpReqFailedMetric = getMetricRaw('http_req_failed') || {};
  const failRate = httpReqFailedMetric.rate ?? 0;
  let estimatedFailCount = 0;
  if (totalRequests !== null) {
    estimatedFailCount = Math.round(totalRequests * failRate);
    if (estimatedFailCount === 0 && latencyP95 !== null && latencyP95 > 2000) {
      estimatedFailCount = 1;
    }
  }
  passCountFinal =
    totalRequests !== null ? totalRequests - estimatedFailCount : 0;
  failCountFinal = estimatedFailCount;
  passFailSource = 'heuristic';
}

// -----------------------------------------------------------------------------
// THRESHOLD VERDICT
function thresholdVerdict() {
  const items = [];
  let totalChecks = 0;
  let totalPass = 0;
  for (const [metricName, m] of Object.entries(summary.metrics || {})) {
    if (!m || !m.thresholds) continue;
    for (const [name, t] of Object.entries(m.thresholds)) {
      totalChecks += 1;
      const passed = t.ok === true || t.ok === undefined ? !t.fails : false;
      if (passed) totalPass += 1;
      items.push({ metric: metricName, name, passed });
    }
  }
  return { items, totalChecks, totalPass };
}
const verdict = thresholdVerdict();
const verdictPass = verdict.totalChecks > 0 && verdict.totalPass === verdict.totalChecks;

// -----------------------------------------------------------------------------
// MAIN
const timeline = await parseTimeline(rawNdjsonPath);
const hasTimeline = !!timeline && timeline.length > 0;

// -----------------------------------------------------------------------------
// DETECT TEST MODE
let testMode = 'mixed';
if (socketOkMetric || socketFailMetric) testMode = 'ws';
else if (httpReqsMetric && (totalRequests !== null || rpsAvg !== null))
  testMode = 'http';

const vusMaxResolved = safeGetVusMax();

// -----------------------------------------------------------------------------
// KPI RENDERERS
function renderHttpKpis() {
  return `
    <div class="kpi-row">
      <div class="kpi-box">
        <div class="kpi-label">Avg requests/sec (RPS)</div>
        <div class="kpi-value">${fmtOrNA(rpsAvg)}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Total HTTP requests</div>
        <div class="kpi-value">${fmtOrNA(totalRequests, 0)}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Latency p50 / p95 / p99 (ms)</div>
        <div class="kpi-value">
          ${fmtOrNA(latencyP50)} / ${fmtOrNA(latencyP95)} / ${fmtOrNA(latencyP99)}
        </div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Passed / Failed requests</div>
        <div class="kpi-value">${fmtOrNA(passCountFinal, 0)} / ${fmtOrNA(failCountFinal, 0)}</div>
      </div>
      ${
        hasErrorBreakdown
          ? `
      <div class="kpi-box">
        <div class="kpi-label">Errors: 4xx / 5xx / network</div>
        <div class="kpi-value">${err4xxCount} / ${err5xxCount} / ${errNetCount}</div>
      </div>`
          : ''
      }
    </div>
    <p class="note">
      Pass/Fail source: <strong>${passFailSource}</strong>.
    </p>
  `;
}

function renderWsKpis() {
  return `
    <div class="kpi-row">
      <div class="kpi-box">
        <div class="kpi-label">WS sessions OK</div>
        <div class="kpi-value">${fmtOrNA(wsSessionsOk, 0)}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">WS handshake failures</div>
        <div class="kpi-value">${fmtOrNA(wsSessionsFail, 0)}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Avg / p95 / max session (ms)</div>
        <div class="kpi-value">
          ${fmtOrNA(wsSessionDurAvgMs)} / ${fmtOrNA(wsSessionDurP95Ms)} / ${fmtOrNA(wsSessionDurMaxMs)}
        </div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Total WS messages received</div>
        <div class="kpi-value">${fmtOrNA(wsMsgTotal, 0)}</div>
      </div>
      ${
        hasChatRtt
          ? `
      <div class="kpi-box">
        <div class="kpi-label">Chat delivery latency p50 / p95 / p99 (ms)</div>
        <div class="kpi-value">
          ${fmtOrNA(chatRttP50)} / ${fmtOrNA(chatRttP95)} / ${fmtOrNA(chatRttP99)}
        </div>
      </div>`
          : ''
      }
      ${
        chatMessagesSent != null
          ? `
      <div class="kpi-box">
        <div class="kpi-label">Chat messages sent</div>
        <div class="kpi-value">${chatMessagesSent}</div>
      </div>`
          : ''
      }
      ${
        chatTypingSent != null
          ? `
      <div class="kpi-box">
        <div class="kpi-label">Typing events sent</div>
        <div class="kpi-value">${chatTypingSent}</div>
      </div>`
          : ''
      }
      ${
        ws4409
          ? `
      <div class="kpi-box" style="border-left:4px solid #ea4335">
        <div class="kpi-label">⚠ Closed by 4409 (duplicate session)</div>
        <div class="kpi-value">${ws4409}</div>
      </div>`
          : ''
      }
      ${
        ws4401
          ? `
      <div class="kpi-box" style="border-left:4px solid #ea4335">
        <div class="kpi-label">⚠ Closed by 4401 (invalid token)</div>
        <div class="kpi-value">${ws4401}</div>
      </div>`
          : ''
      }
    </div>
    <p class="note">
      WebSocket mode metrics. Sessions OK = handshake 101. Chat delivery latency = time from
      <code>chat.send</code> on one peer to <code>chat.message</code> on the other peer.
    </p>
  `;
}

const kpiBlock = testMode === 'ws' ? renderWsKpis() : renderHttpKpis();

// -----------------------------------------------------------------------------
// CHART BLOCKS
function renderHttpCharts() {
  return `
    <div class="charts-grid">
      <div class="chart-card"><h3>Latency distribution (ms)</h3>
        <p class="note">Response time percentiles. Rising p95/p99 means degraded UX.</p>
        <canvas id="latencyChart"></canvas></div>
      <div class="chart-card"><h3>Requests per second (RPS)</h3>
        <p class="note">A flat line at high VUs may indicate saturation.</p>
        <canvas id="rpsChart"></canvas></div>
      <div class="chart-card"><h3>Pass vs Fail</h3>
        <p class="note">Green = success. Red = 4xx/5xx/timeouts.</p>
        <canvas id="passFailChart"></canvas></div>
      <div class="chart-card"><h3>Low-level timings breakdown</h3>
        <p class="note">HTTP request duration distribution.</p>
        <canvas id="durationChart"></canvas></div>
      <div class="chart-card"><h3>Connection / Send / Wait(TTFB) / Receive</h3>
        <p class="note">Separates backend slowness (Wait/TTFB) from network overhead.</p>
        <canvas id="networkChart"></canvas></div>
      ${
        hasErrorBreakdown
          ? `<div class="chart-card"><h3>Error type breakdown</h3>
        <p class="note">Distinguish app-layer errors (4xx/5xx) from transport problems.</p>
        <canvas id="errorBreakdownChart"></canvas></div>`
          : ''
      }
    </div>
  `;
}

function renderWsCharts() {
  return `
    <div class="charts-grid">
      <div class="chart-card"><h3>Pass vs Fail (sessions)</h3>
        <p class="note">Successful handshakes (101) vs failed.</p>
        <canvas id="passFailChart"></canvas></div>
      <div class="chart-card"><h3>Session duration (ms)</h3>
        <p class="note">Drop in avg or spike in p95 may mean server force-closes clients.</p>
        <canvas id="wsDurationChart"></canvas></div>
      <div class="chart-card"><h3>WS messages received</h3>
        <p class="note">Total messages server pushed to clients.</p>
        <canvas id="wsMsgChart"></canvas></div>
      <div class="chart-card"><h3>Sessions OK vs Failed</h3>
        <p class="note">Overall handshake stability.</p>
        <canvas id="wsSessionChart"></canvas></div>
      ${
        hasChatRtt
          ? `<div class="chart-card"><h3>Chat delivery latency (ms)</h3>
        <p class="note">avg / p50 / p95 / p99 / max — round-trip from sender to peer.</p>
        <canvas id="chatRttChart"></canvas></div>`
          : ''
      }
    </div>
  `;
}

function renderTimelineCharts() {
  if (!hasTimeline) return '';
  return `
    <section>
      <h2>Timeline (per ${BUCKET_SEC}s buckets)</h2>
      <p class="note">
        How the test evolved over time — the moment p95 starts climbing or RPS starts plateauing
        is usually where the system began to degrade.
      </p>
      <div class="charts-grid">
        <div class="chart-card"><h3>Active VUs over time</h3>
          <canvas id="tlVusChart"></canvas></div>
        ${
          testMode === 'http'
            ? `<div class="chart-card"><h3>RPS over time</h3>
          <canvas id="tlRpsChart"></canvas></div>`
            : ''
        }
        <div class="chart-card"><h3>Latency p95 over time (ms)</h3>
          <canvas id="tlLatencyChart"></canvas></div>
        ${
          timeline.some((b) => b.feedLatencyP95 !== null)
            ? `<div class="chart-card"><h3>Feed latency p95 over time (ms)</h3>
          <canvas id="tlFeedChart"></canvas></div>`
            : ''
        }
        ${
          hasChatRtt || timeline.some((b) => b.chatRttP95 !== null)
            ? `<div class="chart-card"><h3>Chat delivery p95 over time (ms)</h3>
          <canvas id="tlChatRttChart"></canvas></div>`
            : ''
        }
        ${
          hasErrorBreakdown
            ? `<div class="chart-card"><h3>Errors over time (counts per bucket)</h3>
          <canvas id="tlErrorsChart"></canvas></div>`
            : ''
        }
      </div>
    </section>
  `;
}

const chartsBlock = testMode === 'ws' ? renderWsCharts() : renderHttpCharts();

// -----------------------------------------------------------------------------
// HTML
const html = `
<html>
<head>
  <title>k6 Load Test Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Inter", Roboto, Arial, sans-serif;
      padding: 2rem; background-color: #fafafa; color: #222; line-height: 1.45; }
    h1, h2, h3 { margin-bottom: 0.5rem; font-weight: 600; color: #111; }
    h1 { font-size: 1.5rem; }
    h2 { font-size: 1.2rem; display: flex; align-items: center; gap: .5rem; }
    h2 svg { width: 1rem; height: 1rem; }
    p.note { color: #555; font-size: 0.9rem; margin-top: 0; margin-bottom: 1.5rem; }
    section { margin-bottom: 2rem; background: #fff; padding: 1.5rem 2rem;
      border-radius: 12px; box-shadow: 0 10px 24px -8px rgba(0,0,0,0.12); }
    table { border-collapse: collapse; width: 100%; margin-top: 2rem; font-size: 0.9rem; }
    th, td { border: 1px solid #ddd; padding: 0.75rem; text-align: left; vertical-align: top; }
    th { background-color: #f4f4f4; font-weight: 600; }
    tr:nth-child(even) { background: #fafafa; }
    .charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 2rem; align-items: flex-start; }
    .chart-card { background: #fff; border-radius: 12px; padding: 1rem 1rem 2rem;
      box-shadow: 0 10px 24px -8px rgba(0,0,0,0.12); }
    canvas { max-width: 100%; height: 260px; }
    .kpi-row { display: flex; flex-wrap: wrap; gap: 1.5rem; margin-top: 1rem; }
    .kpi-box { background: #fff; border-radius: 12px; box-shadow: 0 10px 24px -8px rgba(0,0,0,0.12);
      padding: 1rem 1.25rem; min-width: 220px; flex: 0 0 auto; }
    .kpi-label { font-size: 0.7rem; color: #666; text-transform: uppercase;
      margin-bottom: 0.4rem; letter-spacing: .03em; font-weight: 500; }
    .kpi-value { font-size: 1.1rem; font-weight: 600; color: #111; }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; }
    .meta-box { background: #fff; border-radius: 12px; box-shadow: 0 10px 24px -8px rgba(0,0,0,0.12);
      padding: 1rem 1.25rem; font-size: .9rem; line-height: 1.4; }
    .meta-label { font-size: .7rem; letter-spacing: .03em; text-transform: uppercase;
      color: #666; font-weight: 500; margin-bottom: .25rem; }
    .meta-value { font-weight: 600; color: #111; word-break: break-all; }
    .verdict-pill { display: inline-block; padding: .35rem .8rem; border-radius: 999px;
      font-weight: 600; font-size: .85rem; }
    .verdict-pass { background: #d4f5dc; color: #14532d; }
    .verdict-fail { background: #ffe1e0; color: #7f1d1d; }
  </style>
</head>
<body>
  <h1>k6 Load Test Report</h1>
  <p class="note">
    Auto-generated from k6 <code>summary.json</code>. Use these metrics for capacity / stress analysis,
    SLA validation and regression tracking.
  </p>

  <section>
    <h2>Test metadata</h2>
    <div class="meta-grid">
      <div class="meta-box"><div class="meta-label">Test file executed</div>
        <div class="meta-value">${testFileName}</div></div>
      <div class="meta-box"><div class="meta-label">Run timestamp</div>
        <div class="meta-value">${runTimestamp}</div></div>
      <div class="meta-box"><div class="meta-label">Max VUs observed</div>
        <div class="meta-value">${vusMaxResolved}</div></div>
      <div class="meta-box"><div class="meta-label">Threshold verdict</div>
        <div class="meta-value">
          <span class="verdict-pill ${verdictPass ? 'verdict-pass' : 'verdict-fail'}">
            ${verdictPass ? '✅ PASS' : '❌ FAIL'} (${verdict.totalPass}/${verdict.totalChecks})
          </span>
        </div></div>
    </div>
  </section>

  <section>
    <h2>High-level KPIs</h2>
    ${kpiBlock}
  </section>

  <section>
    <h2>Core performance visuals</h2>
    ${chartsBlock}
  </section>

  ${renderTimelineCharts()}

  <section>
    <h2>Threshold breakdown</h2>
    <table>
      <thead><tr><th>Metric</th><th>Threshold</th><th>Result</th></tr></thead>
      <tbody>
        ${
          verdict.items.length === 0
            ? '<tr><td colspan="3"><em>No thresholds defined.</em></td></tr>'
            : verdict.items
                .map(
                  (i) => `<tr>
                    <td>${i.metric}</td>
                    <td><code>${i.name}</code></td>
                    <td>${i.passed ? '✅ pass' : '❌ fail'}</td>
                  </tr>`
                )
                .join('')
        }
      </tbody>
    </table>
  </section>

  <section>
    <h2>Raw metrics table</h2>
    <table>
      <thead><tr><th>Metric</th><th>Value</th></tr></thead>
      <tbody>
        ${Object.entries(summary.metrics)
          .sort(([a], [b]) => (LABELS[a] || a).localeCompare(LABELS[b] || b))
          .map(
            ([k, v]) => `
              <tr>
                <td>${LABELS[k] || k}</td>
                <td>${String(formatValue(v?.value ?? v, k)).replace(/\n/g, '<br>')}</td>
              </tr>`
          )
          .join('')}
      </tbody>
    </table>
  </section>

  <script>
    new Chart(document.getElementById('passFailChart'), {
      type: 'pie',
      data: {
        labels: ['Passed', 'Failed'],
        datasets: [{
          data: [${passCountFinal ?? 0}, ${failCountFinal ?? 0}],
          backgroundColor: ['#34a853', '#ea4335']
        }]
      },
      options: { plugins: { legend: { position: 'top' } } }
    });

    ${
      testMode !== 'ws'
        ? `
      new Chart(document.getElementById('latencyChart'), {
        type: 'bar',
        data: {
          labels: ['p50', 'p95', 'p99'],
          datasets: [{
            data: [
              ${latencyP50 !== null ? latencyP50.toFixed(2) : 'null'},
              ${latencyP95 !== null ? latencyP95.toFixed(2) : 'null'},
              ${latencyP99 !== null ? latencyP99.toFixed(2) : 'null'}
            ],
            backgroundColor: '#007acc'
          }]
        },
        options: { plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { callback: v => v + ' ms' } } } }
      });

      new Chart(document.getElementById('rpsChart'), {
        type: 'bar',
        data: { labels: ['Avg RPS'], datasets: [{
          data: [${rpsAvg !== null ? rpsAvg.toFixed(2) : 'null'}],
          backgroundColor: '#4b9c5a'
        }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      });

      const durationData = ${JSON.stringify(durationChartData.series)};
      new Chart(document.getElementById('durationChart'), {
        type: 'bar',
        data: {
          labels: ${JSON.stringify(durationChartData.labels)},
          datasets: [{
            label: 'Total Request Duration (ms)',
            data: [durationData.avg, durationData.min, durationData.max,
                   durationData['p(90)'], durationData['p(95)']],
            backgroundColor: '#007acc'
          }]
        },
        options: { plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { callback: v => v + ' ms' } } } }
      });

      new Chart(document.getElementById('networkChart'), {
        type: 'bar',
        data: {
          labels: ['Connect', 'Send', 'Wait (TTFB)', 'Receive'],
          datasets: [{
            label: 'Avg timing (ms)',
            data: [${connectMetric.avg ?? 'null'}, ${sendMetric.avg ?? 'null'},
                   ${waitMetric.avg ?? 'null'}, ${receiveMetric.avg ?? 'null'}],
            backgroundColor: '#8e5af7'
          }]
        },
        options: { plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { callback: v => v + ' ms' } } } }
      });

      ${
        hasErrorBreakdown
          ? `
      new Chart(document.getElementById('errorBreakdownChart'), {
        type: 'doughnut',
        data: {
          labels: ['4xx', '5xx', 'Network'],
          datasets: [{ data: [${err4xxCount}, ${err5xxCount}, ${errNetCount}],
            backgroundColor: ['#f59e0b', '#ea4335', '#6b7280'] }]
        },
        options: { plugins: { legend: { position: 'top' } } }
      });`
          : ''
      }
    `
        : ''
    }

    ${
      testMode === 'ws'
        ? `
      new Chart(document.getElementById('wsDurationChart'), {
        type: 'bar',
        data: {
          labels: ['Avg ms', 'p95 ms', 'Max ms'],
          datasets: [{
            data: [${wsSessionDurAvgMs ?? 'null'}, ${wsSessionDurP95Ms ?? 'null'}, ${wsSessionDurMaxMs ?? 'null'}],
            backgroundColor: '#007acc'
          }]
        },
        options: { plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { callback: v => v + ' ms' } } } }
      });

      new Chart(document.getElementById('wsMsgChart'), {
        type: 'bar',
        data: { labels: ['Total messages received'],
          datasets: [{ data: [${wsMsgTotal ?? 0}], backgroundColor: '#4b9c5a' }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      });

      new Chart(document.getElementById('wsSessionChart'), {
        type: 'bar',
        data: { labels: ['Sessions OK', 'Handshake Failed'],
          datasets: [{ data: [${wsSessionsOk ?? 0}, ${wsSessionsFail ?? 0}],
            backgroundColor: ['#34a853', '#ea4335'] }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      });

      ${
        hasChatRtt
          ? `
      new Chart(document.getElementById('chatRttChart'), {
        type: 'bar',
        data: {
          labels: ['avg', 'p50', 'p95', 'p99', 'max'],
          datasets: [{
            data: [${chatRttAvg ?? 'null'}, ${chatRttP50 ?? 'null'}, ${chatRttP95 ?? 'null'}, ${chatRttP99 ?? 'null'}, ${chatRttMax ?? 'null'}],
            backgroundColor: '#8e5af7'
          }]
        },
        options: { plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { callback: v => v + ' ms' } } } }
      });`
          : ''
      }
    `
        : ''
    }

    ${
      hasTimeline
        ? `
      const tl = ${JSON.stringify(timeline)};
      const tlLabels = tl.map(b => b.t + 's');

      new Chart(document.getElementById('tlVusChart'), {
        type: 'line',
        data: { labels: tlLabels, datasets: [{ label: 'VUs', data: tl.map(b => b.vus),
          borderColor: '#007acc', tension: 0.2, fill: false }] },
        options: { plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } } }
      });

      ${
        testMode === 'http'
          ? `
      new Chart(document.getElementById('tlRpsChart'), {
        type: 'line',
        data: { labels: tlLabels, datasets: [{ label: 'RPS', data: tl.map(b => b.rps),
          borderColor: '#4b9c5a', tension: 0.2, fill: false }] },
        options: { plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } } }
      });`
          : ''
      }

      new Chart(document.getElementById('tlLatencyChart'), {
        type: 'line',
        data: { labels: tlLabels, datasets: [{ label: 'p95 latency (ms)',
          data: tl.map(b => b.p95), borderColor: '#ea4335', tension: 0.2, fill: false }] },
        options: { plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { callback: v => v + ' ms' } } } }
      });

      ${
        timeline.some((b) => b.feedLatencyP95 !== null)
          ? `
      new Chart(document.getElementById('tlFeedChart'), {
        type: 'line',
        data: { labels: tlLabels, datasets: [{ label: 'Feed latency p95 (ms)',
          data: tl.map(b => b.feedLatencyP95), borderColor: '#0ea5e9', tension: 0.2, fill: false }] },
        options: { plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { callback: v => v + ' ms' } } } }
      });`
          : ''
      }

      ${
        timeline.some((b) => b.chatRttP95 !== null)
          ? `
      new Chart(document.getElementById('tlChatRttChart'), {
        type: 'line',
        data: { labels: tlLabels, datasets: [{ label: 'Chat delivery p95 (ms)',
          data: tl.map(b => b.chatRttP95), borderColor: '#8e5af7', tension: 0.2, fill: false }] },
        options: { plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { callback: v => v + ' ms' } } } }
      });`
          : ''
      }

      ${
        hasErrorBreakdown
          ? `
      new Chart(document.getElementById('tlErrorsChart'), {
        type: 'line',
        data: { labels: tlLabels, datasets: [
          { label: '4xx', data: tl.map(b => b.errors4xx), borderColor: '#f59e0b', tension: 0.2, fill: false },
          { label: '5xx', data: tl.map(b => b.errors5xx), borderColor: '#ea4335', tension: 0.2, fill: false },
          { label: 'network', data: tl.map(b => b.errorsNet), borderColor: '#6b7280', tension: 0.2, fill: false }
        ] },
        options: { scales: { y: { beginAtZero: true } } }
      });`
          : ''
      }
    `
        : ''
    }
  </script>
</body>
</html>
`;

// -----------------------------------------------------------------------------
// MARKDOWN SUMMARY
function renderMarkdownSummary() {
  const lines = [];
  lines.push(`# k6 run: ${testFileName}`);
  lines.push('');
  lines.push(`- **Timestamp**: ${runTimestamp}`);
  lines.push(`- **Max VUs**: ${vusMaxResolved}`);
  lines.push(
    `- **Verdict**: ${verdictPass ? '✅ PASS' : '❌ FAIL'} (${verdict.totalPass}/${verdict.totalChecks} thresholds)`
  );
  lines.push('');
  if (testMode === 'http') {
    lines.push('## HTTP');
    lines.push(`- Total requests: ${fmtOrNA(totalRequests, 0)}`);
    lines.push(`- Avg RPS: ${fmtOrNA(rpsAvg)}`);
    lines.push(
      `- Latency p50/p95/p99: ${fmtOrNA(latencyP50)} / ${fmtOrNA(latencyP95)} / ${fmtOrNA(latencyP99)} ms`
    );
    lines.push(
      `- Pass / Fail: ${fmtOrNA(passCountFinal, 0)} / ${fmtOrNA(failCountFinal, 0)}`
    );
    if (hasErrorBreakdown) {
      lines.push(
        `- Error breakdown: 4xx=${err4xxCount}, 5xx=${err5xxCount}, network=${errNetCount}`
      );
    }
  } else if (testMode === 'ws') {
    lines.push('## WebSocket');
    lines.push(`- Sessions OK: ${fmtOrNA(wsSessionsOk, 0)}`);
    lines.push(`- Handshake failures: ${fmtOrNA(wsSessionsFail, 0)}`);
    lines.push(
      `- Session duration avg/p95/max (ms): ${fmtOrNA(wsSessionDurAvgMs)} / ${fmtOrNA(wsSessionDurP95Ms)} / ${fmtOrNA(wsSessionDurMaxMs)}`
    );
    lines.push(`- Messages received: ${fmtOrNA(wsMsgTotal, 0)}`);
    if (hasChatRtt) {
      lines.push(
        `- Chat delivery latency p50/p95/p99 (ms): ${fmtOrNA(chatRttP50)} / ${fmtOrNA(chatRttP95)} / ${fmtOrNA(chatRttP99)}`
      );
      lines.push(`- Chat messages sent: ${chatMessagesSent ?? 'n/a'}`);
    }
    if (ws4409) lines.push(`- ⚠ Closed by 4409 (duplicate session): ${ws4409}`);
    if (ws4401) lines.push(`- ⚠ Closed by 4401 (invalid token): ${ws4401}`);
  }
  lines.push('');
  if (verdict.items.length > 0) {
    lines.push('## Threshold details');
    for (const i of verdict.items) {
      lines.push(
        `- ${i.passed ? '✅' : '❌'} \`${i.metric}\`: \`${i.name}\``
      );
    }
  }
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// WRITE OUTPUTS
fs.writeFileSync(`${baseOut}.html`, html);
console.log(`✅ HTML report written to ${baseOut}.html`);

const csv = [
  'Metric,Value',
  ...Object.entries(summary.metrics)
    .sort(([a], [b]) => (LABELS[a] || a).localeCompare(LABELS[b] || b))
    .map(
      ([k, v]) =>
        `"${LABELS[k] || k}","${String(formatValue(v?.value ?? v, k)).replace(/\n/g, ' | ')}"`
    ),
].join('\n');
fs.writeFileSync(`${baseOut}.csv`, csv);
console.log(`✅ CSV report written to ${baseOut}.csv`);

fs.writeFileSync(`${baseOut}.md`, renderMarkdownSummary());
console.log(`✅ Markdown summary written to ${baseOut}.md`);
