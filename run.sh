#!/bin/bash
# launchd 调这个脚本：激活 venv → 跑 update_data.py → 记日志
cd "$(dirname "$0")"
source .venv/bin/activate
exec python3 update_data.py
