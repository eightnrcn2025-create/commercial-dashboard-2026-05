// ============== 工具 ==============
const fmt = n => (n == null || n === '') ? '-' : (typeof n === 'number' ? n.toLocaleString('zh-CN', {maximumFractionDigits: 2}) : n);
const fmtPct = n => (n == null) ? '-' : (n*100).toFixed(1) + '%';

// 刷新按钮 — 优先走 GitHub Actions 远程触发新抓取；没配 PAT 时退回直接重载
const refreshBtn = document.getElementById('refresh-btn');

async function triggerGithubWorkflow(cfg, btnSpan) {
  // 1. 调 workflow_dispatch
  const dispatchRes = await fetch(`https://api.github.com/repos/${cfg.REPO}/actions/workflows/${cfg.WORKFLOW_FILE}/dispatches`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.GITHUB_PAT}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (!dispatchRes.ok) throw new Error(`触发失败 HTTP ${dispatchRes.status}`);

  // 2. 轮询：等 workflow 启动 + 跑完
  btnSpan.textContent = '远程抓数据中';
  const triggerTime = Date.now();
  let runId = null;
  // 等启动（最多 30 秒）
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const runs = await fetch(`https://api.github.com/repos/${cfg.REPO}/actions/workflows/${cfg.WORKFLOW_FILE}/runs?per_page=5`, {
      headers: { 'Authorization': `Bearer ${cfg.GITHUB_PAT}` }
    }).then(r => r.json());
    const latest = (runs.workflow_runs || []).find(r => new Date(r.created_at).getTime() >= triggerTime - 5000);
    if (latest) { runId = latest.id; break; }
  }
  if (!runId) throw new Error('workflow 没在 30 秒内启动（runner 可能没在线）');

  // 等完成（最多 6 分钟）
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 6000));
    const run = await fetch(`https://api.github.com/repos/${cfg.REPO}/actions/runs/${runId}`, {
      headers: { 'Authorization': `Bearer ${cfg.GITHUB_PAT}` }
    }).then(r => r.json());
    btnSpan.textContent = `远程跑中 (${run.status || '...'})`;
    if (run.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`workflow 失败: ${run.conclusion}`);
      // 3. 等 Pages 重建 (约 45 秒)
      btnSpan.textContent = '等 Pages 重建';
      await new Promise(r => setTimeout(r, 50000));
      return true;
    }
  }
  throw new Error('workflow 超过 6 分钟没完成');
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.classList.add('spinning');
    const span = refreshBtn.querySelector('span');
    span.textContent = '加载中';
    const cfg = (typeof REFRESH_CONFIG !== 'undefined' && REFRESH_CONFIG.GITHUB_PAT) ? REFRESH_CONFIG : null;
    if (cfg) {
      try {
        await triggerGithubWorkflow(cfg, span);
      } catch (e) {
        console.error('refresh', e);
        alert('远程触发失败：' + e.message + '\n\n回退到普通刷新');
      }
    }
    // 无论触发成功还是没配 PAT，最后强制 reload 拿最新
    location.href = location.pathname + '?t=' + Date.now() + location.hash;
  });
}

// 数据时间戳显示 + 相对时间
function updateSnapshotDisplay() {
  if (typeof SNAPSHOT_AT === 'undefined') return;
  const snap = new Date(SNAPSHOT_AT);
  const now = new Date();
  const diffMs = now - snap;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  // 绝对时间显示
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('snapshot-time').textContent =
    `${snap.getFullYear()}-${pad(snap.getMonth()+1)}-${pad(snap.getDate())} ${pad(snap.getHours())}:${pad(snap.getMinutes())}`;

  // 相对时间 + 颜色等级
  const rel = document.getElementById('snapshot-rel');
  rel.classList.remove('warn', 'stale');
  let text;
  if (diffMin < 2) text = '· 刚刚更新';
  else if (diffMin < 60) text = `· ${diffMin} 分钟前`;
  else if (diffHr < 24) { text = `· ${diffHr} 小时前`; if (diffHr >= 4) rel.classList.add('warn'); }
  else { text = `· ${diffDay} 天前`; rel.classList.add('stale'); }
  rel.textContent = text;
}
updateSnapshotDisplay();
setInterval(updateSnapshotDisplay, 60000); // 每分钟刷新相对时间

// 切 tab
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    const tab = t.dataset.tab;
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
    document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x.id === 'panel-' + tab));
    // 重新触发 resize（ECharts 在隐藏时不会绘制）
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  });
});

// 排序表
function renderTable(el, headers, rows, formats) {
  el.innerHTML = '';
  const thead = el.createTHead().insertRow();
  headers.forEach((h, i) => {
    const th = document.createElement('th');
    th.textContent = h;
    th.classList.add('sortable');
    th.dataset.col = i;
    th.addEventListener('click', () => sortTable(el, i, formats));
    thead.appendChild(th);
  });
  const tbody = el.createTBody();
  rows.forEach(r => {
    const tr = tbody.insertRow();
    r.forEach((v, i) => {
      const td = tr.insertCell();
      td.textContent = formats[i] ? formats[i](v) : fmt(v);
    });
  });
}
let _sortDir = {};
function sortTable(el, col, formats) {
  const key = el.id + ':' + col;
  _sortDir[key] = _sortDir[key] === 'asc' ? 'desc' : 'asc';
  const dir = _sortDir[key];
  el.querySelectorAll('th').forEach((th, i) => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (i === col) th.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
  const tbody = el.tBodies[0];
  const rows = Array.from(tbody.rows);
  rows.sort((a, b) => {
    let va = a.cells[col].textContent.replace(/[,%]/g, '');
    let vb = b.cells[col].textContent.replace(/[,%]/g, '');
    const na = parseFloat(va), nb = parseFloat(vb);
    if (!isNaN(na) && !isNaN(nb)) return dir === 'asc' ? na - nb : nb - na;
    return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
  });
  rows.forEach(r => tbody.appendChild(r));
}

// ============== 日期选择器 + 选定日 KPI ==============
const DAILY_BY_DATE = {};
DAILY.forEach(r => { DAILY_BY_DATE[r[0]] = r; });
const DATE_MAX = DAILY[0][0];  // 最新日 2026-05-27
const DATE_MIN = DAILY[DAILY.length - 1][0];  // 最早 2026-04-28

const DAY_KPI_DEFS = [
  {key: '日活', idx: 1, type: 'num'},
  {key: '注册', idx: 2, type: 'num'},
  {key: '下载', idx: 3, type: 'num'},
  {key: '充值（元）', idx: 4, type: 'num'},
  {key: '消费G点', idx: 6, type: 'num'},
  {key: '注册付费人数', idx: 7, type: 'num'},
  {key: '注册付费金额', idx: 8, type: 'num'},
  {key: '留存付费人数', idx: 9, type: 'num'},
  {key: '留存付费金额', idx: 10, type: 'num'},
  {key: '总下单数', idx: 11, type: 'num'},
  {key: '有效订单数', idx: 12, type: 'num'},
  {key: '客单价', idx: -1, type: 'calc', fn: r => r[11] > 0 ? r[4] / r[11] : 0}
];

function shiftDate(dStr, days) {
  const d = new Date(dStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function deltaSpan(curr, prev) {
  if (prev == null || prev === 0) return '<span class="delta delta-neutral">前日无数据</span>';
  const pct = (curr - prev) / prev * 100;
  const cls = pct > 0 ? 'delta-up' : (pct < 0 ? 'delta-down' : 'delta-neutral');
  const arrow = pct > 0 ? '↑' : (pct < 0 ? '↓' : '─');
  return `<span class="delta ${cls}">${arrow} ${Math.abs(pct).toFixed(1)}% vs 前日</span>`;
}

function renderDayKPI(dateStr) {
  const row = DAILY_BY_DATE[dateStr];
  const prevStr = shiftDate(dateStr, -1);
  const prev = DAILY_BY_DATE[prevStr];
  const grid = document.getElementById('day-kpi-grid');
  grid.innerHTML = '';
  if (!row) {
    grid.innerHTML = '<div style="padding:16px;color:#959da5">⚠️ 该日期没有数据（数据范围 2026-04-28 ~ 2026-05-27）</div>';
    return;
  }
  document.getElementById('day-title').textContent = dateStr + (prev ? '  vs  ' + prevStr : ' ');
  DAY_KPI_DEFS.forEach(def => {
    const curr = def.type === 'calc' ? def.fn(row) : row[def.idx];
    const prevVal = prev ? (def.type === 'calc' ? def.fn(prev) : prev[def.idx]) : null;
    const card = document.createElement('div');
    card.className = 'day-card';
    const valStr = def.key === '客单价' ? curr.toFixed(2) : fmt(curr);
    card.innerHTML = `<div class="label">${def.key}</div><div class="value">${valStr}</div>${deltaSpan(curr, prevVal)}`;
    grid.appendChild(card);
  });
}

const datePicker = document.getElementById('date-picker');
// 用实际数据范围覆盖 HTML 里写死的 value / min / max
datePicker.min = DATE_MIN;
datePicker.max = DATE_MAX;
datePicker.value = DATE_MAX;

datePicker.addEventListener('change', e => {
  document.querySelectorAll('.date-bar button').forEach(b => b.classList.remove('active'));
  renderDayKPI(e.target.value);
});
document.querySelectorAll('.date-bar button[data-shift]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.date-bar button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const shift = parseInt(btn.dataset.shift);
    const target = shiftDate(DATE_MAX, shift);
    datePicker.value = target;
    renderDayKPI(target);
  });
});

// 初始化为最新日
renderDayKPI(DATE_MAX);

// ============== 自由区间对比 ==============
const RANGE_METRICS = [
  {name: '日活', tag: 'DAU 日均', col: 1, agg: 'avg', fmt: v => fmt(Math.round(v))},
  {name: '注册', tag: 'NEW REG', col: 2, agg: 'sum', fmt},
  {name: '下载', tag: 'DOWNLOADS', col: 3, agg: 'sum', fmt},
  {name: '充值（元）', tag: 'GMV', col: 4, agg: 'sum', fmt},
  {name: '消费G点', tag: 'G POINTS', col: 6, agg: 'sum', fmt},
  {name: '注册付费人数', tag: 'NEW PAYERS', col: 7, agg: 'sum', fmt},
  {name: '注册付费金额', tag: 'NEW REVENUE', col: 8, agg: 'sum', fmt},
  {name: '留存付费金额', tag: 'OLD REVENUE', col: 10, agg: 'sum', fmt},
  {name: '总下单', tag: 'ORDERS', col: 11, agg: 'sum', fmt},
  {name: '有效订单', tag: 'PAID ORDERS', col: 12, agg: 'sum', fmt},
  {name: 'ARPU', tag: 'ARPU', agg: 'calc',
    fn: rows => { let amt=0,uv=0; rows.forEach(r=>{amt+=r[4];uv+=r[1];}); return uv>0?amt/uv:0; },
    fmt: v => v.toFixed(2)},
  {name: '客单价', tag: 'AOV', agg: 'calc',
    fn: rows => { let amt=0,ord=0; rows.forEach(r=>{amt+=r[4];ord+=r[11];}); return ord>0?amt/ord:0; },
    fmt: v => v.toFixed(2)},
];

function rangeRows(fromStr, toStr) {
  return DAILY.filter(r => r[0] >= fromStr && r[0] <= toStr);
}
function rangeStats(fromStr, toStr) {
  const rows = rangeRows(fromStr, toStr);
  const out = {};
  RANGE_METRICS.forEach(m => {
    if (!rows.length) { out[m.name] = 0; return; }
    if (m.agg === 'sum') out[m.name] = rows.reduce((s, r) => s + r[m.col], 0);
    else if (m.agg === 'avg') out[m.name] = rows.reduce((s, r) => s + r[m.col], 0) / rows.length;
    else if (m.agg === 'calc') out[m.name] = m.fn(rows);
  });
  return {stats: out, days: rows.length};
}

function renderRangeComparison() {
  let r1from = document.getElementById('r1-from').value;
  let r1to = document.getElementById('r1-to').value;
  let r2from = document.getElementById('r2-from').value;
  let r2to = document.getElementById('r2-to').value;

  const info = document.getElementById('range-info');
  const grid = document.getElementById('range-kpi-grid');

  if (!r1from || !r1to || !r2from || !r2to) {
    info.innerHTML = '请选择两段日期';
    grid.innerHTML = '';
    return;
  }

  // 校验：from <= to，否则自动交换
  if (r1from > r1to) { [r1from, r1to] = [r1to, r1from];
    document.getElementById('r1-from').value = r1from;
    document.getElementById('r1-to').value = r1to;
  }
  if (r2from > r2to) { [r2from, r2to] = [r2to, r2from];
    document.getElementById('r2-from').value = r2from;
    document.getElementById('r2-to').value = r2to;
  }

  const a = rangeStats(r1from, r1to);
  const b = rangeStats(r2from, r2to);

  info.innerHTML = `<b>本期</b> ${r1from} → ${r1to}（${a.days} 天） &nbsp;<span style="color:var(--gold);font-weight:600;">VS</span>&nbsp; <span class="b-period"><b>对比期</b> ${r2from} → ${r2to}（${b.days} 天）</span>`;

  if (a.days === 0 || b.days === 0) {
    grid.innerHTML = `<div style="padding:14px;color:var(--text-3);font-size:13px;">⚠️ 数据范围 ${DATE_MIN} ~ ${DATE_MAX}，所选区间无数据</div>`;
    return;
  }

  grid.innerHTML = '';
  RANGE_METRICS.forEach(m => {
    const v1 = a.stats[m.name];
    const v2 = b.stats[m.name];
    const diff = v1 - v2;
    const pct = v2 !== 0 ? (diff / v2 * 100) : 0;
    const arrow = diff > 0.001 ? '↑' : (diff < -0.001 ? '↓' : '─');
    const cls = diff > 0.001 ? 'delta-up' : (diff < -0.001 ? 'delta-down' : 'delta-neutral');
    const card = document.createElement('div');
    card.className = 'range-card';
    const sign = diff > 0 ? '+' : (diff < 0 ? '-' : '');
    card.innerHTML = `
      <div class="label">${m.tag} · ${m.name}</div>
      <div class="primary">${m.fmt(v1)}</div>
      <div class="secondary"><span class="lbl">vs</span> ${m.fmt(v2)}</div>
      <div class="delta ${cls}">${arrow} ${Math.abs(pct).toFixed(1)}% (${sign}${m.fmt(Math.abs(diff))})</div>
    `;
    grid.appendChild(card);
  });

  // 联动：下方两个图也按本期区间重新渲染
  if (typeof renderOverviewRangeCharts === 'function') {
    renderOverviewRangeCharts(r1from, r1to);
  }
}

function applyRangePreset(days) {
  // 本期：DATE_MAX 往前 days 天；对比期：紧挨着再往前 days 天
  const aTo = DATE_MAX;
  const aFrom = shiftDate(DATE_MAX, -(days - 1));
  const bTo = shiftDate(aFrom, -1);
  const bFrom = shiftDate(bTo, -(days - 1));

  if (bFrom < DATE_MIN) {
    alert(`数据范围只有 ${DATE_MIN} ~ ${DATE_MAX}，按"${days==1?'昨日 vs 前日':'近'+days+'天 vs 上'+days+'天'}"需要 ${days*2} 天数据。`);
    return;
  }

  document.getElementById('r1-from').value = aFrom;
  document.getElementById('r1-to').value = aTo;
  document.getElementById('r2-from').value = bFrom;
  document.getElementById('r2-to').value = bTo;
  renderRangeComparison();
}

// 绑定事件
['r1-from','r1-to','r2-from','r2-to'].forEach(id => {
  const el = document.getElementById(id);
  el.min = DATE_MIN;
  el.max = DATE_MAX;
  el.addEventListener('change', () => {
    document.querySelectorAll('.range-presets button').forEach(b => b.classList.remove('active'));
    renderRangeComparison();
  });
});

document.querySelectorAll('.range-presets button').forEach(btn => {
  const days = parseInt(btn.dataset.preset);
  // 数据不够就 disable
  const totalDays = Math.round((new Date(DATE_MAX) - new Date(DATE_MIN))/86400000) + 1;
  if (totalDays < days * 2) {
    btn.disabled = true;
    btn.title = `需要 ${days*2} 天数据，现有 ${totalDays} 天`;
  }
  btn.addEventListener('click', () => {
    document.querySelectorAll('.range-presets button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyRangePreset(days);
  });
});

// 默认显示"近7天 vs 上7天"（如果数据够）
(function initRange() {
  const totalDays = Math.round((new Date(DATE_MAX) - new Date(DATE_MIN))/86400000) + 1;
  if (totalDays >= 14) {
    document.querySelector('.range-presets button[data-preset="7"]').click();
  } else {
    renderRangeComparison();
  }
})();

// ============== 总览 ==============
const last30 = DAILY.slice().reverse(); // 4/28 → 5/27 order

// 算昨日 / 近7天 / 近30天 几个核心
const yest = DAILY[0]; // 5/27
const sum7 = idx => DAILY.slice(0, 7).reduce((s, r) => s + r[idx], 0);
const sum30 = idx => DAILY.reduce((s, r) => s + r[idx], 0);
const avg7 = idx => sum7(idx) / 7;
const avg30 = idx => sum30(idx) / 30;

// 新 vs 留存付费金额占比 + 每日订单成功率（跟随本期区间）
const co_pie = echarts.init(document.getElementById('chart-overview-pie'));
const co_success = echarts.init(document.getElementById('chart-overview-success'));

function renderOverviewRangeCharts(fromStr, toStr) {
  const rows = DAILY.filter(r => r[0] >= fromStr && r[0] <= toStr);
  const asc = rows.slice().sort((a, b) => a[0].localeCompare(b[0]));

  // 标签
  document.getElementById('pie-period-label').textContent = `${fromStr} → ${toStr}（${rows.length} 天）`;
  document.getElementById('success-period-label').textContent = `${fromStr} → ${toStr}（${rows.length} 天）/ 有效订单 / 总下单`;

  // 饼图
  const newPay = rows.reduce((s, r) => s + r[8], 0);
  const oldPay = rows.reduce((s, r) => s + r[10], 0);
  co_pie.setOption({
    tooltip: {trigger: 'item', formatter: '{b}: {c} 元 ({d}%)'},
    legend: {bottom: 0},
    series: [{
      type: 'pie', radius: ['45%', '70%'], avoidLabelOverlap: false,
      label: {show: true, formatter: '{b}\n{d}%'},
      data: [
        {value: newPay, name: '新注册付费', itemStyle: {color: '#2d7a55'}},
        {value: oldPay, name: '留存(老用户)付费', itemStyle: {color: '#1e5a87'}}
      ]
    }]
  }, true);

  // 订单成功率
  co_success.setOption({
    tooltip: {trigger: 'axis', formatter: p => {
      const r = asc[p[0].dataIndex];
      return `${r[0]}<br/>成功率: ${p[0].value.toFixed(1)}%<br/>总下单: ${fmt(r[11])}<br/>有效订单: ${fmt(r[12])}`;
    }},
    grid: {left: 50, right: 20, top: 30, bottom: 50},
    xAxis: {type: 'category', data: asc.map(r => r[0].slice(5))},
    yAxis: {type: 'value', name: '%', max: 100, axisLabel: {formatter: '{value}%'}},
    series: [{
      type: 'line', smooth: true,
      data: asc.map(r => r[11] > 0 ? r[12] / r[11] * 100 : 0),
      itemStyle: {color: '#2d7a55'}, areaStyle: {opacity: 0.2}
    }]
  }, true);
}

// ============== 30天趋势 ==============
const tr_main = echarts.init(document.getElementById('chart-trend-main'));
tr_main.setOption({
  tooltip: {trigger: 'axis'},
  legend: {data: ['日活', '注册', '充值（元）', '消费G点', '注册付费人数', '总下单'], top: 0},
  grid: {left: 70, right: 70, top: 50, bottom: 60},
  xAxis: {type: 'category', data: last30.map(r => r[0])},
  yAxis: [
    {type: 'value', name: '用户数/订单数', position: 'left'},
    {type: 'value', name: '金额/G点', position: 'right', axisLabel: {formatter: v => v >= 10000 ? (v/10000).toFixed(0) + '万' : v}}
  ],
  dataZoom: [{type: 'inside', start: 0, end: 100}, {type: 'slider', height: 20, bottom: 10}],
  series: [
    {name: '日活', type: 'line', smooth: true, data: last30.map(r => r[1]), itemStyle: {color: '#1e5a87'}},
    {name: '注册', type: 'line', smooth: true, data: last30.map(r => r[2]), itemStyle: {color: '#4a7da5'}},
    {name: '充值（元）', type: 'line', smooth: true, yAxisIndex: 1, data: last30.map(r => r[4]), itemStyle: {color: '#2d7a55'}},
    {name: '消费G点', type: 'line', smooth: true, yAxisIndex: 1, data: last30.map(r => r[6]), itemStyle: {color: '#b08c39'}},
    {name: '注册付费人数', type: 'line', smooth: true, data: last30.map(r => r[7]), itemStyle: {color: '#a8483d'}},
    {name: '总下单', type: 'line', smooth: true, data: last30.map(r => r[11]), itemStyle: {color: '#6b6789'}}
  ]
});

// 日明细表
renderTable(document.getElementById('table-trend'),
  ['日期', '日活', '注册', '下载', '充值', '消费G点', '注册付费人数', '注册付费金额', '留存付费金额', '总下单', '有效订单', '客单价'],
  DAILY.map(r => [r[0], r[1], r[2], r[3], r[4], r[6], r[7], r[8], r[10], r[11], r[12], r[11] > 0 ? (r[4] / r[11]) : 0]),
  [null, fmt, fmt, fmt, fmt, fmt, fmt, fmt, fmt, fmt, fmt, v => v.toFixed(2)]
);

// ============== 客户端聚合：用 GAMES_DAILY/TAOCAN_DAILY/CHANNEL_DAILY 按自定义区间汇总 ==============
const NET_ID_SET = new Set((typeof NETWORK_GAME_IDS !== 'undefined' ? NETWORK_GAME_IDS : []).map(String));

function extractGameId(nameStr) {
  const m = nameStr && nameStr.match(/[\(（](\d+)[\)）]\s*$/);
  return m ? m[1] : null;
}

function aggGamesByRange(fromStr, toStr) {
  const filtered = GAMES_DAILY.filter(r => r[0] >= fromStr && r[0] <= toStr);
  const agg = {};
  filtered.forEach(r => {
    const key = r[1];
    if (key === '-' || !key) return;
    if (!agg[key]) agg[key] = [key, 0,0,0,0,0,0,0,0,0,0];
    agg[key][1] += +r[2] || 0;   // 注册
    agg[key][2] += +r[3] || 0;   // 日活
    agg[key][3] += +r[5] || 0;   // 下载
    agg[key][4] += +r[7] || 0;   // 充值金额
    agg[key][5] += +r[9] || 0;   // 消费G点
    agg[key][6] += +r[10] || 0;  // 注册付费人数
    agg[key][7] += +r[11] || 0;  // 注册付费金额
    agg[key][8] += +r[12] || 0;  // 留存付费人数
    agg[key][9] += +r[13] || 0;  // 留存付费金额
    agg[key][10] += +r[6] || 0;  // 充值人数
  });
  const wy = [], dj = [];
  Object.values(agg).forEach(r => {
    const id = extractGameId(r[0]);
    if (id && NET_ID_SET.has(id)) wy.push(r);
    else dj.push([r[0], r[3], r[5], 0, 0]);
  });
  wy.sort((a, b) => b[4] - a[4]);
  dj.sort((a, b) => b[2] - a[2]);
  return {wy, dj: dj.slice(0, 20)};
}

function aggTaocanByRange(fromStr, toStr) {
  const filtered = TAOCAN_DAILY.filter(r => r[0] >= fromStr && r[0] <= toStr);
  const agg = {};
  filtered.forEach(r => {
    const k = r[1] + '|' + r[2];
    if (!agg[k]) agg[k] = [r[1], r[2], 0,0,0,0,0,0,0];
    agg[k][2] += +r[3] || 0;
    agg[k][3] += +r[4] || 0;
    agg[k][4] += +r[6] || 0;
    agg[k][5] += +r[7] || 0;
    agg[k][6] += +r[9] || 0;
    agg[k][7] += +r[11] || 0;
    agg[k][8] += +r[13] || 0;
  });
  const out = Object.values(agg).filter(r => r[7] > 0);
  out.sort((a, b) => b[7] - a[7]);
  return out;
}

function aggChannelByRange(fromStr, toStr) {
  const filtered = CHANNEL_DAILY.filter(r => r[0] >= fromStr && r[0] <= toStr);
  const agg = {};
  filtered.forEach(r => {
    if (r[0] === '合计' || !r[1]) return;
    const k = r[1];
    if (!agg[k]) agg[k] = [k, 0,0,0,0,0,0,0,0,0,0];
    agg[k][1] += +r[2] || 0;
    agg[k][2] += +r[3] || 0;
    agg[k][3] += +r[5] || 0;
    agg[k][4] += +r[7] || 0;
    agg[k][5] += +r[9] || 0;
    agg[k][6] += +r[10] || 0;
    agg[k][7] += +r[11] || 0;
    agg[k][8] += +r[12] || 0;
    agg[k][9] += +r[13] || 0;
    agg[k][10] += +r[6] || 0;
  });
  const out = Object.values(agg).filter(r => r[4] > 0);
  out.sort((a, b) => b[4] - a[4]);
  return out;
}

// 计算 daily 数据的可选日期范围
const _gameDates = GAMES_DAILY.map(r => r[0]).sort();
const TAB_DATE_MIN = _gameDates[0] || DATE_MIN;
const TAB_DATE_MAX = _gameDates[_gameDates.length - 1] || DATE_MAX;

// ============== 网游 ==============
const ch_wy = echarts.init(document.getElementById('chart-wangyou'));

function renderWangyou(period, customRange) {
  let data, rangeLabel;
  if (customRange) {
    const agg = aggGamesByRange(customRange.from, customRange.to);
    data = agg.wy;
    rangeLabel = customRange.from === customRange.to ? `单日 ${customRange.from}` : `${customRange.from} → ${customRange.to}`;
  } else {
    data = period === 30 ? WANGYOU_30D : WANGYOU;
    rangeLabel = `近 ${period} 天`;
  }
  const active = data.filter(r => r[4] > 0);
  document.getElementById('wy-kpi-active').textContent = active.length + ' / 48';
  document.getElementById('wy-kpi-rev').textContent = fmt(active.reduce((s, r) => s + r[4], 0));
  document.getElementById('wy-kpi-cost').textContent = fmt(active.reduce((s, r) => s + r[5], 0));
  document.getElementById('wy-kpi-payer').textContent = fmt(active.reduce((s, r) => s + r[10], 0));
  document.getElementById('wy-range-label').textContent = `数据范围 ${rangeLabel}`;
  document.getElementById('wy-kpi-rev-sub').textContent = rangeLabel;
  document.getElementById('wy-kpi-cost-sub').textContent = rangeLabel;
  document.getElementById('wy-kpi-payer-sub').textContent = rangeLabel;

  const top = active.slice().sort((a, b) => a[4] - b[4]);
  ch_wy.setOption({
    tooltip: {
      trigger: 'axis', axisPointer: {type: 'shadow'},
      formatter: p => {
        const r = top[p[0].dataIndex];
        return `<b>${r[0]}</b><br/>充值: ${fmt(r[4])} 元<br/>消费G点: ${fmt(r[5])}<br/>日活: ${fmt(r[2])}<br/>充值人数: ${fmt(r[10])}<br/>ARPPU: ${r[10] > 0 ? (r[4]/r[10]).toFixed(2) : '-'} 元`;
      }
    },
    grid: {left: 180, right: 20, top: 10, bottom: 30},
    xAxis: {type: 'value', axisLabel: {formatter: v => v >= 10000 ? (v/10000).toFixed(0) + '万' : v}},
    yAxis: {type: 'category', data: top.map(r => r[0])},
    series: [{type: 'bar', data: top.map(r => r[4]), itemStyle: {color: '#1e5a87'}, label: {show: true, position: 'right', formatter: p => fmt(p.value)}}]
  }, true);

  renderTable(document.getElementById('table-wangyou'),
    ['游戏', '注册', '日活', '下载', '充值', '消费G点', '充值人数', '付费率%', 'ARPU', 'ARPPU'],
    data.map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[10], r[2] > 0 ? (r[10]/r[2]*100) : 0, r[2] > 0 ? (r[4]/r[2]) : 0, r[10] > 0 ? (r[4]/r[10]) : 0]),
    [null, fmt, fmt, fmt, fmt, fmt, fmt, v => v.toFixed(2)+'%', v => v.toFixed(2), v => v.toFixed(2)]
  );
}
renderWangyou(7);

// ============== 单机 ==============
const ch_dj = echarts.init(document.getElementById('chart-danji'));

function renderDanji(period, customRange) {
  let data, rangeLabel;
  if (customRange) {
    const agg = aggGamesByRange(customRange.from, customRange.to);
    data = agg.dj;
    rangeLabel = customRange.from === customRange.to ? `单日 ${customRange.from}` : `${customRange.from} → ${customRange.to}`;
  } else {
    data = period === 30 ? DANJI_30D : DANJI;
    rangeLabel = `近 ${period} 天`;
  }
  document.getElementById('dj-kpi-active').textContent = data.length;
  document.getElementById('dj-kpi-cost').textContent = fmt(data.reduce((s, r) => s + r[2], 0));
  document.getElementById('dj-kpi-dl').textContent = fmt(data.reduce((s, r) => s + r[1], 0));
  document.getElementById('dj-range-label').textContent = `数据范围 ${rangeLabel}`;
  document.getElementById('dj-kpi-active-sub').textContent = `${rangeLabel} TOP 20`;
  document.getElementById('dj-kpi-cost-sub').textContent = `${rangeLabel} TOP 20`;
  document.getElementById('dj-kpi-dl-sub').textContent = `${rangeLabel} TOP 20`;

  const sorted = data.slice().sort((a, b) => a[2] - b[2]);
  ch_dj.setOption({
    tooltip: {
      trigger: 'axis', axisPointer: {type: 'shadow'},
      formatter: p => {
        const r = sorted[p[0].dataIndex];
        return `<b>${r[0]}</b><br/>消费G点: ${fmt(r[2])}<br/>下载量: ${fmt(r[1])}<br/>件均G点: ${r[1] > 0 ? (r[2]/r[1]).toFixed(2) : '-'}`;
      }
    },
    grid: {left: 250, right: 20, top: 10, bottom: 30},
    xAxis: {type: 'value', axisLabel: {formatter: v => v >= 10000 ? (v/10000).toFixed(0) + '万' : v}},
    yAxis: {type: 'category', data: sorted.map(r => r[0].length > 30 ? r[0].slice(0, 28) + '…' : r[0])},
    series: [{type: 'bar', data: sorted.map(r => r[2]), itemStyle: {color: '#b08c39'}, label: {show: true, position: 'right', formatter: p => fmt(p.value)}}]
  }, true);

  renderTable(document.getElementById('table-danji'),
    ['单机游戏', '下载量', '消费G点', '件均G点'],
    data.map(r => [r[0], r[1], r[2], r[1] > 0 ? (r[2]/r[1]) : 0]),
    [null, fmt, fmt, v => v.toFixed(2)]
  );
}
renderDanji(7);

// ============== 套餐 ==============
const ch_tc_rev = echarts.init(document.getElementById('chart-taocan-rev'));
const ch_tc_conv = echarts.init(document.getElementById('chart-taocan-conv'));

function renderTaocan(period, customRange) {
  let data, rangeLabel;
  if (customRange) {
    data = aggTaocanByRange(customRange.from, customRange.to);
    rangeLabel = customRange.from === customRange.to ? `单日 ${customRange.from}` : `${customRange.from} → ${customRange.to}`;
  } else {
    data = period === 30 ? TAOCAN_30D : TAOCAN;
    rangeLabel = `近 ${period} 天`;
  }
  document.getElementById('tc-range-label').textContent = `数据范围 ${rangeLabel}`;

  const sorted = data.slice().filter(r => r[8] > 0).sort((a, b) => a[8] - b[8]);
  ch_tc_rev.setOption({
    tooltip: {
      trigger: 'axis', axisPointer: {type: 'shadow'},
      formatter: p => {
        const r = sorted[p[0].dataIndex];
        return `<b>${r[1]}</b> (${r[0]})<br/>实际收入: ${fmt(r[8])} 元<br/>下单: ${fmt(r[4])}<br/>成功: ${fmt(r[6])}<br/>支付成功率: ${r[4] > 0 ? (r[6]/r[4]*100).toFixed(1) : '-'}%`;
      }
    },
    grid: {left: 140, right: 20, top: 10, bottom: 30},
    xAxis: {type: 'value', axisLabel: {formatter: v => v >= 10000 ? (v/10000).toFixed(0) + '万' : v}},
    yAxis: {type: 'category', data: sorted.map(r => r[1])},
    series: [{
      type: 'bar',
      data: sorted.map(r => ({value: r[8], itemStyle: {color: r[0] === '金币套餐' ? '#1e5a87' : '#2d7a55'}})),
      label: {show: true, position: 'right', formatter: p => fmt(p.value)}
    }]
  }, true);

  const conv = data.filter(r => r[4] > 0).sort((a, b) => (a[6]/a[4]) - (b[6]/b[4]));
  ch_tc_conv.setOption({
    tooltip: {trigger: 'axis', axisPointer: {type: 'shadow'}, formatter: p => `<b>${conv[p[0].dataIndex][1]}</b><br/>支付成功率: ${p[0].value.toFixed(1)}%`},
    grid: {left: 140, right: 40, top: 10, bottom: 30},
    xAxis: {type: 'value', max: 100, axisLabel: {formatter: '{value}%'}},
    yAxis: {type: 'category', data: conv.map(r => r[1])},
    series: [{type: 'bar', data: conv.map(r => +(r[6]/r[4]*100).toFixed(1)), itemStyle: {color: '#6b6789'}, label: {show: true, position: 'right', formatter: p => p.value + '%'}}]
  }, true);

  renderTable(document.getElementById('table-taocan'),
    ['类型', '套餐', '点击', '下单', '成功', '购买金额', '实际收入', '点击→下单%', '下单→成功%'],
    data.map(r => [r[0], r[1], r[2], r[4], r[6], r[7], r[8], r[2] > 0 ? (r[4]/r[2]*100) : 0, r[4] > 0 ? (r[6]/r[4]*100) : 0]),
    [null, null, fmt, fmt, fmt, fmt, fmt, v => v.toFixed(1)+'%', v => v.toFixed(1)+'%']
  );
}
renderTaocan(7);

// ============== 渠道 ==============
const ch_ch = echarts.init(document.getElementById('chart-channel'));

function renderChannel(period, customRange) {
  let data, rangeLabel;
  if (customRange) {
    data = aggChannelByRange(customRange.from, customRange.to);
    rangeLabel = customRange.from === customRange.to ? `单日 ${customRange.from}` : `${customRange.from} → ${customRange.to}`;
  } else {
    data = period === 30 ? CHANNEL_30D : CHANNEL;
    rangeLabel = `近 ${period} 天`;
  }
  document.getElementById('ch-range-label').textContent = `数据范围 ${rangeLabel}`;

  const sorted = data.slice().sort((a, b) => a[4] - b[4]);
  ch_ch.setOption({
    tooltip: {
      trigger: 'axis', axisPointer: {type: 'shadow'},
      formatter: p => {
        const r = sorted[p[0].dataIndex];
        return `<b>${r[0]}</b><br/>充值: ${fmt(r[4])} 元<br/>注册: ${fmt(r[1])}<br/>日活: ${fmt(r[2])}<br/>充值人数: ${fmt(r[10])}<br/>ARPU: ${r[2] > 0 ? (r[4]/r[2]).toFixed(2) : '-'}<br/>ARPPU: ${r[10] > 0 ? (r[4]/r[10]).toFixed(2) : '-'}`;
      }
    },
    grid: {left: 100, right: 30, top: 10, bottom: 30},
    xAxis: {type: 'value', axisLabel: {formatter: v => v >= 10000 ? (v/10000).toFixed(0) + '万' : v}},
    yAxis: {type: 'category', data: sorted.map(r => r[0])},
    series: [{type: 'bar', data: sorted.map(r => r[4]), itemStyle: {color: '#1e5a87'}, label: {show: true, position: 'right', formatter: p => fmt(p.value)}}]
  }, true);

  renderTable(document.getElementById('table-channel'),
    ['渠道码', '注册', '日活', '下载', '充值', '消费G点', '充值人数', '付费率%', 'ARPU', 'ARPPU'],
    data.map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[10], r[2] > 0 ? (r[10]/r[2]*100) : 0, r[2] > 0 ? (r[4]/r[2]) : 0, r[10] > 0 ? (r[4]/r[10]) : 0]),
    [null, fmt, fmt, fmt, fmt, fmt, fmt, v => v.toFixed(2)+'%', v => v.toFixed(2), v => v.toFixed(2)]
  );
}
renderChannel(7);

// 4 个 tab 共用的渲染派发
function renderTab(tab, period, customRange) {
  if (tab === 'wangyou') renderWangyou(period, customRange);
  else if (tab === 'danji') renderDanji(period, customRange);
  else if (tab === 'taocan') renderTaocan(period, customRange);
  else if (tab === 'channel') renderChannel(period, customRange);
}

// 初始化每个 tab 的日期输入 min/max
['wangyou', 'danji', 'taocan', 'channel'].forEach(tab => {
  document.querySelectorAll(`input[type="date"][data-tab="${tab}"]`).forEach(inp => {
    inp.min = TAB_DATE_MIN;
    inp.max = TAB_DATE_MAX;
  });
});

// 预设按钮点击
document.querySelectorAll('.date-bar button[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    const period = parseInt(btn.dataset.period);
    document.querySelectorAll(`.date-bar button[data-tab="${tab}"]`).forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll(`input[type="date"][data-tab="${tab}"]`).forEach(inp => inp.value = '');
    if (period === 1) {
      // 昨日 = 数据范围最新一天，用单日 custom range 走聚合
      renderTab(tab, null, {from: TAB_DATE_MAX, to: TAB_DATE_MAX});
    } else {
      renderTab(tab, period);
    }
  });
});

// 日期输入触发自定义区间
document.querySelectorAll('input[type="date"][data-tab]').forEach(inp => {
  inp.addEventListener('change', () => {
    const tab = inp.dataset.tab;
    const fromEl = document.querySelector(`input[type="date"][data-tab="${tab}"][data-side="from"]`);
    const toEl = document.querySelector(`input[type="date"][data-tab="${tab}"][data-side="to"]`);
    let from = fromEl.value, to = toEl.value;
    if (!from || !to) return;
    if (from > to) { [from, to] = [to, from]; fromEl.value = from; toEl.value = to; }
    if (from < TAB_DATE_MIN || to > TAB_DATE_MAX) {
      alert(`这 4 个 tab 的自定义区间只支持 ${TAB_DATE_MIN} ~ ${TAB_DATE_MAX}（近 30 天）。\n更长历史的话告诉我扩 daily 抓取范围。`);
      return;
    }
    // 取消预设按钮激活
    document.querySelectorAll(`.date-bar button[data-tab="${tab}"]`).forEach(b => b.classList.remove('active'));
    renderTab(tab, null, {from, to});
  });
});

// ============== LTV / 留存 ==============
const ch_ltv = echarts.init(document.getElementById('chart-ltv'));
const ltv_sorted = LTV.slice().reverse();
ch_ltv.setOption({
  tooltip: {trigger: 'axis'},
  legend: {data: ['D1 LTV', 'D7 LTV', 'D14 LTV', 'D30 LTV'], top: 0},
  grid: {left: 50, right: 30, top: 50, bottom: 60},
  xAxis: {type: 'category', data: ltv_sorted.map(r => r[0].slice(5))},
  yAxis: {type: 'value', name: 'LTV（元）'},
  dataZoom: [{type: 'inside'}, {type: 'slider', height: 20, bottom: 10}],
  series: [
    {name: 'D1 LTV', type: 'line', smooth: true, data: ltv_sorted.map(r => r[2]), itemStyle: {color: '#4a7da5'}, connectNulls: true},
    {name: 'D7 LTV', type: 'line', smooth: true, data: ltv_sorted.map(r => r[3] > 0 ? r[3] : null), itemStyle: {color: '#2d7a55'}, connectNulls: true},
    {name: 'D14 LTV', type: 'line', smooth: true, data: ltv_sorted.map(r => r[4] > 0 ? r[4] : null), itemStyle: {color: '#b08c39'}, connectNulls: true},
    {name: 'D30 LTV', type: 'line', smooth: true, data: ltv_sorted.map(r => r[5] > 0 ? r[5] : null), itemStyle: {color: '#a8483d'}, connectNulls: true}
  ]
});

const ch_ret = echarts.init(document.getElementById('chart-retention'));
const ret_sorted = RETENTION.slice().reverse();
ch_ret.setOption({
  tooltip: {trigger: 'axis', formatter: p => p.map(x => `${x.marker} ${x.seriesName}: ${x.value ? x.value.toFixed(2) + '%' : '—'}`).join('<br/>') + '<br/>日期: ' + p[0].name},
  legend: {data: ['D1 次留', 'D3', 'D7', 'D14', 'D30'], top: 0},
  grid: {left: 50, right: 30, top: 50, bottom: 60},
  xAxis: {type: 'category', data: ret_sorted.map(r => r[0].slice(5))},
  yAxis: {type: 'value', name: '%', axisLabel: {formatter: '{value}%'}},
  dataZoom: [{type: 'inside'}, {type: 'slider', height: 20, bottom: 10}],
  series: [
    {name: 'D1 次留', type: 'line', smooth: true, data: ret_sorted.map(r => r[2] > 0 ? r[2] : null), itemStyle: {color: '#1e5a87'}, connectNulls: true},
    {name: 'D3', type: 'line', smooth: true, data: ret_sorted.map(r => r[3] > 0 ? r[3] : null), itemStyle: {color: '#4a7da5'}, connectNulls: true},
    {name: 'D7', type: 'line', smooth: true, data: ret_sorted.map(r => r[4] > 0 ? r[4] : null), itemStyle: {color: '#2d7a55'}, connectNulls: true},
    {name: 'D14', type: 'line', smooth: true, data: ret_sorted.map(r => r[5] > 0 ? r[5] : null), itemStyle: {color: '#b08c39'}, connectNulls: true},
    {name: 'D30', type: 'line', smooth: true, data: ret_sorted.map(r => r[6] > 0 ? r[6] : null), itemStyle: {color: '#a8483d'}, connectNulls: true}
  ]
});

// 初始化：用本期区间渲染下方两个图（因为 renderOverviewRangeCharts 定义在 renderRangeComparison 之后）
(() => {
  const f = document.getElementById('r1-from').value;
  const t = document.getElementById('r1-to').value;
  if (f && t) renderOverviewRangeCharts(f, t);
})();

// 窗口 resize
window.addEventListener('resize', () => {
  [co_pie, co_success, tr_main, ch_wy, ch_dj, ch_tc_rev, ch_tc_conv, ch_ch, ch_ltv, ch_ret].forEach(c => c && c.resize());
});
