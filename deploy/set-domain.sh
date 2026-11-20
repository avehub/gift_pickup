#!/usr/bin/env bash
# 在服务器上执行：把域名写入 .env 的 DOMAINS 并立即应用 Nginx/证书。
#   bash deploy/set-domain.sh "gift.example.com www.gift.example.com"
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

if [ $# -lt 1 ] || [ -z "${1// }" ]; then
  echo "用法：bash deploy/set-domain.sh \"a.example.com www.a.example.com\"" >&2
  exit 1
fi

new_domains="$(printf '%s' "$1" | tr ',' ' ' | tr -s ' ' | sed 's/^ *//;s/ *$//')"
[ -n "$new_domains" ] || { echo "域名不能为空" >&2; exit 1; }
[ -f .env ] || { echo "缺少 $APP_DIR/.env" >&2; exit 1; }

old_domains="$(grep -E '^[[:space:]]*DOMAINS=' .env | tail -1 | cut -d= -f2- | tr -d '"' || true)"
old_primary="$(printf '%s' "$old_domains" | tr ',' ' ' | awk '{print $1}')"
current_public="$(grep -E '^[[:space:]]*PUBLIC_BASE_URL=' .env | tail -1 | cut -d= -f2- | tr -d '"' || true)"

replace_key() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" '
    BEGIN { done = 0 }
    $0 ~ "^[[:space:]]*" k "=" { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' .env > "$tmp"
  cat "$tmp" > .env
  rm -f "$tmp"
}

replace_key DOMAINS "\"$new_domains\""

# PUBLIC_BASE_URL 为空，或仍指向上一个域名时，跟随新域名。
if [ -z "$current_public" ] || { [ -n "$old_primary" ] && [ "$current_public" = "https://$old_primary" ]; }; then
  replace_key PUBLIC_BASE_URL "https://$(printf '%s' "$new_domains" | awk '{print $1}')"
fi

echo "==> .env 已更新：DOMAINS=\"$new_domains\""
bash "$APP_DIR/deploy/apply-domain.sh"
