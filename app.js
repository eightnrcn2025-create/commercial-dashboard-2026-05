// ============== 工具 ==============
const fmt = n => (n == null || n === '') ? '-' : (typeof n === 'number' ? n.toLocaleString('zh-CN', {maximumFractionDigits: 2}) : n);
const fmtPct = n => (n == null) ? '-' : (n*100).toFixed(1) + '%';

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

// ============== 总览 ==============
const co_compare = echarts.init(document.getElementById('chart-overview-compare'));
const last30 = DAILY.slice().reverse(); // 4/28 → 5/27 order

// 算昨日 / 近7天 / 近30天 几个核心
const yest = DAILY[0]; // 5/27
const sum7 = idx => DAILY.slice(0, 7).reduce((s, r) => s + r[idx], 0);
const sum30 = idx => DAILY.reduce((s, r) => s + r[idx], 0);
const avg7 = idx => sum7(idx) / 7;
const avg30 = idx => sum30(idx) / 30;

const compareMetrics = [
  ['注册', 2, yest[2], sum7(2), sum30(2), 'sum'],
  ['充值（元）', 4, yest[4], sum7(4), sum30(4), 'sum'],
  ['消费G点', 6, yest[6], sum7(6), sum30(6), 'sum'],
  ['日活', 1, yest[1], avg7(1), avg30(1), 'avg'],
  ['总下单数', 11, yest[11], sum7(11), sum30(11), 'sum'],
  ['注册付费人数', 7, yest[7], sum7(7), sum30(7), 'sum']
];

co_compare.setOption({
  tooltip: {trigger: 'axis', axisPointer: {type: 'shadow'}},
  legend: {data: ['昨日（5/27）', '近 7 天合计', '近 30 天合计'], top: 0},
  grid: {left: 60, right: 20, top: 50, bottom: 30},
  xAxis: {type: 'category', data: compareMetrics.map(m => m[0])},
  yAxis: [{type: 'value', name: '数值', axisLabel: {formatter: v => v >= 10000 ? (v/10000).toFixed(1) + '万' : v}}],
  series: [
    {name: '昨日（5/27）', type: 'bar', data: compareMetrics.map(m => m[2]), itemStyle: {color: '#2a5298'}},
    {name: '近 7 天合计', type: 'bar', data: compareMetrics.map(m => Math.round(m[3])), itemStyle: {color: '#5295e0'}},
    {name: '近 30 天合计', type: 'bar', data: compareMetrics.map(m => Math.round(m[4])), itemStyle: {color: '#a0c4ed'}}
  ]
});

// 新 vs 留存付费金额占比（近30天）
const newPay30 = sum30(8), oldPay30 = sum30(10);
const co_pie = echarts.init(document.getElementById('chart-overview-pie'));
co_pie.setOption({
  tooltip: {trigger: 'item', formatter: '{b}: {c} 元 ({d}%)'},
  legend: {bottom: 0},
  series: [{
    type: 'pie', radius: ['45%', '70%'], avoidLabelOverlap: false,
    label: {show: true, formatter: '{b}\n{d}%'},
    data: [
      {value: newPay30, name: '新注册付费', itemStyle: {color: '#28a745'}},
      {value: oldPay30, name: '留存(老用户)付费', itemStyle: {color: '#2a5298'}}
    ]
  }]
});

// 每日订单成功率
const co_success = echarts.init(document.getElementById('chart-overview-success'));
co_success.setOption({
  tooltip: {trigger: 'axis', formatter: p => `${p[0].name}<br/>成功率: ${p[0].value.toFixed(1)}%<br/>总下单: ${fmt(last30[p[0].dataIndex][11])}<br/>有效订单: ${fmt(last30[p[0].dataIndex][12])}`},
  grid: {left: 50, right: 20, top: 30, bottom: 50},
  xAxis: {type: 'category', data: last30.map(r => r[0].slice(5))},
  yAxis: {type: 'value', name: '%', max: 100, axisLabel: {formatter: '{value}%'}},
  series: [{
    type: 'line', smooth: true,
    data: last30.map(r => r[11] > 0 ? r[12] / r[11] * 100 : 0),
    itemStyle: {color: '#28a745'}, areaStyle: {opacity: 0.2}
  }]
});

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
    {name: '日活', type: 'line', smooth: true, data: last30.map(r => r[1]), itemStyle: {color: '#2a5298'}},
    {name: '注册', type: 'line', smooth: true, data: last30.map(r => r[2]), itemStyle: {color: '#5295e0'}},
    {name: '充值（元）', type: 'line', smooth: true, yAxisIndex: 1, data: last30.map(r => r[4]), itemStyle: {color: '#28a745'}},
    {name: '消费G点', type: 'line', smooth: true, yAxisIndex: 1, data: last30.map(r => r[6]), itemStyle: {color: '#f66a0a'}},
    {name: '注册付费人数', type: 'line', smooth: true, data: last30.map(r => r[7]), itemStyle: {color: '#d73a49'}},
    {name: '总下单', type: 'line', smooth: true, data: last30.map(r => r[11]), itemStyle: {color: '#6f42c1'}}
  ]
});

// 日明细表
renderTable(document.getElementById('table-trend'),
  ['日期', '日活', '注册', '下载', '充值', '消费G点', '注册付费人数', '注册付费金额', '留存付费金额', '总下单', '有效订单', '客单价'],
  DAILY.map(r => [r[0], r[1], r[2], r[3], r[4], r[6], r[7], r[8], r[10], r[11], r[12], r[11] > 0 ? (r[4] / r[11]) : 0]),
  [null, fmt, fmt, fmt, fmt, fmt, fmt, fmt, fmt, fmt, fmt, v => v.toFixed(2)]
);

// ============== 网游 ==============
const wy_active = WANGYOU.filter(r => r[4] > 0);
document.getElementById('wy-kpi-reg').textContent = fmt(wy_active.reduce((s, r) => s + r[1], 0));
document.getElementById('wy-kpi-rev').textContent = fmt(wy_active.reduce((s, r) => s + r[4], 0));
document.getElementById('wy-kpi-cost').textContent = fmt(wy_active.reduce((s, r) => s + r[5], 0));
document.getElementById('wy-kpi-payer').textContent = fmt(wy_active.reduce((s, r) => s + r[10], 0));

const ch_wy = echarts.init(document.getElementById('chart-wangyou'));
const wy_top = wy_active.slice().sort((a, b) => a[4] - b[4]);
ch_wy.setOption({
  tooltip: {
    trigger: 'axis', axisPointer: {type: 'shadow'},
    formatter: p => {
      const r = wy_top[p[0].dataIndex];
      return `<b>${r[0]}</b><br/>充值: ${fmt(r[4])} 元<br/>消费G点: ${fmt(r[5])}<br/>日活: ${fmt(r[2])}<br/>充值人数: ${fmt(r[10])}<br/>ARPPU: ${r[10] > 0 ? (r[4]/r[10]).toFixed(2) : '-'} 元`;
    }
  },
  grid: {left: 180, right: 20, top: 10, bottom: 30},
  xAxis: {type: 'value', axisLabel: {formatter: v => v >= 10000 ? (v/10000).toFixed(0) + '万' : v}},
  yAxis: {type: 'category', data: wy_top.map(r => r[0])},
  series: [{type: 'bar', data: wy_top.map(r => r[4]), itemStyle: {color: '#2a5298'}, label: {show: true, position: 'right', formatter: p => fmt(p.value)}}]
});

renderTable(document.getElementById('table-wangyou'),
  ['游戏', '注册', '日活', '下载', '充值', '消费G点', '充值人数', '付费率%', 'ARPU', 'ARPPU'],
  WANGYOU.map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[10], r[2] > 0 ? (r[10]/r[2]*100) : 0, r[2] > 0 ? (r[4]/r[2]) : 0, r[10] > 0 ? (r[4]/r[10]) : 0]),
  [null, fmt, fmt, fmt, fmt, fmt, fmt, v => v.toFixed(2)+'%', v => v.toFixed(2), v => v.toFixed(2)]
);

// ============== 单机 ==============
document.getElementById('dj-kpi-cost').textContent = fmt(DANJI.reduce((s, r) => s + r[2], 0));
document.getElementById('dj-kpi-dl').textContent = fmt(DANJI.reduce((s, r) => s + r[1], 0));

const ch_dj = echarts.init(document.getElementById('chart-danji'));
const dj_sorted = DANJI.slice().sort((a, b) => a[2] - b[2]);
ch_dj.setOption({
  tooltip: {
    trigger: 'axis', axisPointer: {type: 'shadow'},
    formatter: p => {
      const r = dj_sorted[p[0].dataIndex];
      return `<b>${r[0]}</b><br/>消费G点: ${fmt(r[2])}<br/>下载量: ${fmt(r[1])}<br/>件均G点: ${r[1] > 0 ? (r[2]/r[1]).toFixed(2) : '-'}`;
    }
  },
  grid: {left: 250, right: 20, top: 10, bottom: 30},
  xAxis: {type: 'value', axisLabel: {formatter: v => v >= 10000 ? (v/10000).toFixed(0) + '万' : v}},
  yAxis: {type: 'category', data: dj_sorted.map(r => r[0].length > 30 ? r[0].slice(0, 28) + '…' : r[0])},
  series: [{type: 'bar', data: dj_sorted.map(r => r[2]), itemStyle: {color: '#f66a0a'}, label: {show: true, position: 'right', formatter: p => fmt(p.value)}}]
});

renderTable(document.getElementById('table-danji'),
  ['单机游戏', '下载量', '消费G点', '件均G点'],
  DANJI.map(r => [r[0], r[1], r[2], r[1] > 0 ? (r[2]/r[1]) : 0]),
  [null, fmt, fmt, v => v.toFixed(2)]
);

// ============== 套餐 ==============
const ch_tc_rev = echarts.init(document.getElementById('chart-taocan-rev'));
const tc_sorted = TAOCAN.slice().filter(r => r[8] > 0).sort((a, b) => a[8] - b[8]);
ch_tc_rev.setOption({
  tooltip: {
    trigger: 'axis', axisPointer: {type: 'shadow'},
    formatter: p => {
      const r = tc_sorted[p[0].dataIndex];
      return `<b>${r[1]}</b> (${r[0]})<br/>实际收入: ${fmt(r[8])} 元<br/>下单: ${fmt(r[4])}<br/>成功: ${fmt(r[6])}<br/>支付成功率: ${r[4] > 0 ? (r[6]/r[4]*100).toFixed(1) : '-'}%`;
    }
  },
  grid: {left: 140, right: 20, top: 10, bottom: 30},
  xAxis: {type: 'value', axisLabel: {formatter: v => v >= 10000 ? (v/10000).toFixed(0) + '万' : v}},
  yAxis: {type: 'category', data: tc_sorted.map(r => r[1])},
  series: [{
    type: 'bar',
    data: tc_sorted.map(r => ({value: r[8], itemStyle: {color: r[0] === '金币套餐' ? '#2a5298' : '#28a745'}})),
    label: {show: true, position: 'right', formatter: p => fmt(p.value)}
  }]
});

const ch_tc_conv = echarts.init(document.getElementById('chart-taocan-conv'));
const tc_conv = TAOCAN.filter(r => r[4] > 0).sort((a, b) => (a[6]/a[4]) - (b[6]/b[4]));
ch_tc_conv.setOption({
  tooltip: {trigger: 'axis', axisPointer: {type: 'shadow'}, formatter: p => `<b>${tc_conv[p[0].dataIndex][1]}</b><br/>支付成功率: ${p[0].value.toFixed(1)}%`},
  grid: {left: 140, right: 40, top: 10, bottom: 30},
  xAxis: {type: 'value', max: 100, axisLabel: {formatter: '{value}%'}},
  yAxis: {type: 'category', data: tc_conv.map(r => r[1])},
  series: [{type: 'bar', data: tc_conv.map(r => +(r[6]/r[4]*100).toFixed(1)), itemStyle: {color: '#6f42c1'}, label: {show: true, position: 'right', formatter: p => p.value + '%'}}]
});

renderTable(document.getElementById('table-taocan'),
  ['类型', '套餐', '点击', '下单', '成功', '购买金额', '实际收入', '点击→下单%', '下单→成功%'],
  TAOCAN.map(r => [r[0], r[1], r[2], r[4], r[6], r[7], r[8], r[2] > 0 ? (r[4]/r[2]*100) : 0, r[4] > 0 ? (r[6]/r[4]*100) : 0]),
  [null, null, fmt, fmt, fmt, fmt, fmt, v => v.toFixed(1)+'%', v => v.toFixed(1)+'%']
);

// ============== 渠道 ==============
const ch_ch = echarts.init(document.getElementById('chart-channel'));
const ch_sorted = CHANNEL.slice().sort((a, b) => a[4] - b[4]);
ch_ch.setOption({
  tooltip: {
    trigger: 'axis', axisPointer: {type: 'shadow'},
    formatter: p => {
      const r = ch_sorted[p[0].dataIndex];
      return `<b>${r[0]}</b><br/>充值: ${fmt(r[4])} 元<br/>注册: ${fmt(r[1])}<br/>日活: ${fmt(r[2])}<br/>充值人数: ${fmt(r[10])}<br/>ARPU: ${r[2] > 0 ? (r[4]/r[2]).toFixed(2) : '-'}<br/>ARPPU: ${r[10] > 0 ? (r[4]/r[10]).toFixed(2) : '-'}`;
    }
  },
  grid: {left: 100, right: 30, top: 10, bottom: 30},
  xAxis: {type: 'value', axisLabel: {formatter: v => v >= 10000 ? (v/10000).toFixed(0) + '万' : v}},
  yAxis: {type: 'category', data: ch_sorted.map(r => r[0])},
  series: [{type: 'bar', data: ch_sorted.map(r => r[4]), itemStyle: {color: '#2a5298'}, label: {show: true, position: 'right', formatter: p => fmt(p.value)}}]
});

renderTable(document.getElementById('table-channel'),
  ['渠道码', '注册', '日活', '下载', '充值', '消费G点', '充值人数', '付费率%', 'ARPU', 'ARPPU'],
  CHANNEL.map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[10], r[2] > 0 ? (r[10]/r[2]*100) : 0, r[2] > 0 ? (r[4]/r[2]) : 0, r[10] > 0 ? (r[4]/r[10]) : 0]),
  [null, fmt, fmt, fmt, fmt, fmt, fmt, v => v.toFixed(2)+'%', v => v.toFixed(2), v => v.toFixed(2)]
);

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
    {name: 'D1 LTV', type: 'line', smooth: true, data: ltv_sorted.map(r => r[2]), itemStyle: {color: '#5295e0'}, connectNulls: true},
    {name: 'D7 LTV', type: 'line', smooth: true, data: ltv_sorted.map(r => r[3] > 0 ? r[3] : null), itemStyle: {color: '#28a745'}, connectNulls: true},
    {name: 'D14 LTV', type: 'line', smooth: true, data: ltv_sorted.map(r => r[4] > 0 ? r[4] : null), itemStyle: {color: '#f66a0a'}, connectNulls: true},
    {name: 'D30 LTV', type: 'line', smooth: true, data: ltv_sorted.map(r => r[5] > 0 ? r[5] : null), itemStyle: {color: '#d73a49'}, connectNulls: true}
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
    {name: 'D1 次留', type: 'line', smooth: true, data: ret_sorted.map(r => r[2] > 0 ? r[2] : null), itemStyle: {color: '#2a5298'}, connectNulls: true},
    {name: 'D3', type: 'line', smooth: true, data: ret_sorted.map(r => r[3] > 0 ? r[3] : null), itemStyle: {color: '#5295e0'}, connectNulls: true},
    {name: 'D7', type: 'line', smooth: true, data: ret_sorted.map(r => r[4] > 0 ? r[4] : null), itemStyle: {color: '#28a745'}, connectNulls: true},
    {name: 'D14', type: 'line', smooth: true, data: ret_sorted.map(r => r[5] > 0 ? r[5] : null), itemStyle: {color: '#f66a0a'}, connectNulls: true},
    {name: 'D30', type: 'line', smooth: true, data: ret_sorted.map(r => r[6] > 0 ? r[6] : null), itemStyle: {color: '#d73a49'}, connectNulls: true}
  ]
});

// 窗口 resize
window.addEventListener('resize', () => {
  [co_compare, co_pie, co_success, tr_main, ch_wy, ch_dj, ch_tc_rev, ch_tc_conv, ch_ch, ch_ltv, ch_ret].forEach(c => c && c.resize());
});
