#!/bin/bash
# 部署 ESPN + MySQL 版后端
# 在服务器 server 目录执行: bash deploy/restart-espn.sh
set -e
cd "$(dirname "$0")/.."

echo "========== 1. 检查文件 =========="
for f in src/espnClient.js src/db.js src/dataService.js sql/schema.sql; do
  if [ ! -f "$f" ]; then
    echo "❌ 缺少 $f"
    exit 1
  fi
done
echo "✓ 核心文件齐全"

echo ""
echo "========== 2. 安装依赖 =========="
npm install --production

echo ""
echo "========== 3. 重启 PM2 =========="
if pm2 describe zuqiu-api >/dev/null 2>&1; then
  pm2 restart zuqiu-api
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

sleep 2
echo ""
echo "========== 4. 健康检查 =========="
HEALTH=$(curl -s http://127.0.0.1:3000/api/health)
echo "$HEALTH"
if echo "$HEALTH" | grep -q '"provider":"espn"'; then
  echo "✅ ESPN 后端已生效"
else
  echo "❌ 健康检查异常"
  pm2 logs zuqiu-api --lines 20 --nostream
  exit 1
fi

if echo "$HEALTH" | grep -q '"storage":"mysql"'; then
  echo "✅ MySQL 读库模式已启用"
else
  echo "⚠ 未启用数据库（检查 .env 中 USE_DATABASE 与 DB_*）"
fi
