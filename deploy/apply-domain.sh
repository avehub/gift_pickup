#!/usr/bin/env bash
# 在服务器上执行：读取 .env 的 DOMAINS，生成 Nginx vhost 并用 acme.sh 申请/续装证书。
#   bash deploy/apply-domain.sh
# 幂等：域名没变且证书存在时只做一次 nginx -t + reload。
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

NGINX_CONF_DIR="/www/server/panel/vhost/nginx"
CONF="$NGINX_CONF_DIR/zz-gift-pickup.conf"
TEMPLATE="$APP_DIR/deploy/nginx.conf.template"
CERT_ROOT="/www/server/panel/vhost/cert"
WEBROOT="/var/www/certbot"
ACME="/root/.acme.sh/acme.sh"

log() { printf '\n==> %s\n' "$*"; }
die() { echo "错误：$*" >&2; exit 1; }

[ -f .env ] || die "缺少 $APP_DIR/.env"
set -a
# shellcheck disable=SC1091
. ./.env
set +a

if [ -z "${DOMAINS:-}" ]; then
  log "DOMAINS 为空，跳过 Nginx/证书配置"
  exit 0
fi

raw="${DOMAINS//,/ }"
read -r -a input <<< "$raw"
domains=()
for item in "${input[@]}"; do
  d="$(printf '%s' "$item" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  [ -n "$d" ] || continue
  case "$d" in
    *example.com|localhost|127.0.0.1)
      log "DOMAINS 仍是占位值（$d），跳过 Nginx/证书配置"
      exit 0
      ;;
  esac
  printf '%s' "$d" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$' \
    || die "域名格式不正确：$d"
  domains+=("$d")
done
[ "${#domains[@]}" -gt 0 ] || die "DOMAINS 无可用的域名"

primary="${domains[0]}"
domain_list="${domains[*]}"
cert_dir="$CERT_ROOT/$primary"

log "域名：$domain_list"

# 解析检查（只提示，不阻断 CDN 场景）
server_ip="$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || true)"
for d in "${domains[@]}"; do
  resolved="$(getent ahostsv4 "$d" 2>/dev/null | awk 'NR==1{print $1}' || true)"
  if [ -z "$resolved" ]; then
    die "$d 无法解析，请先把域名 A 记录指向本机后再执行"
  fi
  if [ -n "$server_ip" ] && [ "$resolved" != "$server_ip" ]; then
    echo "提示：$d 解析到 $resolved，本机公网 IP 为 $server_ip（若走 CDN 可忽略）" >&2
  fi
done

[ -x "$ACME" ] || die "未找到 acme.sh：$ACME"
mkdir -p "$WEBROOT" "$CERT_ROOT" "$NGINX_CONF_DIR"

# 判断域名列表是否变化（以现有 vhost 的 server_name 为准）
changed=1
if [ -f "$CONF" ]; then
  current="$(awk '/^[[:space:]]*server_name[[:space:]]/{for(i=2;i<=NF;i++){sub(/;$/,"",$i); if($i!="")printf "%s ",$i}; exit}' "$CONF" | sed 's/[[:space:]]*$//')"
  if [ "$current" = "$domain_list" ]; then
    changed=0
  fi
fi

if [ ! -f "$cert_dir/fullchain.pem" ] || [ "$changed" = "1" ]; then
  log "写入 HTTP 验证用 vhost（证书签发前先让 80 端口可访问）"
  cat > "$CONF" <<HTTPCONF
# gift-pickup H5 —— 证书签发中的临时配置，apply-domain.sh 会自动覆盖
server {
    listen 80;
    listen [::]:80;
    server_name $domain_list;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}
HTTPCONF
  nginx -t
  nginx -s reload

  log "申请证书（acme.sh / Let's Encrypt）"
  acme_home="$(dirname "$ACME")"
  issued_cert="$acme_home/${primary}_ecc/fullchain.cer"
  force=""
  if [ "$changed" = "1" ] && [ -f "$cert_dir/fullchain.pem" ]; then
    force="--force"
  fi
  if [ ! -f "$issued_cert" ] || [ -n "$force" ]; then
    issue_args=()
    for d in "${domains[@]}"; do issue_args+=(-d "$d"); done
    # shellcheck disable=SC2086
    "$ACME" --issue --server letsencrypt "${issue_args[@]}" \
      -w "$WEBROOT" --keylength ec-256 $force
  else
    echo "证书已存在，跳过签发：$issued_cert"
  fi

  log "安装证书到 $cert_dir"
  mkdir -p "$cert_dir"
  "$ACME" --install-cert -d "$primary" --ecc \
    --key-file "$cert_dir/privkey.pem" \
    --fullchain-file "$cert_dir/fullchain.pem" \
    --reloadcmd "nginx -t && nginx -s reload"
fi

log "写入正式 vhost：$CONF"
sed \
  -e "s|__DOMAINS__|$domain_list|g" \
  -e "s|__CERT_DIR__|$cert_dir|g" \
  "$TEMPLATE" > "$CONF"

nginx -t
nginx -s reload

if [ -n "${PUBLIC_BASE_URL:-}" ]; then
  public_host="$(printf '%s' "$PUBLIC_BASE_URL" | sed -e 's|^[a-zA-Z]*://||' -e 's|/.*$||' -e 's|:.*$||')"
  keep=0
  for d in "${domains[@]}"; do
    [ "$public_host" = "$d" ] && keep=1
  done
  if [ "$keep" = "0" ]; then
    echo "提示：PUBLIC_BASE_URL=$PUBLIC_BASE_URL 不在当前域名列表内，canonical 可能指向旧域名；如需更新请修改 .env。" >&2
  fi
fi

if [ -z "${PUBLIC_BASE_URL:-}" ]; then
  log "PUBLIC_BASE_URL 为空，写入 https://$primary 并重启容器"
  tmp="$(mktemp)"
  awk -v v="https://$primary" '
    BEGIN { done = 0 }
    /^[[:space:]]*PUBLIC_BASE_URL=/ { print "PUBLIC_BASE_URL=" v; done = 1; next }
    { print }
    END { if (!done) print "PUBLIC_BASE_URL=" v }
  ' .env > "$tmp"
  cat "$tmp" > .env
  rm -f "$tmp"
fi

log "同步容器环境变量"
docker compose up -d gift

log "完成：https://$primary"
