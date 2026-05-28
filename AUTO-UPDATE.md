# 每日自动更新设置（一次设好，之后不管）

## 安装步骤（约 5 分钟）

### 第 1 步：装 Playwright 和浏览器

```bash
cd /Users/laoba/commercial-dashboard
./setup.sh
```

### 第 2 步：首次运行（人工登一次 admin）

```bash
./run.sh
```

会弹出一个浏览器窗口。**在窗口里登录 admin1866**，登好后回到终端按 **回车**，脚本就会自动扒数据。

之后浏览器登录态会一直保留，**不用再登**（除非后台主动让你过期）。

### 第 3 步：装每日定时

```bash
./install_cron.sh
```

设好之后，每天 **9:00 / 11:00 / 14:00** 三个时间点会自动跑（多个时间点保证你 Mac 任何一个时间开着都能跑到）。

## 三个限制必须知道

| 限制 | 说明 |
|---|---|
| 🔒 **你 Mac 在公司网/VPN** | admin1866 是 `.line.ccc` 内网域名，公网打不到 |
| 💻 **你 Mac 要开机** | Mac 睡眠/关机时定时任务不会跑 |
| 🍪 **后台会话会过期** | 一般几周到几个月。过期了脚本会失败，再跑一次 `./run.sh` 重新登一次 |

## 检查是否在跑

```bash
# 看下次什么时候跑
launchctl list | grep dashboard

# 立刻跑一次（不等定时）
launchctl start com.eight.dashboard-update

# 看日志
tail -50 /Users/laoba/commercial-dashboard/logs/stderr.log
```

## 临时关闭

```bash
launchctl unload ~/Library/LaunchAgents/com.eight.dashboard-update.plist
```

## 完全卸载

```bash
launchctl unload ~/Library/LaunchAgents/com.eight.dashboard-update.plist
rm ~/Library/LaunchAgents/com.eight.dashboard-update.plist
rm -rf ~/.dashboard-chrome-profile
```

## 出问题怎么办

**症状：脚本说"NOT LOGGED IN"**
→ 你的后台会话过期了。删 Chrome profile 重新登一次：
```bash
rm -rf ~/.dashboard-chrome-profile
./run.sh
```

**症状：脚本报网络错误**
→ 检查是否接了公司 VPN

**症状：GitHub 没更新但脚本说成功了**
→ 等 1-2 分钟，Pages 重新构建需要时间。看：https://github.com/eightnrcn2025-create/commercial-dashboard-2026-05/actions

**症状：定时任务没自动跑**
→ Mac 当时可能睡眠了。运行：
```bash
launchctl start com.eight.dashboard-update
```
手动触发一次
