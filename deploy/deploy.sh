#!/usr/bin/env bash
# 本地执行：把当前工作区同步到 gdk-ps 并完成构建、启动、健康检查。
#
#   ./deploy/deploy.sh
#   ./deploy/deploy.sh --domain "gift.example.com www.gift.example.com"
#
# 域名也可以事后在服务器上改 /opt/gift-pickup/.env 的 DOMAINS，
# 然后执行：bash /opt/gift-pickup/deploy/apply-domain.sh
set -euo pipefail

HOST="${DEPLOY_HOST:-gdk-ps}"
REMOTE_DIR="${REMOTE_DIR:-/opt/gift-pickup}"

usage() {
  cat <<'USAGE'
用法：
  deploy/deploy.sh                       同步并部署（域名沿用服务器 .env）
  deploy/deploy.sh --domain "a.com b.com"  同步部署，并写入 DOMAINS 后申请证书
  deploy/deploy.sh --set-only "a.com"      只更新域名/证书，不重新构建
环境变量：
  DEPLOY_HOST  默认 gdk-ps
  REMOTE_DIR   默认 /opt/gift-pickup
USAGE
}

mode="deploy"
domains=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) [ $# -ge 2 ] || { usage; exit 1; }; domains="$2"; shift 2 ;;
    --set-only) mode="set-only"; [ $# -ge 2 ] || { usage; exit 1; }; domains="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage; exit 1 ;;
  esac
done

if [ "$mode" = "set-only" ]; then
  ssh "$HOST" "cd '$REMOTE_DIR' && bash deploy/set-domain.sh $(printf '%q' "$domains")"
  exit 0
fi

echo "==> 同步到 $HOST:$REMOTE_DIR"
ssh "$HOST" "mkdir -p '$REMOTE_DIR'"

# .env 与本地开发文件不同步：生产 .env 只保留在服务器上。
rsync -az --delete \
  --exclude '.git' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude 'node_modules' \
  --exclude 'screenshots' \
  --exclude '.chrome-profile' \
  --exclude '.memsearch' \
  --exclude '.DS_Store' \
  ./ "$HOST:$REMOTE_DIR/"

if [ -n "$domains" ]; then
  echo "==> 写入域名并申请证书：$domains"
  ssh "$HOST" "cd '$REMOTE_DIR' && bash deploy/set-domain.sh $(printf '%q' "$domains")"
fi

echo "==> 远程构建并启动"
ssh "$HOST" "cd '$REMOTE_DIR' && bash deploy/server-release.sh"

echo "==> 完成"
