#!/bin/bash
# Ubuntu/Debian 一键装：Python venv + Playwright + Chromium + GitHub Actions runner
# 用法：bash setup_runner_linux.sh
set -e

REPO_URL="https://github.com/eightnrcn2025-create/commercial-dashboard-2026-05"
DASH_DIR="/opt/commercial-dashboard"
RUNNER_DIR="/opt/actions-runner"
RUNNER_VERSION="2.319.1"

if [ "$(id -u)" != "0" ]; then
  echo "⚠️ 需要 root（用 sudo 跑，或直接 root 登录）"; exit 1
fi

echo ""
echo "===================================="
echo "Dashboard Runner Setup (Ubuntu)"
echo "===================================="

# 1. 系统依赖
echo ""
echo "[1/6] apt 装系统依赖..."
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip git curl jq

# 2. 克隆 / 更新仓库
echo ""
echo "[2/6] 克隆仓库到 $DASH_DIR..."
if [ -d "$DASH_DIR/.git" ]; then
  cd "$DASH_DIR" && git pull --rebase --quiet || true
else
  git clone --quiet "$REPO_URL" "$DASH_DIR"
fi
cd "$DASH_DIR"

# 3. Python venv + 库
echo ""
echo "[3/6] 装 Python venv + playwright + pyotp..."
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet playwright pyotp

# 4. Chromium + 系统依赖
echo ""
echo "[4/6] 装 Chromium（含系统库，约 200MB，慢一些）..."
playwright install-deps chromium 2>&1 | tail -3 || true
playwright install chromium 2>&1 | tail -3

# 5. .env 文件（密码）
echo ""
echo "[5/6] 配置 secrets 到 .env..."
if [ -f /root/.env ]; then
  cp /root/.env "$DASH_DIR/.env"
  chmod 600 "$DASH_DIR/.env"
  echo "    ✓ 用了 /root/.env"
elif [ -f "$DASH_DIR/.env" ]; then
  chmod 600 "$DASH_DIR/.env"
  echo "    ✓ 已有 $DASH_DIR/.env"
else
  echo "    ⚠️ 没找到 .env。需要 5 个 secrets，下面隐藏输入（输不会显示）"
  > "$DASH_DIR/.env"
  for k in admin1866-basic-user admin1866-basic-pass admin1866-username admin1866-password admin1866-totp-seed; do
    read -s -p "  $k: " v
    echo
    echo "$k=$v" >> "$DASH_DIR/.env"
  done
  chmod 600 "$DASH_DIR/.env"
fi

# 6. GitHub Actions Runner
echo ""
echo "[6/6] 装 GitHub Actions Runner..."
mkdir -p "$RUNNER_DIR" && cd "$RUNNER_DIR"

if [ ! -f config.sh ]; then
  ARCH=$(uname -m)
  if [ "$ARCH" = "x86_64" ]; then
    PKG="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
  elif [ "$ARCH" = "aarch64" ]; then
    PKG="actions-runner-linux-arm64-${RUNNER_VERSION}.tar.gz"
  else
    echo "✗ 不支持的架构：$ARCH"; exit 1
  fi
  curl -sS -O -L "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${PKG}"
  tar xzf "$PKG"
fi

if [ -z "$RUNNER_TOKEN" ]; then
  echo ""
  echo "去这个网址拿 RUNNER TOKEN（A... 或 B... 开头）："
  echo "  https://github.com/eightnrcn2025-create/commercial-dashboard-2026-05/settings/actions/runners/new"
  echo ""
  read -p "粘贴 RUNNER TOKEN: " RUNNER_TOKEN
fi

export RUNNER_ALLOW_RUNASROOT=1

# 删旧配置（如果有）
if [ -f .runner ]; then
  ./svc.sh stop 2>/dev/null || true
  ./svc.sh uninstall 2>/dev/null || true
  ./config.sh remove --token "$RUNNER_TOKEN" 2>/dev/null || true
fi

./config.sh --url "$REPO_URL" \
            --token "$RUNNER_TOKEN" \
            --name "vps-$(hostname)" \
            --labels "self-hosted,Linux,X64" \
            --unattended \
            --replace

./svc.sh install root
./svc.sh start

echo ""
echo "===================================="
echo "✅ 全部装好"
echo "===================================="
echo ""
echo "测试脚本: cd $DASH_DIR && source .venv/bin/activate && python update_data.py"
echo "Runner 状态: cd $RUNNER_DIR && ./svc.sh status"
echo "Runner 日志: tail -f $RUNNER_DIR/_diag/Runner_*.log"
