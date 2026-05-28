#!/bin/bash
# 装定时任务到 macOS launchd
set -e

PLIST=/Users/laoba/commercial-dashboard/com.eight.dashboard-update.plist
TARGET=$HOME/Library/LaunchAgents/com.eight.dashboard-update.plist

mkdir -p /Users/laoba/commercial-dashboard/logs
mkdir -p "$HOME/Library/LaunchAgents"

# 复制 plist
cp "$PLIST" "$TARGET"

# 卸了旧的（如果有）+ 装新的
launchctl unload "$TARGET" 2>/dev/null || true
launchctl load "$TARGET"

echo "✅ 已安装：每天 9:00 / 11:00 / 14:00 三个时间点自动跑"
echo ""
echo "查看状态：  launchctl list | grep dashboard"
echo "立刻跑一次： launchctl start com.eight.dashboard-update"
echo "卸载：      launchctl unload $TARGET"
echo ""
echo "日志位置：  /Users/laoba/commercial-dashboard/logs/"
