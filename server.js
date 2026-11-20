import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadConfig } from './src/config.js';
import { normalizeOrder } from './src/normalize.js';
import { applyStoreConfig, createStoreConfigLoader } from './src/stores.js';
import {
  UpstreamError,
  UpstreamNotFoundError,
  UpstreamTimeoutError,
  fetchUsableStation,
} from './src/upstream.js';

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(self)',
});

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setSecurityHeaders(res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendApiError(res, status, code, message) {
  sendJson(res, status, { ok: false, code, message });
}

function renderIndex(template, config) {
  const canonical = config.publicBaseUrl
    ? `<link rel="canonical" href="${escapeHtml(config.publicBaseUrl)}/">`
    : '';
  return template
    .replaceAll('__MAP_REFERER__', escapeHtml(config.mapReferer))
    .replace('__CANONICAL_TAG__', canonical);
}

export async function loadMockData(root) {
  const file = path.join(root, 'data', 'mock-gift.json');
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

export async function loadDefaultGift(root) {
  const file = path.join(root, 'data', 'default-gift.json');
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function serveStatic(req, res, { config, logger }) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }

  if (pathname.includes('\0') || pathname.includes('\\')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }

  if (pathname.endsWith('/')) pathname += 'index.html';
  const relative = pathname.replace(/^\/+/, '');
  const publicDir = path.join(config.root, 'public');
  const filePath = path.resolve(publicDir, relative);

  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  let content;
  try {
    content = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    logger.error?.(`[static] 读取失败：${error.message}`);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const isHtml = extension === '.html';
  let body = content;
  if (isHtml) {
    body = Buffer.from(renderIndex(content.toString('utf8'), config), 'utf8');
  }

  const headers = {
    'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=300',
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
  } else {
    res.end(body);
  }
}

async function handleGift(
  req,
  res,
  { config, loadStores, mockData, defaultGift, fetchImpl, logger },
) {
  const url = new URL(req.url || '/', 'http://localhost');
  const orderId = String(url.searchParams.get('orderId') ?? '').trim();
  const wantsMock = url.searchParams.get('mock') === '1';

  let data;
  let responseOrderId = orderId;

  if (!orderId) {
    // 主链接不需要订单号，直接展示默认礼品（30/50/80 年陈年茅台）。
    data = defaultGift || mockData;
    if (!data) {
      sendApiError(res, 500, 'DEFAULT_GIFT_UNAVAILABLE', '默认礼品数据不可用');
      return;
    }
  } else if (wantsMock) {
    if (!config.mockEnabled) {
      sendApiError(res, 400, 'MOCK_DISABLED', '演示数据未开启');
      return;
    }
    if (!mockData) {
      sendApiError(res, 500, 'MOCK_UNAVAILABLE', '演示数据不可用');
      return;
    }
    data = mockData;
    responseOrderId = orderId || String(mockData.orderId ?? '');
  } else {
    if (!/^\d{10,25}$/.test(orderId)) {
      sendApiError(res, 400, 'INVALID_ORDER_ID', '订单号格式不正确');
      return;
    }
    try {
      data = await fetchUsableStation({
        orderId,
        bases: config.upstreamBases,
        timeoutMs: config.upstreamTimeoutMs,
        fetchImpl,
      });
    } catch (error) {
      if (error instanceof UpstreamNotFoundError) {
        sendApiError(res, 404, 'ORDER_NOT_FOUND', '未找到该订单，请确认礼品卡链接是否有效');
        return;
      }
      if (error instanceof UpstreamTimeoutError) {
        logger.warn?.(`[upstream] 查询超时 orderId=****${orderId.slice(-4)}`);
        sendApiError(res, 504, 'UPSTREAM_TIMEOUT', '订单服务响应超时，请稍后重试');
        return;
      }
      if (error instanceof UpstreamError) {
        logger.warn?.(`[upstream] 查询失败 orderId=****${orderId.slice(-4)}：${error.message}`);
        sendApiError(res, 502, 'UPSTREAM_ERROR', '订单服务暂时不可用，请稍后重试');
        return;
      }
      throw error;
    }
  }

  const order = normalizeOrder(data, responseOrderId);
  const storeConfig = await loadStores();
  order.stores = applyStoreConfig(order.stores, storeConfig, (message) => logger.warn?.(message));

  sendJson(res, 200, { ok: true, order });
}

export function createRequestHandler({
  config,
  loadStores,
  mockData = null,
  defaultGift = null,
  fetchImpl = globalThis.fetch,
  logger = console,
}) {
  return async function requestHandler(req, res) {
    setSecurityHeaders(res);

    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        sendApiError(res, 405, 'METHOD_NOT_ALLOWED', '仅支持 GET 请求');
        return;
      }

      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname === '/api/health') {
        if (req.method !== 'GET') {
          sendApiError(res, 405, 'METHOD_NOT_ALLOWED', '仅支持 GET 请求');
          return;
        }
        sendJson(res, 200, {
          ok: true,
          mock: Boolean(config.mockEnabled),
          upstreams: config.upstreamBases.length,
        });
        return;
      }

      if (url.pathname === '/api/gift') {
        if (req.method !== 'GET') {
          sendApiError(res, 405, 'METHOD_NOT_ALLOWED', '仅支持 GET 请求');
          return;
        }
        await handleGift(req, res, {
          config,
          loadStores,
          mockData,
          defaultGift,
          fetchImpl,
          logger,
        });
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        sendApiError(res, 404, 'NOT_FOUND', '接口不存在');
        return;
      }

      await serveStatic(req, res, { config, logger });
    } catch (error) {
      logger.error?.('[server] 未处理异常', error);
      if (!res.headersSent) {
        sendApiError(res, 500, 'INTERNAL_ERROR', '服务器内部错误');
      } else {
        res.destroy();
      }
    }
  };
}

export function createServer(options) {
  const handler = createRequestHandler(options);
  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      options.logger?.error?.('[server] 请求处理失败', error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  return server;
}

async function start() {
  const config = loadConfig();
  const logger = console;

  let mockData = null;
  try {
    mockData = await loadMockData(config.root);
  } catch (error) {
    logger.warn?.(`[mock] 未能加载演示数据：${error.message}`);
  }

  let defaultGift = null;
  try {
    defaultGift = await loadDefaultGift(config.root);
  } catch (error) {
    logger.warn?.(`[default-gift] 未能加载默认礼品：${error.message}`);
  }

  const loadStores = createStoreConfigLoader(config.storeConfigFile, { logger });
  const server = createServer({ config, loadStores, mockData, defaultGift, logger });

  server.on('error', (error) => {
    logger.error?.(`[server] 启动失败：${error.message}`);
    process.exitCode = 1;
  });

  server.listen(config.port, () => {
    logger.log?.(`[server] listening on :${config.port}`);
    logger.log?.(
      `[server] upstreams=${config.upstreamBases.join(',')} timeout=${config.upstreamTimeoutMs}ms mock=${config.mockEnabled ? 'on' : 'off'}`,
    );
    logger.log?.(`[server] store config=${config.storeConfigFile}`);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log?.(`[server] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    const timer = setTimeout(() => process.exit(1), 10000);
    timer.unref?.();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (entryPath === import.meta.url) {
  start().catch((error) => {
    console.error('[server] 启动异常', error);
    process.exitCode = 1;
  });
}
