#!/usr/bin/env bash
# 在服务器上执行：生成生产 .env（首次）、构建镜像、启动容器、健康检查。
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

log() { printf '\n==> %s\n' "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 docker" >&2
  exit 1
fi

if [ ! -f .env ]; then
  log "首次部署：从 .env.example 生成 .env"
  sed \
    -e 's/^BIND_ADDR=.*/BIND_ADDR=127.0.0.1/' \
    -e 's/^HOST_PORT=.*/HOST_PORT=9001/' \
    -e 's/^MOCK=.*/MOCK=0/' \
    .env.example > .env
  chmod 600 .env
fi

# 强制生产口径：只在本机回环监听，由主机 Nginx 对外。
if grep -q '^BIND_ADDR=' .env; then
  sed -i 's|^BIND_ADDR=.*|BIND_ADDR=127.0.0.1|' .env
else
  printf '\nBIND_ADDR=127.0.0.1\n' >> .env
fi

log "构建镜像"
docker compose build

log "启动容器"
docker compose up -d --remove-orphans

log "等待健康检查"
container="$(docker compose ps -q gift)"
if [ -z "$container" ]; then
  echo "未找到 gift 容器" >&2
  exit 1
fi

health="unknown"
for _ in $(seq 1 45); do
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || echo missing)"
  case "$health" in
    healthy) break ;;
    unhealthy) break ;;
  esac
  sleep 2
done

if [ "$health" != "healthy" ]; then
  echo "容器健康状态：$health" >&2
  docker compose logs --tail=80 gift >&2 || true
  exit 1
fi

log "本机健康检查"
curl -fsS --max-time 5 http://127.0.0.1:9001/api/health
echo

log "容器状态"
docker compose ps

# 域名已配置时顺带同步 Nginx 与证书；未配置则跳过。
if [ -f deploy/apply-domain.sh ]; then
  bash deploy/apply-domain.sh || {
    echo "警告：域名/Nginx 配置未完成，应用本身已正常运行。" >&2
    echo "      修好 .env 的 DOMAINS 后执行：cd $APP_DIR && bash deploy/apply-domain.sh" >&2
    exit 1
  }
fi
