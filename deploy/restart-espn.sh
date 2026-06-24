#!/bin/bash
# 部署 ESPN → MySQL → API 读库 模式
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
echo "========== 3. 数据库（USE_DATABASE=true 时）=========="
if [ -f .env ] && grep -q '^USE_DATABASE=true' .env; then
  npm run db:init
  echo "→ 执行全量同步（ESPN → MySQL）..."
  npm run sync:once
else
  echo "⚠ 跳过 db:init / sync:once（.env 未设置 USE_DATABASE=true）"
  echo "  生产环境必须配置 RDS 并启用 USE_DATABASE=true"
fi

echo ""
echo "========== 4. 重启 PM2 =========="
if pm2 describe zuqiu-api >/dev/null 2>&1; then
  pm2 restart zuqiu-api
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

sleep 3
echo ""
echo "========== 5. 健康检查 =========="
HEALTH=$(curl -s http://127.0.0.1:3000/api/health)
echo "$HEALTH"
if echo "$HEALTH" | grep -q '"provider":"espn"'; then
  echo "✅ API 进程正常"
else
  echo "❌ 健康检查异常"
  pm2 logs zuqiu-api --lines 20 --nostream
  exit 1
fi

if echo "$HEALTH" | grep -q '"storage":"mysql"'; then
  echo "✅ MySQL 读库模式已启用（API 不直连 ESPN）"
else
  echo "❌ 未启用 MySQL 读库 — 请在 .env 配置 USE_DATABASE=true 与 DB_* 后重新部署"
  exit 1
fi
