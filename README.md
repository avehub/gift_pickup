# 礼品提货 H5

壹捌捌名酒汇「礼品提货」移动端页面：主链接直接展示 15 年、30 年、50 年、80 年贵州茅台酒与可提货门店；带订单号的链接仍按订单展示礼品。门店按配置的固定顺序展示，点击门店地址在当前页面打开腾讯地图，并默认定位到该门店。

- 零依赖 Node.js 22 服务 + 原生 HTML/CSS/ES Module，无需前端构建。
- 同源代理上游订单接口，避免浏览器 CORS；页面不请求浏览器定位，门店顺序由服务端下发。
- 门店地址、电话、坐标可通过挂载的 `config/stores.json` 增删改，热加载。
- 上游域名支持多域名故障转移；站点域名可配置；自带 Dockerfile / Compose / 可选 Caddy 自动 HTTPS。

## 快速启动

```bash
docker compose up -d --build
```

默认映射到本机 `127.0.0.1:9001`。主链接不需要 `orderId`，直接打开即展示默认礼品（15/30/50/80 年茅台），`MOCK` 开关不影响：

```text
http://127.0.0.1:9001/
```

真实订单仍可通过 `orderId` 进入（`mock=1` 可配合订单号用于演示）：

```text
http://127.0.0.1:9001/?orderId=9701090345282028477
```

默认礼品维护在 `data/default-gift.json`，当前为 `53度贵州茅台酒15年陈酿500ml`（x6）、`53度贵州茅台酒30年陈年500ml`、`53度贵州茅台酒50年陈年500ml`、`52度贵州茅台酒80年陈年500ml`。默认 `config/stores.json` 使用 `replace` 模式，只展示设计稿给定的 4 家门店；未配置门店文件时使用默认礼品文件自带的 4 家门店兜底。

查看状态：

```bash
docker compose ps
curl http://127.0.0.1:9001/api/health
```

停止：

```bash
docker compose down
```

### 不用 Docker

```bash
node server.js
# 默认 http://127.0.0.1:3000
```

需要 Node.js >= 22。可通过环境变量覆盖端口等配置，例如 `PORT=9001 node server.js`。

## 生产部署（gdk-ps）

目标服务器已运行主机 Nginx（80/443 已占用），因此容器只发布到 `127.0.0.1:9001`，由 Nginx 反代并终止 HTTPS；生产不使用 Compose 的 `caddy` profile。

本地执行：

```bash
./deploy/deploy.sh        # 或 npm run deploy
```

脚本会：

1. rsync 同步到 `gdk-ps:/opt/gift-pickup`（不覆盖服务器上的 `.env`）；
2. 首次部署时按 `.env.example` 生成生产 `.env`（`BIND_ADDR=127.0.0.1`、`HOST_PORT=9001`、`MOCK=0`）；
3. `docker compose build` + `up -d`，等健康检查通过后打印 `/api/health`；
4. 若 `.env` 的 `DOMAINS` 仍是占位值，跳过域名配置。

配置域名（二选一）：

```bash
# 1) 本地一条命令：写入服务器 .env 并申请证书
./deploy/deploy.sh --domain "gift.example.com www.gift.example.com"

# 2) 服务器上改 .env 后执行
ssh gdk-ps
cd /opt/gift-pickup
vi .env                 # DOMAINS=gift.example.com
bash deploy/apply-domain.sh
```

域名生效前需把 A 记录指向 `119.96.53.63`。`apply-domain.sh` 会：

- 生成 `/www/server/panel/vhost/nginx/zz-gift-pickup.conf`（80 跳 443 + 反代 `127.0.0.1:9001`）；
- 用 acme.sh 申请 Let's Encrypt 证书到 `/www/server/panel/vhost/cert/<主域名>/`，续期由 acme.sh cron 自动完成；
- `PUBLIC_BASE_URL` 为空时自动写入 `https://<主域名>` 并重启容器。

日常更新与查看：

```bash
./deploy/deploy.sh
ssh gdk-ps 'cd /opt/gift-pickup && docker compose ps && curl -fsS http://127.0.0.1:9001/api/health'
```

`deploy/` 目录说明：`deploy.sh`（本地入口）、`server-release.sh`（远程构建启动）、`apply-domain.sh`（Nginx + 证书）、`set-domain.sh`（写入域名）、`nginx.conf.template`（vhost 模板）。

## 配置

`docker compose` 自动读取项目根目录的 `.env`；生产部署建议复制 `.env.example` 后修改：

```bash
cp .env.example .env
```

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST_PORT` | `9001` | 宿主机映射端口 |
| `BIND_ADDR` | `127.0.0.1` | 宿主机监听地址；局域网访问改成 `0.0.0.0` |
| `IMAGE_TAG` | `gift-pickup:local` | 镜像名 |
| `UPSTREAM_BASES` | `https://mm.qfmjh.cn` | 上游订单域名，逗号或空格分隔，按序故障转移 |
| `UPSTREAM_TIMEOUT_MS` | `10000` | 上游总超时预算（1000–60000 毫秒） |
| `PUBLIC_BASE_URL` | 空 | 站点对外地址，用于 canonical |
| `MAP_REFERER` | `188` | 腾讯地图 URI 的 referer |
| `MOCK` | `0` | `1` 才允许 `mock=1` 演示数据；生产务必为 `0` |
| `DOMAINS` | `localhost` | 仅 Caddy TLS 使用；多个域名用空格分隔 |
| `ACME_EMAIL` | `admin@example.com` | 仅 Caddy 申请证书使用 |

### 门店配置

项目自带 `config/stores.json`，默认使用 `replace` 模式，只展示设计稿给定的 4 家门店：

```json
{
  "mode": "replace",
  "add": [
    {
      "name": "榆林长兴路店",
      "phone": "0912-3851188",
      "address": "榆林市榆阳区长兴路6号（陕北矿业大楼对面）",
      "lat": 38.2852,
      "lng": 109.745
    }
  ]
}
```

编辑 `config/stores.json` 后无需重启，下一次请求自动生效。`config/stores.example.json` 是同样结构的模板：

```bash
cp config/stores.example.json config/stores.json
```

完整规则示例：

```json
{
  "mode": "merge",
  "hide": ["神木大柳塔店"],
  "overrides": [
    {
      "match": "榆林校场路店",
      "phone": "0912-3685999",
      "address": "榆林市榆阳区校场路17号（原西一路 四小北门斜对面）"
    }
  ],
  "add": [
    {
      "id": "xa-demo-1",
      "name": "西安雁塔区提货点",
      "phone": "18509120290",
      "address": "陕西省西安市雁塔区金水湾5幢商铺 中国茶叶 | 提货点",
      "lat": 34.2038,
      "lng": 108.9576
    }
  ]
}
```

- `mode`: `replace`（默认文件所用，只返回 `add` 列表）或 `merge`（在上游门店基础上修改）。
- `hide`: 按上游门店 `id` 或完整店名隐藏。
- `overrides[].match`: 按 `id` 或完整店名匹配；可改 `name`、`phone`、`address`、`lat`、`lng`。
- `add`: 新门店；`name` 必填，`id` 可选（默认 `custom-N`），坐标可选。`add` 数组的顺序就是页面自上而下的展示顺序（默认依次为榆林长兴路店、西安雁塔区配送点、西安雁塔区提货点（中国茶叶名酒专卖）、西安雁塔区提货点（中国茶叶））。
- 规则写错、JSON 损坏或 `id` 冲突时，服务端会记录告警并保留上一份有效配置，不会让页面崩溃。
- 没有坐标的门店仍会展示；点击后用「店名 + 地址」在地图中搜索。

文件变化检测基于 mtime + size；如果编辑器保留 mtime，可再保存一次或重启容器。

## 域名与 HTTPS

### 多上游域名

```dotenv
UPSTREAM_BASES=https://mm.qfmjh.cn,https://backup.example.com
```

按顺序尝试；网络错误、5xx、非法响应会切换下一个域名。上游返回「卡号不存在」等业务错误时立即返回 404，不再切换。

### 站点域名 / 自动 HTTPS

使用 Compose 的 `tls` profile：

```dotenv
DOMAINS=gift.example.com www.gift.example.com
ACME_EMAIL=ops@example.com
```

```bash
docker compose --profile tls up -d --build
```

Caddy 会读到 `deploy/Caddyfile`，自动申请证书并反向代理到 `gift:3000`。需要放行 80/443，且域名已解析到服务器。

不用 Caddy 时，可参考 `deploy/nginx.conf.example`：

```nginx
proxy_pass http://127.0.0.1:9001;
```

应用本身已设置 CSP、`X-Content-Type-Options`、`Referrer-Policy`、`X-Frame-Options`、`Permissions-Policy`。

## 门店展示顺序

- 页面不再请求浏览器定位，也不按用户位置距离排序。
- 门店按 `config/stores.json` 中 `add` 数组的顺序自上而下展示；默认顺序为榆林长兴路店、西安雁塔区配送点（188配送酒库）、西安雁塔区提货点（中国茶叶名酒专卖）、西安雁塔区提货点（中国茶叶）。
- 调整顺序只需移动 `add` 数组中的门店条目，保存后下一次请求自动生效。
- 门店距离不再展示；点击门店仍会打开腾讯地图并定位到该门店坐标。

## 手机与微信

- 页面按 320–430px 移动端宽度适配，已处理底部安全区、点击延迟、横向溢出和窄屏字号。
- 手机通过局域网调试时，可在 `.env` 设置 `BIND_ADDR=0.0.0.0`。
- 门店卡点击会尝试打开腾讯地图；微信内若阻止新窗口，会退化为当前窗口跳转。

## API

### `GET /api/health`

```json
{ "ok": true, "mock": true, "upstreams": 1 }
```

### `GET /api/gift`

不带 `orderId` 时返回 `data/default-gift.json` 中的默认礼品（15/30/50/80 年茅台），主链接即调用该接口：

```json
{
  "ok": true,
  "order": {
    "orderId": "",
    "expiresAt": "",
    "sxStationName": null,
    "items": [
      { "title": "53度贵州茅台酒15年陈酿500ml", "quantity": "6", "unitPrice": null },
      { "title": "53度贵州茅台酒30年陈年500ml", "quantity": "", "unitPrice": null },
      { "title": "53度贵州茅台酒50年陈年500ml", "quantity": "", "unitPrice": null },
      { "title": "52度贵州茅台酒80年陈年500ml", "quantity": "", "unitPrice": null }
    ],
    "stores": [
      {
        "id": "design-yulin-changxing",
        "name": "榆林长兴路店",
        "phone": "0912-3851188",
        "address": "榆林市榆阳区长兴路6号（陕北矿业大楼对面）",
        "lat": 38.247573,
        "lng": 109.760302
      }
    ]
  }
}
```

### `GET /api/gift?orderId=...&mock=1`

```json
{
  "ok": true,
  "order": {
    "orderId": "9701090345282028477",
    "expiresAt": "2027-08-06 18:20:00",
    "sxStationName": null,
    "items": [
      { "title": "53度贵州茅台酒15年陈酿500ml", "quantity": "6", "unitPrice": 4110 }
    ],
    "stores": [
      {
        "id": "mock-yulin-changxing",
        "name": "榆林长兴路店",
        "phone": "0912-3851188",
        "address": "榆林市榆阳区长兴路6号（陕北矿业大楼对面）",
        "lat": 38.2852,
        "lng": 109.745
      }
    ]
  }
}
```

错误统一为 `{ "ok": false, "code": "...", "message": "..." }`：

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `INVALID_ORDER_ID` | 订单号不是 10–25 位数字 |
| 400 | `MOCK_DISABLED` | 未开启演示数据 |
| 500 | `DEFAULT_GIFT_UNAVAILABLE` | `data/default-gift.json` 缺失或无法读取 |
| 404 | `ORDER_NOT_FOUND` | 上游返回卡号不存在 |
| 502 | `UPSTREAM_ERROR` | 上游网络/5xx/非法响应 |
| 504 | `UPSTREAM_TIMEOUT` | 上游超时 |
| 405 | `METHOD_NOT_ALLOWED` | 非 GET/HEAD |

上游接口为 `POST {UPSTREAM_BASE}/gateway/mall/physicalCardOrder/getUsableStation`，body `{"orderId":"...","latitude":"","longitude":""}`。经纬度不传给上游；门店顺序由服务端按 `config/stores.json` 的 `add` 顺序下发。

## 测试

```bash
npm test
```

覆盖：配置解析、默认礼品、上游故障转移/超时/业务错误、字段规范化、门店规则合并/展示顺序/热加载、腾讯地图链接、静态资源与安全头、路径穿越、HTTP 方法限制。

## 目录

```text
server.js                 HTTP 服务、API、静态资源、安全头
src/config.js             环境变量与配置
src/normalize.js          上游订单 → 前端订单
src/stores.js             门店增删改规则与热加载
src/upstream.js           上游 POST、故障转移、超时
public/                   页面、样式、前端模块、图片资产
data/default-gift.json    主链接默认礼品（15/30/50/80 年茅台 + 门店兜底）
data/mock-gift.json       演示订单（mock=1 + orderId，4 家门店）
config/stores.json        默认门店配置（replace，4 家设计门店）
config/stores.example.json 门店配置模板
test/                     node:test 测试
deploy/                   Caddy / Nginx 示例
Dockerfile                node:22-alpine，非 root，健康检查
docker-compose.yml        9001 端口、只读根文件系统、配置挂载
```

## 运维注意

- 生产环境设置 `MOCK=0`，并在反向代理层按 IP 做限流，避免订单号被枚举。
- `read_only: true` 已开启；应用不需要写容器文件系统，门店配置以只读方式挂载。
- 容器以 `node` 用户运行，丢弃所有 capabilities，`no-new-privileges`。
- 日志只记录订单号后 4 位；不会打印完整订单号或用户坐标。
- 健康检查：`GET /api/health`，Compose 每 30 秒探测一次。
- 修改 `.env` 后执行 `docker compose up -d` 让容器重建；修改 `config/stores.json` 不需要重启。
