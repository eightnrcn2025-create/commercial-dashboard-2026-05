#!/bin/bash
# 一次性安装：venv + playwright + chromium
set -e

cd "$(dirname "$0")"

echo "[1/3] 创建 Python venv..."
python3 -m venv .venv
source .venv/bin/activate

echo "[2/3] 装依赖..."
pip install --quiet playwright

echo "[3/3] 装 Chromium..."
playwright install chromium

echo ""
echo "✅ 安装完成"
echo ""
echo "下一步："
echo "  1. 接公司 VPN（如果你不在公司网内）"
echo "  2. 跑 ./run.sh，首次会弹出浏览器，你在里面手动登录 admin1866"
echo "  3. 登好后按回车继续，脚本会自动扒数据 + 推 GitHub"
