// Build/refresh a comparison index for all k6 runs in a given reports subfolder.
//
// Scans <reportsRoot>/*/summary.json + meta.json, extracts headline KPIs,
// and writes a single index.html — sorted newest-first, with sortable columns
// and a filter input — so you can eyeball regressions and find a specific run
// without opening each one.
//
// Usage: node tools/k6-compare-index.mjs <reportsRoot> [appName]
//   reportsRoot: e.g. load-tests/reports/Shimy
//   appName    : optional human label shown in the heading (e.g. "Shimy")

import fs from 'fs';
import path from 'path';

const reportsRoot = process.argv[2];
const appName = process.argv[3] || 'k6';

if (!reportsRoot) {
  console.error('❌ Usage: node tools/k6-compare-index.mjs <reportsRoot> [appName]');
  process.exit(1);
}

if (!fs.existsSync(reportsRoot)) {
  console.error(`❌ Reports root does not exist: ${reportsRoot}`);
  process.exit(1);
}

const fmt = (v, digits = 2) =>
  v === null || v === undefined ? '—' : typeof v === 'number' ? v.toFixed(digits) : String(v);

// "20260503_235134" → "2026-05-03 23:51". Falls back to original if format
// doesn't match (e.g. a manual subfolder).
function prettyDate(ts) {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/.exec(ts);
  if (!m) return ts;
  const [, y, mo, d, h, mi] = m;
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

// Strip the "shimy/" prefix and ".js" suffix to keep the column tight.
function shortTestName(testFile) {
  if (!testFile) return '—';
  return testFile.replace(/^.*\//, '').replace(/\.js$/, '');
}

const runs = [];
for (const entry of fs.readdirSync(reportsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const summaryPath = path.join(reportsRoot, entry.name, 'summary.json');
  const metaPath = path.join(reportsRoot, entry.name, 'meta.json');
  const mdPath = path.join(reportsRoot, entry.name, 'summary.md');
  if (!fs.existsSync(summaryPath)) continue;

  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  } catch (_) {
    continue;
  }

  // meta.json is best-effort — older runs (pre-fix) won't have it.
  let meta = null;
  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (_) {}
  }

  const m = summary.metrics || {};
  const total = m.http_reqs?.count ?? null;
  const rps = m.http_reqs?.rate ?? null;
  const p95 =
    m.http_req_duration?.['p(95)'] ??
    m.http_req_duration?.values?.['p(95)'] ??
    null;
  // k6 stores failure rate under .value for Rate metrics in --summary-export
  // output, and under .rate in some streamed formats. Try both.
  const failRate =
    m.http_req_failed?.value ??
    m.http_req_failed?.rate ??
    null;

  const wsOk = m.socket_sessions_ok?.count ?? null;
  const wsFail = m.socket_connection_failures?.count ?? null;
  const chatP95 =
    m.chat_delivery_latency_ms?.['p(95)'] ??
    m.chat_delivery_latency_ms?.values?.['p(95)'] ??
    null;

  const maxVus = m.vus_max?.value ?? m.vus_max?.max ?? null;

  // Threshold verdict
  let totalChecks = 0;
  let totalPass = 0;
  for (const metric of Object.values(m)) {
    if (!metric || !metric.thresholds) continue;
    for (const t of Object.values(metric.thresholds)) {
      totalChecks += 1;
      // k6 stores boolean — false means threshold NOT breached (passed).
      const passed =
        typeof t === 'boolean'
          ? !t
          : t.ok === true || (t.ok === undefined && !t.fails);
      if (passed) totalPass += 1;
    }
  }
  const verdict =
    totalChecks === 0
      ? 'no thresholds'
      : totalPass === totalChecks
      ? 'PASS'
      : 'FAIL';

  runs.push({
    timestamp: entry.name,
    relPath: entry.name,
    hasMd: fs.existsSync(mdPath),
    testFile: meta?.testFile || null,
    profile: meta?.profile || null,
    mode: meta?.mode || null,
    timelineEnabled: meta?.timelineEnabled ? true : false,
    maxVus,
    total,
    rps,
    p95,
    failRate,
    wsOk,
    wsFail,
    chatP95,
    verdict,
    totalPass,
    totalChecks,
  });
}

runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

// Build a JSON snapshot the page-side script uses for sort/filter.
const runsForJs = runs.map((r) => ({
  timestamp: r.timestamp,
  prettyTs: prettyDate(r.timestamp),
  relPath: r.relPath,
  hasMd: r.hasMd,
  testFile: shortTestName(r.testFile),
  profile: r.profile || '',
  mode: r.mode || '',
  timeline: r.timelineEnabled,
  maxVus: r.maxVus,
  total: r.total,
  rps: r.rps,
  p95: r.p95,
  failRate: r.failRate,
  wsOk: r.wsOk,
  wsFail: r.wsFail,
  chatP95: r.chatP95,
  verdict: r.verdict,
  totalPass: r.totalPass,
  totalChecks: r.totalChecks,
}));

const html = `<html>
<head>
  <title>${appName} — k6 runs</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Inter", Roboto, Arial, sans-serif;
      padding: 2rem; background-color: #fafafa; color: #222; }
    h1 { font-size: 1.4rem; margin-bottom: .25rem; }
    p.note { color: #555; margin-top: 0; margin-bottom: 1.5rem; font-size: .9rem; }
    .toolbar { display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
    .toolbar input[type="search"] {
      padding: .5rem .75rem; border: 1px solid #ccc; border-radius: 8px;
      font-size: .9rem; width: 280px; outline: none;
    }
    .toolbar input[type="search"]:focus { border-color: #007acc; }
    .toolbar .count { color: #666; font-size: .85rem; }
    table { border-collapse: collapse; width: 100%; font-size: .9rem; background: #fff;
      box-shadow: 0 10px 24px -8px rgba(0,0,0,0.12); border-radius: 12px; overflow: hidden; }
    th, td { border-bottom: 1px solid #eee; padding: .65rem .9rem; text-align: left; vertical-align: top; }
    th {
      background: #f4f4f4; font-weight: 600;
      cursor: pointer; user-select: none; white-space: nowrap;
    }
    th:hover { background: #ececec; }
    th .arrow { font-size: .7rem; color: #888; margin-left: .25rem; }
    tr:hover td { background: #fafafa; }
    a { color: #007acc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .md-link { color: #888; font-size: .8rem; }
    .verdict-pill { display: inline-block; padding: .2rem .6rem; border-radius: 999px;
      font-weight: 600; font-size: .75rem; }
    .verdict-pass { background: #d4f5dc; color: #14532d; }
    .verdict-fail { background: #ffe1e0; color: #7f1d1d; }
    .verdict-na { background: #eee; color: #555; }
    .pill {
      display: inline-block; padding: .15rem .5rem; border-radius: 6px;
      font-size: .72rem; font-weight: 500; background: #eef3fa; color: #1d4ed8;
    }
    .pill-mode { background: #f3e8ff; color: #6b21a8; }
    .pill-tl { background: #fff7ed; color: #9a3412; }
    .test-cell { display: flex; flex-direction: column; gap: .25rem; }
    .test-cell .file { font-weight: 600; color: #111; }
    .test-cell .pills { display: flex; gap: .35rem; flex-wrap: wrap; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .empty { color: #aaa; }

    /* Group view */
    .group-header td {
      background: #f9fbfe; cursor: pointer; font-weight: 500;
      padding: .55rem .9rem;
    }
    .group-header td:hover { background: #eff5fc; }
    .group-header .caret {
      color: #666; margin-right: .4rem; display: inline-block;
      width: .9rem; font-size: .75rem;
    }
    .group-header .group-name {
      font-weight: 600; color: #111; margin-right: .75rem;
    }
    .group-header .group-meta {
      color: #555; font-size: .82rem;
    }
    .group-header .group-meta .verdict-pill {
      margin-right: .25rem; font-size: .68rem; padding: .1rem .45rem;
    }
    .group-row td:first-child { padding-left: 2.2rem; }

    /* Toolbar additions */
    .toolbar label.toggle {
      font-size: .85rem; color: #333; cursor: pointer; user-select: none;
      display: inline-flex; align-items: center; gap: .35rem;
    }
    .toolbar button {
      padding: .4rem .75rem; border: 1px solid #ccc; border-radius: 6px;
      background: white; cursor: pointer; font-size: .82rem; color: #333;
    }
    .toolbar button:hover { background: #f4f4f4; }
    .toolbar button:disabled { opacity: .5; cursor: not-allowed; }
    .toolbar .group-buttons { display: flex; gap: .35rem; }
  </style>
</head>
<body>
  <h1>${appName} — k6 runs (${runs.length})</h1>
  <p class="note">
    Generated ${new Date().toISOString()}. Click a column header to sort. Filter searches
    test file / profile / mode / verdict / timestamp.
  </p>

  <div class="toolbar">
    <input type="search" id="filter" placeholder="Filter (e.g. shimyFeed, stress, FAIL)…" />
    <label class="toggle"><input type="checkbox" id="groupToggle" /> Group by test</label>
    <span class="group-buttons">
      <button id="expandAll" type="button">Expand all</button>
      <button id="collapseAll" type="button">Collapse all</button>
    </span>
    <span class="count" id="count"></span>
  </div>

  <table id="runsTable">
    <thead>
      <tr>
        <th data-key="timestamp">When <span class="arrow">▼</span></th>
        <th data-key="testFile">Test</th>
        <th data-key="verdict">Verdict</th>
        <th data-key="maxVus" class="num">VUs</th>
        <th data-key="rps" class="num">RPS</th>
        <th data-key="total" class="num">Total reqs</th>
        <th data-key="p95" class="num">p95 (ms)</th>
        <th data-key="failRate" class="num">Fail %</th>
        <th data-key="wsOk" class="num">WS ok / fail</th>
        <th data-key="chatP95" class="num">Chat p95 (ms)</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>

  <script>
    const RUNS = ${JSON.stringify(runsForJs)};
    const COLSPAN = 10;

    // Persisted UI state ----------------------------------------------------
    const LS_GROUP = 'k6-compare:groupMode';
    const LS_EXPANDED = 'k6-compare:expandedGroups';

    let sortKey = 'timestamp';
    let sortDir = 'desc';
    let filterText = '';
    let groupMode = localStorage.getItem(LS_GROUP) === '1';
    let expandedGroups = new Set(JSON.parse(localStorage.getItem(LS_EXPANDED) || '[]'));

    function persistGroupMode() {
      localStorage.setItem(LS_GROUP, groupMode ? '1' : '0');
    }
    function persistExpanded() {
      localStorage.setItem(LS_EXPANDED, JSON.stringify([...expandedGroups]));
    }

    // Helpers ---------------------------------------------------------------
    function compareValues(a, b, key) {
      const va = a[key];
      const vb = b[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return va - vb;
      return String(va).localeCompare(String(vb));
    }

    function rowMatches(r, q) {
      if (!q) return true;
      const hay = [r.timestamp, r.prettyTs, r.testFile, r.profile, r.mode, r.verdict]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q.toLowerCase());
    }

    function fmt(v, digits) {
      if (v === null || v === undefined) return '<span class="empty">—</span>';
      if (typeof v === 'number') return v.toFixed(digits ?? 2);
      return String(v);
    }
    function fmtPct(v) {
      if (v === null || v === undefined) return '<span class="empty">—</span>';
      return (v * 100).toFixed(2) + '%';
    }

    function groupKeyOf(r) {
      if (!r.testFile) return '__unknown__';
      return [r.testFile, r.profile || '', r.mode || ''].join('|');
    }
    function groupDisplayName(r) {
      if (!r.testFile) return '(unknown test)';
      const parts = [r.testFile];
      if (r.profile) parts.push(r.profile);
      if (r.mode) parts.push(r.mode);
      return parts.join(' / ');
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
      }[c]));
    }

    function rowHtml(r, extraClass) {
      const verdictClass =
        r.verdict === 'PASS' ? 'verdict-pass' :
        r.verdict === 'FAIL' ? 'verdict-fail' : 'verdict-na';
      const verdictText =
        r.totalChecks ? r.verdict + ' ' + r.totalPass + '/' + r.totalChecks : r.verdict;

      const pills = [];
      if (r.profile) pills.push('<span class="pill">' + escapeHtml(r.profile) + '</span>');
      if (r.mode)    pills.push('<span class="pill pill-mode">' + escapeHtml(r.mode) + '</span>');
      if (r.timeline) pills.push('<span class="pill pill-tl">timeline</span>');

      return '<tr' + (extraClass ? ' class="' + extraClass + '"' : '') + '>' +
        '<td>' +
          '<a href="' + r.relPath + '/summary.html">' + r.prettyTs + '</a>' +
          (r.hasMd ? ' <a class="md-link" href="' + r.relPath + '/summary.md">md</a>' : '') +
        '</td>' +
        '<td><div class="test-cell">' +
          '<span class="file">' + (r.testFile || '<span class="empty">—</span>') + '</span>' +
          (pills.length ? '<span class="pills">' + pills.join('') + '</span>' : '') +
        '</div></td>' +
        '<td><span class="verdict-pill ' + verdictClass + '">' + verdictText + '</span></td>' +
        '<td class="num">' + fmt(r.maxVus, 0) + '</td>' +
        '<td class="num">' + fmt(r.rps) + '</td>' +
        '<td class="num">' + fmt(r.total, 0) + '</td>' +
        '<td class="num">' + fmt(r.p95) + '</td>' +
        '<td class="num">' + fmtPct(r.failRate) + '</td>' +
        '<td class="num">' + fmt(r.wsOk, 0) + ' / ' + fmt(r.wsFail, 0) + '</td>' +
        '<td class="num">' + fmt(r.chatP95) + '</td>' +
      '</tr>';
    }

    // Renderers -------------------------------------------------------------
    function renderFlat(filtered) {
      filtered.sort((a, b) => {
        const c = compareValues(a, b, sortKey);
        return sortDir === 'desc' ? -c : c;
      });
      return filtered.map(r => rowHtml(r)).join('');
    }

    function renderGrouped(filtered) {
      // Bucket runs by group key.
      const groups = new Map();
      for (const r of filtered) {
        const key = groupKeyOf(r);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }

      // Sort groups by their newest run (newest-first).
      const sortedGroups = [...groups.entries()].sort(
        ([, ra], [, rb]) => rb[0].timestamp.localeCompare(ra[0].timestamp)
      );

      // When a filter is active, show all matching groups expanded for the
      // duration of the render — without mutating expandedGroups. That way
      // clearing the filter restores the user's manual choices.
      const effectiveOpen = filterText
        ? new Set(groups.keys())
        : expandedGroups;

      return sortedGroups.map(([key, gRuns]) => {
        gRuns.sort((a, b) => {
          const c = compareValues(a, b, sortKey);
          return sortDir === 'desc' ? -c : c;
        });
        const expanded = effectiveOpen.has(key);

        const passCount = gRuns.filter(r => r.verdict === 'PASS').length;
        const failCount = gRuns.filter(r => r.verdict === 'FAIL').length;
        const naCount = gRuns.length - passCount - failCount;
        const lastRun = gRuns.reduce(
          (acc, r) => (r.timestamp > acc.timestamp ? r : acc),
          gRuns[0]
        );

        const verdictPills = [
          passCount > 0 ? '<span class="verdict-pill verdict-pass">' + passCount + ' pass</span>' : '',
          failCount > 0 ? '<span class="verdict-pill verdict-fail">' + failCount + ' fail</span>' : '',
          naCount > 0 ? '<span class="verdict-pill verdict-na">' + naCount + ' n/a</span>' : '',
        ].filter(Boolean).join(' ');

        const header = '<tr class="group-header" data-group="' + escapeHtml(key) + '">' +
          '<td colspan="' + COLSPAN + '">' +
            '<span class="caret">' + (expanded ? '▼' : '▶') + '</span>' +
            '<span class="group-name">' + escapeHtml(groupDisplayName(gRuns[0])) + '</span>' +
            '<span class="group-meta">' +
              gRuns.length + ' run' + (gRuns.length === 1 ? '' : 's') + ' · ' +
              verdictPills +
              (verdictPills ? ' · ' : '') +
              'last: ' + lastRun.prettyTs +
            '</span>' +
          '</td>' +
        '</tr>';

        const rows = expanded ? gRuns.map(r => rowHtml(r, 'group-row')).join('') : '';
        return header + rows;
      }).join('');
    }

    // Main render -----------------------------------------------------------
    function render() {
      const filtered = RUNS.filter(r => rowMatches(r, filterText));

      const tbody = document.getElementById('tbody');
      tbody.innerHTML = groupMode
        ? renderGrouped(filtered)
        : renderFlat(filtered);

      document.getElementById('count').textContent =
        filtered.length === RUNS.length
          ? RUNS.length + ' run' + (RUNS.length === 1 ? '' : 's')
          : filtered.length + ' / ' + RUNS.length + ' runs';

      // Sort arrows.
      document.querySelectorAll('th').forEach(th => {
        const arrow = th.querySelector('.arrow');
        if (arrow) arrow.remove();
        if (th.dataset.key === sortKey) {
          const span = document.createElement('span');
          span.className = 'arrow';
          span.textContent = sortDir === 'desc' ? '▼' : '▲';
          th.appendChild(span);
        }
      });

      // Wire up group-header clicks (delegation: re-bind after each render).
      tbody.querySelectorAll('.group-header').forEach(tr => {
        tr.addEventListener('click', () => {
          const key = tr.dataset.group;
          // While a filter is active, we override expansion implicitly. Don't
          // surprise the user by rewriting their saved state in that mode.
          if (filterText) return;
          if (expandedGroups.has(key)) expandedGroups.delete(key);
          else expandedGroups.add(key);
          persistExpanded();
          render();
        });
      });

      // Reflect current state in the toolbar widgets.
      document.getElementById('groupToggle').checked = groupMode;
      const expandBtn = document.getElementById('expandAll');
      const collapseBtn = document.getElementById('collapseAll');
      const groupBtnsEnabled = groupMode && !filterText;
      expandBtn.disabled = !groupBtnsEnabled;
      collapseBtn.disabled = !groupBtnsEnabled;
    }

    // Wiring ----------------------------------------------------------------
    document.querySelectorAll('th').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.key;
        if (!key) return;
        if (sortKey === key) {
          sortDir = sortDir === 'desc' ? 'asc' : 'desc';
        } else {
          sortKey = key;
          sortDir = key === 'timestamp' ? 'desc' : 'asc';
        }
        render();
      });
    });

    document.getElementById('filter').addEventListener('input', (e) => {
      filterText = e.target.value;
      render();
    });

    document.getElementById('groupToggle').addEventListener('change', (e) => {
      groupMode = e.target.checked;
      persistGroupMode();
      render();
    });

    document.getElementById('expandAll').addEventListener('click', () => {
      const allKeys = new Set(RUNS.map(groupKeyOf));
      expandedGroups = allKeys;
      persistExpanded();
      render();
    });

    document.getElementById('collapseAll').addEventListener('click', () => {
      expandedGroups = new Set();
      persistExpanded();
      render();
    });

    render();
  </script>
</body>
</html>`;

const outPath = path.join(reportsRoot, 'index.html');
fs.writeFileSync(outPath, html);
console.log(`✅ Comparison index written to ${outPath} (${runs.length} runs)`);
