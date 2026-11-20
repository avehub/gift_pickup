import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createServer, loadDefaultGift, loadMockData } from '../server.js';
import { loadConfig } from '../src/config.js';
import { EMPTY_STORE_CONFIG, parseStoreConfig } from '../src/stores.js';

const silentLogger = {
  log() {},
  warn() {},
  error() {},
};

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

async function startApp({
  env = {},
  mockData = null,
  defaultGift = null,
  loadStores = async () => EMPTY_STORE_CONFIG,
  fetchImpl,
} = {}) {
  const config = loadConfig({ PORT: '0', ...env });
  const server = createServer({
    config,
    loadStores,
    mockData,
    defaultGift,
    fetchImpl,
    logger: silentLogger,
  });
  const base = await listen(server);
  return { server, base, config };
}

async function startUpstream(handler) {
  const server = http.createServer(handler);
  const base = await listen(server);
  return { server, base };
}

async function request(base, pathname, init) {
  const response = await fetch(`${base}${pathname}`, init);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // 非 JSON 响应保持 null。
  }
  return { response, text, json };
}

test('健康检查与静态首页注入配置', async () => {
  const { server, base } = await startApp({
    env: { MAP_REFERER: 'ref-test', PUBLIC_BASE_URL: 'https://gift.example.com' },
  });

  try {
    const health = await request(base, '/api/health');
    assert.equal(health.response.status, 200);
    assert.equal(health.json.ok, true);
    assert.equal(health.json.mock, false);

    const index = await request(base, '/');
    assert.equal(index.response.status, 200);
    assert.match(index.response.headers.get('content-type'), /text\/html/);
    assert.match(index.text, /name="map-referer" content="ref-test"/);
    assert.match(index.text, /rel="canonical" href="https:\/\/gift\.example\.com\/"/);
    assert.match(index.text, /礼品提货/);

    const csp = index.response.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.equal(index.response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(index.response.headers.get('x-frame-options'), 'DENY');

    const head = await fetch(`${base}/`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal((await head.text()).length, 0);

    const css = await request(base, '/css/styles.css');
    assert.equal(css.response.status, 200);
    assert.match(css.response.headers.get('content-type'), /text\/css/);

    const script = await request(base, '/js/app.js');
    assert.equal(script.response.status, 200);
    assert.match(script.response.headers.get('content-type'), /javascript/);
  } finally {
    await closeServer(server);
  }
});

test('mock 接口返回订单并应用门店配置', async () => {
  const config = loadConfig({});
  const mockData = await loadMockData(config.root);
  const firstId = String(mockData.merchantInfos[0].id);
  const storeConfig = parseStoreConfig({ hide: [firstId] });

  const { server, base } = await startApp({
    env: { MOCK: '1' },
    mockData,
    loadStores: async () => storeConfig,
  });

  try {
    const result = await request(base, '/api/gift?orderId=9701090345282028477&mock=1');
    assert.equal(result.response.status, 200);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.order.items[0].title, '53度贵州茅台酒15年陈酿500ml');
    assert.equal(result.json.order.items[0].quantity, '6');
    assert.equal(result.json.order.stores.length, 3);
    assert.equal(result.json.order.stores[0].id === firstId, false);
  } finally {
    await closeServer(server);
  }
});

test('无订单号主链接返回默认四款茅台礼品', async () => {
  const config = loadConfig({});
  const defaultGift = await loadDefaultGift(config.root);
  const firstId = String(defaultGift.merchantInfos[0].id);
  const storeConfig = parseStoreConfig({ hide: [firstId] });

  const { server, base } = await startApp({
    env: { MOCK: '0' },
    defaultGift,
    loadStores: async () => storeConfig,
  });

  try {
    const result = await request(base, '/api/gift');
    assert.equal(result.response.status, 200);
    assert.equal(result.json.ok, true);
    assert.deepEqual(
      result.json.order.items.map((item) => item.title),
      [
        '53度贵州茅台酒15年陈酿500ml',
        '53度贵州茅台酒30年陈年500ml',
        '53度贵州茅台酒50年陈年500ml',
        '52度贵州茅台酒80年陈年500ml',
      ],
    );
    assert.deepEqual(
      result.json.order.items.map((item) => item.quantity),
      ['6', '', '', ''],
    );
    assert.equal(result.json.order.stores.length, 3);
    assert.equal(result.json.order.stores[0].id === firstId, false);

    const withMockFlag = await request(base, '/api/gift?mock=1');
    assert.equal(withMockFlag.response.status, 200);
    assert.equal(withMockFlag.json.order.items.length, 4);
  } finally {
    await closeServer(server);
  }
});

test('订单号格式错误与 mock 关闭', async () => {
  const { server, base } = await startApp();

  try {
    const invalid = await request(base, '/api/gift?orderId=abc');
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.json.code, 'INVALID_ORDER_ID');

    const mock = await request(base, '/api/gift?orderId=9701090345282028477&mock=1');
    assert.equal(mock.response.status, 400);
    assert.equal(mock.json.code, 'MOCK_DISABLED');
  } finally {
    await closeServer(server);
  }
});

test('上游成功时返回规范化订单', async () => {
  const upstream = await startUpstream((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        code: 200,
        data: {
          physicalCardOrderDetails: [
            { itemTitle: '测试礼品', quantity: 2, unitPrice: 100 },
          ],
          merchantInfos: [
            {
              id: 9001,
              shopName: '测试门店',
              tel: '0912-1234567',
              address: '测试地址',
              latitude: '38.2',
              longitude: '109.7',
            },
          ],
          endTime: '2027-08-06 18:20:00',
          sxStationName: '榆林',
        },
      }),
    );
  });

  const { server, base } = await startApp({
    env: {
      MOCK: '0',
      UPSTREAM_BASES: upstream.base,
      UPSTREAM_TIMEOUT_MS: '2000',
    },
  });

  try {
    const result = await request(base, '/api/gift?orderId=9701090345282028477');
    assert.equal(result.response.status, 200);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.order.sxStationName, '榆林');
    assert.equal(result.json.order.items[0].title, '测试礼品');
    assert.equal(result.json.order.stores[0].name, '测试门店');
    assert.equal(result.json.order.stores[0].lat, 38.2);
  } finally {
    await closeServer(server);
    await closeServer(upstream.server);
  }
});

test('上游卡号不存在映射 404', async () => {
  const upstream = await startUpstream((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 500, msg: '卡号不存在' }));
  });

  const { server, base } = await startApp({
    env: { MOCK: '0', UPSTREAM_BASES: upstream.base },
  });

  try {
    const result = await request(base, '/api/gift?orderId=9701090345282028477');
    assert.equal(result.response.status, 404);
    assert.equal(result.json.code, 'ORDER_NOT_FOUND');
  } finally {
    await closeServer(server);
    await closeServer(upstream.server);
  }
});

test('上游 5xx 映射 502', async () => {
  const upstream = await startUpstream((req, res) => {
    res.writeHead(500);
    res.end('boom');
  });

  const { server, base } = await startApp({
    env: { MOCK: '0', UPSTREAM_BASES: upstream.base },
  });

  try {
    const result = await request(base, '/api/gift?orderId=9701090345282028477');
    assert.equal(result.response.status, 502);
    assert.equal(result.json.code, 'UPSTREAM_ERROR');
  } finally {
    await closeServer(server);
    await closeServer(upstream.server);
  }
});

test('上游超时映射 504', async () => {
  const upstream = await startUpstream((req, res) => {
    setTimeout(() => {
      if (!res.writableEnded) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 200, data: {} }));
      }
    }, 2000);
  });

  const { server, base } = await startApp({
    env: {
      MOCK: '0',
      UPSTREAM_BASES: upstream.base,
      UPSTREAM_TIMEOUT_MS: '1000',
    },
  });

  try {
    const result = await request(base, '/api/gift?orderId=9701090345282028477');
    assert.equal(result.response.status, 504);
    assert.equal(result.json.code, 'UPSTREAM_TIMEOUT');
  } finally {
    await closeServer(server);
    await closeServer(upstream.server);
  }
});

test('方法限制、未知接口与路径穿越', async () => {
  const { server, base } = await startApp();

  try {
    const post = await request(base, '/api/gift', { method: 'POST' });
    assert.equal(post.response.status, 405);
    assert.equal(post.json.code, 'METHOD_NOT_ALLOWED');

    const unknown = await request(base, '/api/nope');
    assert.equal(unknown.response.status, 404);
    assert.equal(unknown.json.code, 'NOT_FOUND');

    const traversal = await request(base, '/%2e%2e/package.json');
    assert.equal(traversal.response.status, 404);

    const missing = await request(base, '/not-found.html');
    assert.equal(missing.response.status, 404);
  } finally {
    await closeServer(server);
  }
});
