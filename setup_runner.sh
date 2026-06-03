#!/bin/bash
# 注册你 Mac 为 GitHub Actions 自托管 runner
# 用法：./setup_runner.sh <RUNNER_TOKEN>
# RUNNER_TOKEN 从 https://github.com/eightnrcn2025-create/commercial-dashboard-2026-05/settings/actions/runners/new 取
set -e

if [ -z "$1" ]; then
  echo "用法：./setup_runner.sh <RUNNER_TOKEN>"
  echo ""
  echo "去这个网址拿 RUNNER_TOKEN（A...开头的字符串）："
  echo "  https://github.com/eightnrcn2025-create/commercial-dashboard-2026-05/settings/actions/runners/new"
  echo ""
  echo "页面里 'Configure' 那段 ./config.sh 命令 --token 后面的就是"
  exit 1
fi

TOKEN="$1"
RUNNER_DIR="$HOME/actions-runner"

# 检查架构
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  PKG="actions-runner-osx-arm64-2.319.1.tar.gz"
else
  PKG="actions-runner-osx-x64-2.319.1.tar.gz"
fi

echo "[1/4] 下载 runner ($PKG)..."
mkdir -p "$RUNNER_DIR" && cd "$RUNNER_DIR"
if [ ! -f "$PKG" ]; then
  curl -sS -O -L "https://github.com/actions/runner/releases/download/v2.319.1/$PKG"
fi
tar xzf "$PKG"

echo "[2/4] 注册到 GitHub repo..."
./config.sh --url https://github.com/eightnrcn2025-create/commercial-dashboard-2026-05 \
            --token "$TOKEN" \
            --name "$(hostname)-runner" \
            --labels "self-hosted,macOS" \
            --unattended \
            --replace

echo "[3/4] 装为后台服务..."
./svc.sh install

echo "[4/4] 启动..."
./svc.sh start

echo ""
echo "✅ 装好了。runner 现在常驻后台。"
echo ""
echo "查看状态：cd ~/actions-runner && ./svc.sh status"
echo "停止：    cd ~/actions-runner && ./svc.sh stop"
echo "卸载：    cd ~/actions-runner && ./svc.sh uninstall && ./config.sh remove --token <NEW_TOKEN>"
