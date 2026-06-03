#!/usr/bin/env python3
"""一次性：从 macOS Keychain 把密码搬到 .env 文件，让后台 runner 也能读"""
import subprocess
from pathlib import Path
import os

ITEMS = [
    'admin1866-basic-user',
    'admin1866-basic-pass',
    'admin1866-username',
    'admin1866-password',
    'admin1866-totp-seed',
]

env_path = Path(__file__).parent / '.env'
lines = []
for item in ITEMS:
    try:
        v = subprocess.check_output(
            ['security', 'find-generic-password', '-s', item, '-w'],
            stderr=subprocess.PIPE
        ).decode().strip()
        lines.append(f'{item}={v}')
        print(f'✓ {item} ({len(v)} 字符)')
    except subprocess.CalledProcessError as e:
        print(f'✗ {item} 读取失败：{e.stderr.decode().strip()}')
        exit(1)

env_path.write_text('\n'.join(lines) + '\n')
os.chmod(env_path, 0o600)
print(f'\n✓ 已写到 {env_path}（权限 600）')
print('   后台 runner 现在能读了。.env 已加入 .gitignore，不会上 GitHub。')
