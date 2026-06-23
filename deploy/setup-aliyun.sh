#!/bin/bash
# 阿里云轻量服务器首次初始化（Ubuntu 22.04 / Alibaba Cloud Linux 3）
# 用法：sudo bash setup-aliyun.sh

set -e

echo "==> 安装 Node.js 20"
if ! command -v node &>/dev/null; then
  curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - 2>/dev/null || \
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  if command -v apt-get &>/dev/null; then
    apt-get install -y nodejs
  else
    yum install -y nodejs
  fi
fi
node -v
npm -v

echo "==> 安装 PM2、Nginx"
npm install -g pm2
if command -v apt-get &>/dev/null; then
  apt-get update && apt-get install -y nginx
else
  yum install -y nginx
fi

echo "==> 创建目录"
mkdir -p /var/www/zuqiu/server
mkdir -p /etc/nginx/ssl

echo ""
echo "完成。接下来请："
echo "  1. 把 server/ 上传到 /var/www/zuqiu/server"
echo "  2. cd /var/www/zuqiu/server && npm install --production"
echo "  3. 创建 .env（FOOTBALL_DATA_TOKEN=...）"
echo "  4. pm2 start ecosystem.config.cjs && pm2 save && pm2 startup"
echo "  5. 复制 deploy/nginx-zuqiu.conf 到 /etc/nginx/conf.d/ 并改域名、证书"
echo "  6. nginx -t && systemctl reload nginx"
echo "  7. 阿里云安全组放行 80、443"
