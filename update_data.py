#!/usr/bin/env python3
"""
每日扒商业化看板数据 - 自动更新 data.js + push GitHub Pages
首次运行: 浏览器会弹出, 你手动登 admin1866, 之后会记住会话
后续运行: 全自动, headless
"""
import json
import sys
import subprocess
from datetime import date, timedelta, datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).parent
PROFILE = Path.home() / '.dashboard-chrome-profile'
ADMIN = 'http://18game.line.ccc:8001/admin1866'

# 日期范围：抓昨日（含）往前 30 天
today = date.today()
yest = today - timedelta(days=1)
d30 = yest - timedelta(days=29)
d7 = yest - timedelta(days=6)

def fmt(d): return d.strftime('%Y-%m-%d')

# 提取 iframe 表格的通用 JS
EXTRACT_JS = """
() => {
  const f = document.querySelector('iframe');
  if (!f || !f.contentDocument) return null;
  const d = f.contentDocument;
  const tbls = d.querySelectorAll('table');
  if (tbls.length < 3) return null;
  // 设置 3000/页
  const opts = d.querySelectorAll('.layui-laypage-limits option');
  for (const o of opts) {
    if (o.value === '3000') {
      const s = o.closest('select');
      s.value = o.value;
      s.dispatchEvent(new Event('change', {bubbles: true}));
      break;
    }
  }
  return 'pageSize set';
}
"""

GRAB_ROWS_JS = """
() => {
  const f = document.querySelector('iframe');
  const d = f.contentDocument;
  const tbl = d.querySelectorAll('table')[2];
  const rows = [];
  tbl.querySelectorAll('tr').forEach(r => {
    const cells = Array.from(r.querySelectorAll('td')).map(c => c.innerText.trim());
    if (cells.length) rows.push(cells);
  });
  return rows;
}
"""

def headless_mode():
    """First run: visible browser for login. Subsequent: headless."""
    return PROFILE.exists() and any(PROFILE.iterdir()) if PROFILE.exists() else False

def fetch_one(page, path, start=None, end=None, search_btn_text='搜索'):
    """Navigate to a report page, optionally set date range, search, then return iframe rows."""
    url = f'{ADMIN}{path}'
    page.goto(url, wait_until='networkidle')
    page.wait_for_selector('iframe', timeout=20000)
    # wait for iframe ready
    page.wait_for_function('() => { const f = document.querySelector("iframe"); return f && f.contentDocument && f.contentDocument.querySelectorAll("table").length > 1; }', timeout=20000)

    if start and end:
        # set date inputs inside the page (date inputs are in main page, not iframe)
        # they may differ per page; we try common selectors
        try:
            inputs = page.locator('input[type="text"]').all()
            for i, inp in enumerate(inputs):
                if 'yyyy-mm-dd' in (inp.get_attribute('placeholder') or '').lower() or 'yyyy-MM-dd' in (inp.get_attribute('placeholder') or ''):
                    pass  # 暂用更简单方案：用 query string 直接传
            # 多数页支持 ?startTime=&endTime=
            page.goto(f'{url}?startTime={start}&endTime={end}', wait_until='networkidle')
            page.wait_for_selector('iframe', timeout=20000)
            page.wait_for_timeout(2000)
        except Exception as e:
            print(f'[warn] date filter failed: {e}', file=sys.stderr)

    # set page size to 3000
    page.evaluate(EXTRACT_JS)
    page.wait_for_timeout(2500)
    return page.evaluate(GRAB_ROWS_JS)


def main():
    is_first_run = not (PROFILE.exists() and (PROFILE / 'Default').exists())

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            headless=not is_first_run,
            args=['--no-sandbox', '--disable-blink-features=AutomationControlled'],
            viewport={'width': 1440, 'height': 800},
            ignore_https_errors=True,
        )
        page = ctx.new_page()
        page.set_default_timeout(60000)

        # check login
        page.goto(ADMIN, wait_until='networkidle')
        url = page.url
        if 'login' in url.lower() or 'signin' in url.lower():
            if is_first_run:
                print('=' * 60)
                print('首次运行：请在弹出的浏览器里手动登录 admin1866')
                print('登录成功后按 ENTER 继续...')
                print('=' * 60)
                input()
            else:
                print('ERROR: 会话过期。请运行: rm -rf ~/.dashboard-chrome-profile && python3 update_data.py', file=sys.stderr)
                return 2

        # ============ 1. 系统统计-报表 30天 ============
        print(f'[1/7] 系统统计-报表 ({fmt(d30)} ~ {fmt(yest)})...')
        daily_rows = fetch_one(page, '/system/reportTotalDayLog', fmt(d30), fmt(yest))
        DAILY = [[r[0]] + [_num(x) for x in r[1:13]] for r in daily_rows if len(r) >= 13]
        DAILY.sort(key=lambda r: r[0], reverse=True)  # 5/27 → 4/28
        print(f'      ✓ {len(DAILY)} 行')

        # ============ 2. 套餐统计 7天 ============
        print(f'[2/7] 套餐统计 ({fmt(d7)} ~ {fmt(yest)})...')
        tc_rows = fetch_one(page, '/system/getPackageStat', fmt(d7), fmt(yest))
        TAOCAN = aggregate_taocan(tc_rows)
        print(f'      ✓ {len(TAOCAN)} 套餐')

        # ============ 3. 网络游戏运营统计 - 取网游清单 ============
        print(f'[3/7] 网游清单 ({fmt(d7)} ~ {fmt(yest)})...')
        ny_rows = fetch_one(page, '/system/networkGameOperation', fmt(d7), fmt(yest))
        NETWORK_GAME_IDS = extract_ids(ny_rows, col=2)
        print(f'      ✓ {len(NETWORK_GAME_IDS)} 个网游')

        # ============ 4. 游戏统计 7天 - 拆网游/单机 ============
        print(f'[4/7] 游戏统计 ({fmt(d7)} ~ {fmt(yest)})...')
        g_rows = fetch_one(page, '/system/gameStat', fmt(d7), fmt(yest))
        WANGYOU, DANJI = aggregate_games(g_rows, NETWORK_GAME_IDS)
        print(f'      ✓ 网游 {len(WANGYOU)} / 单机 {len(DANJI)}')

        # ============ 5. 渠道统计 7天 ============
        print(f'[5/7] 渠道统计 ({fmt(d7)} ~ {fmt(yest)})...')
        ch_rows = fetch_one(page, '/system/channelStat', fmt(d7), fmt(yest))
        CHANNEL = aggregate_channel(ch_rows)
        print(f'      ✓ {len(CHANNEL)} 渠道')

        # ============ 6. 网游 LTV 30天 ============
        print(f'[6/7] 网游LTV ({fmt(d30)} ~ {fmt(yest)})...')
        ltv_rows = fetch_one(page, '/system/networkGameLTV', fmt(d30), fmt(yest))
        LTV = aggregate_ltv(ltv_rows)
        print(f'      ✓ {len(LTV)} 天')

        # ============ 7. 网游留存 30天 ============
        print(f'[7/7] 网游留存 ({fmt(d30)} ~ {fmt(yest)})...')
        ret_rows = fetch_one(page, '/system/networkGameRetention', fmt(d30), fmt(yest))
        RETENTION = aggregate_retention(ret_rows)
        print(f'      ✓ {len(RETENTION)} 天')

        ctx.close()

    # ============ 写 data.js ============
    write_data_js(REPO / 'data.js', DAILY, WANGYOU, DANJI, TAOCAN, CHANNEL, LTV, RETENTION)
    print(f'✓ data.js 已更新')

    # ============ 推 GitHub ============
    if push_github(REPO):
        print('✓ 已推送 GitHub，Pages 1 分钟后更新')
    else:
        print('⚠️ 推送 GitHub 失败，请手动检查')

    return 0


# ============ 工具函数 ============

def _num(s):
    """字符串 → 数字，失败返回 0"""
    try:
        if '.' in s: return float(s)
        return int(s)
    except (ValueError, TypeError):
        return 0

def extract_ids(rows, col):
    """从 '名称（123）' 提取 ID 列表"""
    import re
    ids = set()
    for r in rows:
        if len(r) > col:
            m = re.search(r'[\(（](\d+)[\)）]\s*$', r[col])
            if m: ids.add(m.group(1))
    return ids

def aggregate_games(rows, network_ids):
    """游戏统计 → 拆网游/单机 聚合"""
    import re
    agg = {}
    for r in rows:
        if len(r) < 14: continue
        k = r[1]
        if k == '-': continue
        if k not in agg: agg[k] = [k] + [0]*10
        # cols: 0日期 1游戏 2注册 3日活 4次日 5下载 6充值人数 7充值额 8退款 9消费G点 10注册付费人 11注册付费额 12留存付费人 13留存付费额
        agg[k][1] += _num(r[2])   # 注册
        agg[k][2] += _num(r[3])   # 日活
        agg[k][3] += _num(r[5])   # 下载
        agg[k][4] += _num(r[7])   # 充值额
        agg[k][5] += _num(r[9])   # 消费G点
        agg[k][6] += _num(r[10])  # 注册付费人数
        agg[k][7] += _num(r[11])  # 注册付费金额
        agg[k][8] += _num(r[12])  # 留存付费人数
        agg[k][9] += _num(r[13])  # 留存付费金额
        agg[k][10] += _num(r[6])  # 充值人数
    wy, dj = [], []
    for r in agg.values():
        m = re.search(r'[\(（](\d+)[\)）]\s*$', r[0])
        gid = m.group(1) if m else None
        if gid and gid in network_ids:
            wy.append(r)
        else:
            # 单机：只取下载量/消费G点
            dj.append([r[0], r[3], r[5], 0, 0])
    wy.sort(key=lambda x: -x[4])
    dj.sort(key=lambda x: -x[2])
    return wy, dj[:20]

def aggregate_taocan(rows):
    """套餐统计聚合"""
    agg = {}
    for r in rows:
        if len(r) < 14: continue
        k = (r[1], r[2])
        if k not in agg: agg[k] = [r[1], r[2], 0, 0, 0, 0, 0, 0, 0]
        agg[k][2] += _num(r[3])   # 点击次数
        agg[k][3] += _num(r[4])   # 点击人数
        agg[k][4] += _num(r[6])   # 下单次数
        agg[k][5] += _num(r[7])   # 下单人数
        agg[k][6] += _num(r[9])   # 成功次数
        agg[k][7] += _num(r[11])  # 购买金额
        agg[k][8] += _num(r[13])  # 实际收入
    out = [r for r in agg.values() if r[7] > 0]
    out.sort(key=lambda x: -x[7])
    return out

def aggregate_channel(rows):
    """渠道统计聚合"""
    agg = {}
    for r in rows:
        if len(r) < 14: continue
        if r[0] == '合计': continue
        k = r[1]
        if k not in agg: agg[k] = [k] + [0]*10
        agg[k][1] += _num(r[2])
        agg[k][2] += _num(r[3])
        agg[k][3] += _num(r[5])
        agg[k][4] += _num(r[7])
        agg[k][5] += _num(r[9])
        agg[k][6] += _num(r[10])
        agg[k][7] += _num(r[11])
        agg[k][8] += _num(r[12])
        agg[k][9] += _num(r[13])
        agg[k][10] += _num(r[6])
    out = [r for r in agg.values() if r[4] > 0]
    out.sort(key=lambda x: -x[4])
    return out

def aggregate_ltv(rows):
    """LTV 按注册日聚合"""
    agg = {}
    for r in rows:
        if len(r) < 12: continue
        d = r[0]
        if d not in agg: agg[d] = {'acc': 0, 'D1': 0, 'D7': 0, 'D14': 0, 'D30': 0}
        acc = _num(r[2])
        agg[d]['acc'] += acc
        agg[d]['D1'] += acc * _num(r[3])
        agg[d]['D7'] += acc * _num(r[9])
        agg[d]['D14'] += acc * _num(r[10])
        agg[d]['D30'] += acc * _num(r[11])
    out = []
    for d, v in agg.items():
        a = v['acc'] or 1
        out.append([d, v['acc'], round(v['D1']/a, 3), round(v['D7']/a, 3), round(v['D14']/a, 3), round(v['D30']/a, 3)])
    out.sort(key=lambda r: r[0], reverse=True)
    return out

def aggregate_retention(rows):
    """留存率按注册日聚合"""
    agg = {}
    for r in rows:
        if len(r) < 12: continue
        d = r[0]
        if d not in agg: agg[d] = {'regs': 0, 'D1': 0, 'D3': 0, 'D7': 0, 'D14': 0, 'D30': 0}
        regs = _num(r[2])
        agg[d]['regs'] += regs
        agg[d]['D1'] += regs * _num(r[3]) / 100
        agg[d]['D3'] += regs * _num(r[5]) / 100
        agg[d]['D7'] += regs * _num(r[9]) / 100
        agg[d]['D14'] += regs * _num(r[10]) / 100
        agg[d]['D30'] += regs * _num(r[11]) / 100
    out = []
    for d, v in agg.items():
        r = v['regs'] or 1
        out.append([d, v['regs'], round(v['D1']/r*100, 2), round(v['D3']/r*100, 2), round(v['D7']/r*100, 2), round(v['D14']/r*100, 2), round(v['D30']/r*100, 2)])
    out.sort(key=lambda r: r[0], reverse=True)
    return out

def write_data_js(path, DAILY, WANGYOU, DANJI, TAOCAN, CHANNEL, LTV, RETENTION):
    snapshot = datetime.now().strftime('%Y-%m-%d %H:%M')
    js = f"""// 自动生成 {snapshot} · 数据源：admin1866 后台

const SNAPSHOT_AT = "{snapshot}";

const DAILY = {json.dumps(DAILY, ensure_ascii=False)};

const WANGYOU = {json.dumps(WANGYOU, ensure_ascii=False)};

const DANJI = {json.dumps(DANJI, ensure_ascii=False)};

const TAOCAN = {json.dumps(TAOCAN, ensure_ascii=False)};

const CHANNEL = {json.dumps(CHANNEL, ensure_ascii=False)};

const LTV = {json.dumps(LTV, ensure_ascii=False)};

const RETENTION = {json.dumps(RETENTION, ensure_ascii=False)};
"""
    path.write_text(js, encoding='utf-8')

def push_github(repo):
    try:
        subprocess.run(['git', '-C', str(repo), 'add', 'data.js'], check=True, capture_output=True)
        r = subprocess.run(['git', '-C', str(repo), 'diff', '--cached', '--quiet'], capture_output=True)
        if r.returncode == 0:
            print('  (data 无变化，跳过提交)')
            return True
        msg = f'auto: 数据更新 {datetime.now().strftime("%Y-%m-%d")}'
        subprocess.run(['git', '-C', str(repo), '-c', 'user.name=eight', '-c', 'user.email=linnn.w14@gmail.com',
                       'commit', '-m', msg], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(repo), 'push'], check=True, capture_output=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f'git error: {e.stderr.decode() if e.stderr else e}', file=sys.stderr)
        return False


if __name__ == '__main__':
    sys.exit(main())
