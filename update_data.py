#!/usr/bin/env python3
"""
每日扒商业化看板数据 → 更新 data.js → push GitHub Pages
自动登录：从 macOS 钥匙串读 用户名/密码/TOTP 种子
扒数据：用点击 sidebar 菜单代替猜 URL，避免后台改路径就挂
"""
import json
import sys
import subprocess
import re
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import pyotp
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

REPO = Path(__file__).parent
PROFILE = Path.home() / '.dashboard-chrome-profile'
ADMIN = 'http://18game.line.ccc:8001/admin1866'

today = date.today()
yest = today - timedelta(days=1)
EARLIEST = date(2025, 9, 1)       # 后台最早数据（2025-09-01）
d30 = yest - timedelta(days=29)
d7 = yest - timedelta(days=6)

def fmt(d): return d.strftime('%Y-%m-%d')

# =========== 钥匙串 + 登录 ===========

_env_cache = None
def _load_env_file():
    global _env_cache
    if _env_cache is not None: return _env_cache
    env_path = Path(__file__).parent / '.env'
    _env_cache = {}
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if '=' in line:
                k, v = line.split('=', 1)
                _env_cache[k.strip()] = v.strip()
    return _env_cache

def get_keychain(service):
    # 优先从 .env 文件（后台 runner 友好），失败再 fall back 到 keychain
    env = _load_env_file()
    if service in env:
        return env[service]
    return subprocess.check_output(
        ['security', 'find-generic-password', '-s', service, '-w']
    ).decode().strip()


def is_logged_in(page):
    """看 sidebar 是否存在判断是否登录成功"""
    try:
        page.wait_for_selector('a:has-text("系统统计"), .layui-nav, ul.layui-nav-tree', timeout=3000, state='attached')
        return True
    except PWTimeout:
        return False

def auto_login(page):
    # 直接走登录页，避免根路径 301 引发的 ERR_EMPTY_RESPONSE
    print('  [login] 走登录流程...', flush=True)
    last_err = None
    for attempt in range(6):  # 重试 6 次，最长等 ~80 秒
        try:
            page.goto(f'{ADMIN}/login', wait_until='domcontentloaded', timeout=45000)
            last_err = None
            break
        except Exception as e:
            last_err = e
            wait = min(5 + attempt * 3, 20)  # 5/8/11/14/17/20 秒
            print(f'  [login] {type(e).__name__} 等 {wait}s 后重试 ({attempt+1}/6)', flush=True)
            time.sleep(wait)
    if last_err:
        raise last_err
    page.wait_for_selector('input[placeholder="请输入登录账号"]', timeout=10000)

    username = get_keychain('admin1866-username')
    password = get_keychain('admin1866-password')
    seed = get_keychain('admin1866-totp-seed')
    code = pyotp.TOTP(seed).now()
    print(f'  [login] 用 username={username[:2]}***, TOTP={code[:2]}****', flush=True)

    page.fill('input[placeholder="请输入登录账号"]', username)
    page.fill('input[placeholder="请输入登录密码"]', password)
    page.fill('input[placeholder="请输入谷歌验证码"]', code)
    page.click('button:has-text("登录")')

    # 等跳转完，再检查是否登录成功
    page.wait_for_timeout(3000)
    if not is_logged_in(page):
        # 拿登录页可能的错误提示
        err = page.evaluate('() => document.body.innerText.slice(0, 300)')
        raise RuntimeError(f'登录失败，页面内容: {err!r}')
    print('  [login] ✓ 登录成功', flush=True)

# =========== 菜单导航 + 数据抓取 ===========

# 真实报表 URL（从 sidebar 的 lay-href 扒出来的）
REPORT_URLS = {
    '系统统计-报表':     '/admin1866/system/reportTotalDayLog',
    '套餐统计':         '/admin1866/system/combo',
    '游戏统计':         '/admin1866/system/game',
    '渠道统计':         '/admin1866/system/channel',
    '网络游戏运营统计':   '/admin1866/system/networkGame',
    '网络游戏注册LTV表': '/admin1866/system/gameLtv',
    '网络游戏注册留存':   '/admin1866/system/gameRetention',
}

def go_to_report(page, report_name):
    """主 page 直接 navigate 到报表 URL（layui 渲染表格在 .layui-table-view 里）"""
    path = REPORT_URLS[report_name]
    url = f'http://18game.line.ccc:8001{path}'
    page.goto(url, wait_until='domcontentloaded')
    # layui 表格异步渲染：等带数据的 tbody 出现
    page.wait_for_function(
        '() => document.querySelectorAll(".layui-table-body tbody tr, .layui-table tbody tr").length > 0 || document.querySelector(".layui-none, .layui-table-view")',
        timeout=20000
    )
    page.wait_for_timeout(1200)

def set_date_range_and_search(page, start, end):
    page.evaluate(f"""
    () => {{
      const inputs = document.querySelectorAll('input[placeholder*="yyyy"], input.layui-input');
      let dateInputs = [];
      inputs.forEach(i => {{
        const ph = (i.placeholder || '').toLowerCase();
        if (ph.includes('yyyy') || ph.includes('日期') || /^\\d{{4}}-\\d{{2}}-\\d{{2}}$/.test(i.value)) {{
          dateInputs.push(i);
        }}
      }});
      if (dateInputs.length >= 2) {{
        dateInputs[0].value = '{start}';
        dateInputs[1].value = '{end}';
        ['input', 'change', 'blur'].forEach(ev => {{
          dateInputs[0].dispatchEvent(new Event(ev, {{bubbles: true}}));
          dateInputs[1].dispatchEvent(new Event(ev, {{bubbles: true}}));
        }});
      }}
      const btns = document.querySelectorAll('button');
      for (const b of btns) {{
        if ((b.innerText || '').trim() === '搜索') {{ b.click(); return; }}
      }}
    }}
    """)
    page.wait_for_timeout(3500)

def set_page_size_3000(page):
    page.evaluate("""
    () => {
      const opts = document.querySelectorAll('.layui-laypage-limits option, select option');
      for (const o of opts) {
        if (o.value === '3000') {
          const s = o.closest('select');
          if (s) {
            s.value = o.value;
            s.dispatchEvent(new Event('change', {bubbles: true}));
            return;
          }
        }
      }
    }
    """)
    page.wait_for_timeout(3500)

def grab_rows(page):
    return page.evaluate("""
    () => {
      const tbls = document.querySelectorAll('table');
      let best = null, maxRows = 0;
      tbls.forEach(t => {
        const n = t.querySelectorAll('tbody tr').length;
        if (n > maxRows) { maxRows = n; best = t; }
      });
      if (!best) return [];
      const rows = [];
      best.querySelectorAll('tbody tr').forEach(r => {
        const cells = Array.from(r.querySelectorAll('td')).map(c => c.innerText.trim());
        if (cells.length) rows.push(cells);
      });
      return rows;
    }
    """)

def fetch_report(page, label, report_name, start, end):
    print(f'[{label}] {fmt(start)} ~ {fmt(end)} -> {report_name}', flush=True)
    go_to_report(page, report_name)
    set_date_range_and_search(page, fmt(start), fmt(end))
    set_page_size_3000(page)
    rows = grab_rows(page)
    print(f'      ✓ {len(rows)} 行', flush=True)
    return rows

def fetch_report_chunked(page, label, report_name, start, end, chunk_days=14):
    """分块抓取避免单次 3000 行上限"""
    all_rows = []
    cur = start
    i = 0
    while cur <= end:
        chunk_end = min(cur + timedelta(days=chunk_days - 1), end)
        i += 1
        print(f'[{label} chunk{i}] {fmt(cur)} ~ {fmt(chunk_end)} -> {report_name}', flush=True)
        go_to_report(page, report_name)
        set_date_range_and_search(page, fmt(cur), fmt(chunk_end))
        set_page_size_3000(page)
        rows = grab_rows(page)
        print(f'      ✓ {len(rows)} 行', flush=True)
        all_rows.extend(rows)
        cur = chunk_end + timedelta(days=1)
    return all_rows

# =========== 主流程 ===========

def main():
    PROFILE.mkdir(exist_ok=True)

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            headless=True,
            args=['--no-sandbox', '--disable-blink-features=AutomationControlled'],
            viewport={'width': 1440, 'height': 900},
            ignore_https_errors=True,
            http_credentials={
                'username': get_keychain('admin1866-basic-user'),
                'password': get_keychain('admin1866-basic-pass'),
            },
        )
        page = ctx.new_page()
        page.set_default_timeout(45000)

        try:
            auto_login(page)
        except Exception as e:
            print(f'ERROR: 登录失败 - {e}', file=sys.stderr)
            ctx.close()
            return 2

        try:
            daily = fetch_report(page, '1/7', '系统统计-报表', EARLIEST, yest)
            DAILY = [[r[0]] + [_num(x) for x in r[1:13]] for r in daily if len(r) >= 13]
            DAILY.sort(key=lambda r: r[0], reverse=True)

            # 7 天 + 30 天 双快照，前端切换用
            tc7 = fetch_report(page, '2a 套餐7天', '套餐统计', d7, yest)
            TAOCAN = aggregate_taocan(tc7)
            tc30 = fetch_report(page, '2b 套餐30天', '套餐统计', d30, yest)
            TAOCAN_30D = aggregate_taocan(tc30)

            ny7 = fetch_report(page, '3a 网游运营7天', '网络游戏运营统计', d7, yest)
            NGIDS_7D = extract_ids(ny7, col=2)
            print(f'      ✓ 识别 {len(NGIDS_7D)} 个网游(7天)', flush=True)
            ny30 = fetch_report(page, '3b 网游运营30天', '网络游戏运营统计', d30, yest)
            NGIDS_30D = extract_ids(ny30, col=2)
            print(f'      ✓ 识别 {len(NGIDS_30D)} 个网游(30天)', flush=True)

            g7 = fetch_report(page, '4a 游戏7天', '游戏统计', d7, yest)
            WANGYOU, DANJI = aggregate_games(g7, NGIDS_7D)
            g30 = fetch_report_chunked(page, '4b 游戏30天', '游戏统计', d30, yest, chunk_days=14)
            WANGYOU_30D, DANJI_30D = aggregate_games(g30, NGIDS_30D)

            ch7 = fetch_report(page, '5a 渠道7天', '渠道统计', d7, yest)
            CHANNEL = aggregate_channel(ch7)
            ch30 = fetch_report(page, '5b 渠道30天', '渠道统计', d30, yest)
            CHANNEL_30D = aggregate_channel(ch30)

            ltv = fetch_report(page, '6/7', '网络游戏注册LTV表', EARLIEST, yest)
            LTV = aggregate_ltv(ltv)

            ret = fetch_report(page, '7/7', '网络游戏注册留存', EARLIEST, yest)
            RETENTION = aggregate_retention(ret)
        except Exception as e:
            print(f'ERROR: 扒数据失败 - {type(e).__name__}: {e}', file=sys.stderr)
            import traceback; traceback.print_exc(file=sys.stderr)
            ctx.close()
            return 3

        ctx.close()

    # 与已有归档合并，避免后台滚动删除丢历史
    DAILY, LTV, RETENTION = archive_merge(REPO / 'data.js', DAILY, LTV, RETENTION)

    # 原始日级数据（30 天窗口），前端用来按自定义区间聚合
    # 字段（游戏统计）：[日期, 游戏id, 注册, 日活, 次日日活, 下载, 充值人数, 充值金额, 投诉扣款, 消费G点, 注册付费人数, 注册付费金额, 留存付费人数, 留存付费金额]
    GAMES_DAILY = [r for r in g30 if len(r) >= 14 and any(_num(x) > 0 for x in r[2:14])]
    # 字段（套餐统计）：[日期, 类型, 名称, 点击次数, 点击人数, 人均点击, 下单次数, 下单人数, 下单转化率, 成功次数, 支付成功率, 购买金额, 平均客单价, 实际收入]
    TAOCAN_DAILY = [r for r in tc30 if len(r) >= 14 and any(_num(x) > 0 for x in r[3:14])]
    # 字段（渠道统计）：同游戏统计
    CHANNEL_DAILY = [r for r in ch30 if len(r) >= 14 and any(_num(x) > 0 for x in r[2:14])]
    # 网游 ID 列表用于前端区分网游/单机
    NETWORK_GAME_IDS = sorted(NGIDS_30D)

    write_data_js(REPO / 'data.js', DAILY, WANGYOU, DANJI, TAOCAN, CHANNEL, LTV, RETENTION,
                  WANGYOU_30D, DANJI_30D, TAOCAN_30D, CHANNEL_30D,
                  GAMES_DAILY, TAOCAN_DAILY, CHANNEL_DAILY, NETWORK_GAME_IDS)
    print('✓ data.js 已更新', flush=True)

    if push_github(REPO):
        print('✓ 已推送 GitHub', flush=True)
    else:
        print('⚠️ 推送 GitHub 失败 (可能没改动或网络问题)', flush=True)
    return 0

# =========== 工具函数 ===========

def _num(s):
    try:
        s = str(s).replace(',', '').replace('%', '').strip()
        if not s or s == '-': return 0
        return float(s) if '.' in s else int(s)
    except (ValueError, TypeError):
        return 0

def extract_ids(rows, col):
    ids = set()
    for r in rows:
        if len(r) > col:
            m = re.search(r'[\(（](\d+)[\)）]\s*$', r[col])
            if m: ids.add(m.group(1))
    return ids

def aggregate_games(rows, network_ids):
    agg = {}
    for r in rows:
        if len(r) < 14: continue
        k = r[1]
        if k == '-' or not k: continue
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
    wy, dj = [], []
    for r in agg.values():
        m = re.search(r'[\(（](\d+)[\)）]\s*$', r[0])
        gid = m.group(1) if m else None
        if gid and gid in network_ids:
            wy.append(r)
        else:
            dj.append([r[0], r[3], r[5], 0, 0])
    wy.sort(key=lambda x: -x[4])
    dj.sort(key=lambda x: -x[2])
    return wy, dj[:20]

def aggregate_taocan(rows):
    agg = {}
    for r in rows:
        if len(r) < 14: continue
        k = (r[1], r[2])
        if k not in agg: agg[k] = [r[1], r[2], 0, 0, 0, 0, 0, 0, 0]
        agg[k][2] += _num(r[3])
        agg[k][3] += _num(r[4])
        agg[k][4] += _num(r[6])
        agg[k][5] += _num(r[7])
        agg[k][6] += _num(r[9])
        agg[k][7] += _num(r[11])
        agg[k][8] += _num(r[13])
    out = [r for r in agg.values() if r[7] > 0]
    out.sort(key=lambda x: -x[7])
    return out

def aggregate_channel(rows):
    agg = {}
    for r in rows:
        if len(r) < 14: continue
        if r[0] == '合计' or not r[1]: continue
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

def read_existing(path):
    """从已有 data.js 解析出 DAILY/LTV/RETENTION 归档数据"""
    if not path.exists(): return {}
    txt = path.read_text(encoding='utf-8')
    out = {}
    for name in ['DAILY', 'LTV', 'RETENTION']:
        m = re.search(rf'const {name} = (\[[\s\S]*?\]);\s*\n', txt)
        if m:
            try:
                out[name] = json.loads(m.group(1))
            except (json.JSONDecodeError, Exception):
                print(f'  [archive] 解析 {name} 失败', flush=True)
    return out

def merge_by_date(new_rows, old_rows):
    """按日期合并：日期已在 new 里的用 new；只在 old 的保留"""
    by_date = {r[0]: r for r in old_rows}
    for r in new_rows:
        by_date[r[0]] = r
    out = list(by_date.values())
    out.sort(key=lambda r: r[0], reverse=True)
    return out

def archive_merge(path, DAILY, LTV, RETENTION):
    """合并新数据和已有归档，避免后台数据被删时丢历史"""
    existing = read_existing(path)
    if not existing:
        print('  [archive] 没有已有归档，跳过合并', flush=True)
        return DAILY, LTV, RETENTION
    old_d = existing.get('DAILY', [])
    old_l = existing.get('LTV', [])
    old_r = existing.get('RETENTION', [])
    merged_d = merge_by_date(DAILY, old_d)
    merged_l = merge_by_date(LTV, old_l)
    merged_r = merge_by_date(RETENTION, old_r)
    print(f'  [archive] DAILY: 新 {len(DAILY)} + 旧 {len(old_d)} → 合并 {len(merged_d)}', flush=True)
    print(f'  [archive] LTV:   新 {len(LTV)} + 旧 {len(old_l)} → 合并 {len(merged_l)}', flush=True)
    print(f'  [archive] RETEN: 新 {len(RETENTION)} + 旧 {len(old_r)} → 合并 {len(merged_r)}', flush=True)
    return merged_d, merged_l, merged_r

def write_data_js(path, DAILY, WANGYOU, DANJI, TAOCAN, CHANNEL, LTV, RETENTION,
                  WANGYOU_30D=None, DANJI_30D=None, TAOCAN_30D=None, CHANNEL_30D=None,
                  GAMES_DAILY=None, TAOCAN_DAILY=None, CHANNEL_DAILY=None,
                  NETWORK_GAME_IDS=None):
    snapshot = datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
    js = f"""// 自动生成 {snapshot} · 数据源：admin1866 后台

const SNAPSHOT_AT = "{snapshot}";

const DAILY = {json.dumps(DAILY, ensure_ascii=False)};

const WANGYOU = {json.dumps(WANGYOU, ensure_ascii=False)};
const WANGYOU_30D = {json.dumps(WANGYOU_30D or WANGYOU, ensure_ascii=False)};

const DANJI = {json.dumps(DANJI, ensure_ascii=False)};
const DANJI_30D = {json.dumps(DANJI_30D or DANJI, ensure_ascii=False)};

const TAOCAN = {json.dumps(TAOCAN, ensure_ascii=False)};
const TAOCAN_30D = {json.dumps(TAOCAN_30D or TAOCAN, ensure_ascii=False)};

const CHANNEL = {json.dumps(CHANNEL, ensure_ascii=False)};
const CHANNEL_30D = {json.dumps(CHANNEL_30D or CHANNEL, ensure_ascii=False)};

// 原始日级数据（30天窗口）—— 前端用来按自定义区间聚合
const GAMES_DAILY = {json.dumps(GAMES_DAILY or [], ensure_ascii=False)};
const TAOCAN_DAILY = {json.dumps(TAOCAN_DAILY or [], ensure_ascii=False)};
const CHANNEL_DAILY = {json.dumps(CHANNEL_DAILY or [], ensure_ascii=False)};
const NETWORK_GAME_IDS = {json.dumps(list(NETWORK_GAME_IDS) if NETWORK_GAME_IDS else [], ensure_ascii=False)};

const LTV = {json.dumps(LTV, ensure_ascii=False)};

const RETENTION = {json.dumps(RETENTION, ensure_ascii=False)};
"""
    path.write_text(js, encoding='utf-8')

def push_github(repo):
    import os, base64
    try:
        subprocess.run(['git', '-C', str(repo), 'add', 'data.js'], check=True, capture_output=True)
        r = subprocess.run(['git', '-C', str(repo), 'diff', '--cached', '--quiet'], capture_output=True)
        if r.returncode == 0:
            print('  (data 无变化，跳过提交)', flush=True)
            return True
        msg = f'auto: 数据更新 {datetime.now().strftime("%Y-%m-%d %H:%M")}'
        subprocess.run(['git', '-C', str(repo), '-c', 'user.name=eight', '-c', 'user.email=linnn.w14@gmail.com',
                       'commit', '-m', msg], check=True, capture_output=True)

        # 优先用 GITHUB_TOKEN env（GitHub Actions runner 跑时有）
        # 否则用本地 git 配置（launchd 跑时用 Keychain）
        gh_token = os.environ.get('GITHUB_TOKEN')
        push_cmd = ['git', '-C', str(repo), 'push']
        if gh_token:
            auth = base64.b64encode(f'x-access-token:{gh_token}'.encode()).decode()
            push_cmd = ['git', '-C', str(repo),
                        '-c', f'http.extraheader=AUTHORIZATION: basic {auth}',
                        'push']
        subprocess.run(push_cmd, check=True, capture_output=True, timeout=60)
        return True
    except subprocess.CalledProcessError as e:
        print(f'git error: {e.stderr.decode() if e.stderr else e}', file=sys.stderr)
        return False
    except Exception as e:
        print(f'push error: {e}', file=sys.stderr)
        return False


if __name__ == '__main__':
    sys.exit(main())
