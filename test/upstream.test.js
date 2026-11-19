import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  UpstreamError,
  UpstreamNotFoundError,
  UpstreamTimeoutError,
  fetchUsableStation,
} from '../src/upstream.js';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

async function startUpstream(handler) {
  const server = http.createServer(handler);
  const base = await listen(server);
  return { server, base };
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

async function unusedBase() {
  const server = http.createServer();
  const base = await listen(server);
  await closeServer(server);
  return base;
}

test('POST 上游并返回 data', async () => {
  let received = null;
  const { server, base } = await startUpstream((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      received = { method: req.method, url: req.url, body: JSON.parse(body) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 200, data: { merchantInfos: [] } }));
    });
  });

  try {
    const data = await fetchUsableStation({
      orderId: '9701090345282028477',
      bases: [base],
      timeoutMs: 2000,
    });
    assert.deepEqual(data, { merchantInfos: [] });
    assert.equal(received.method, 'POST');
    assert.equal(received.url, '/gateway/mall/physicalCardOrder/getUsableStation');
    assert.deepEqual(received.body, {
      orderId: '9701090345282028477',
      latitude: '',
      longitude: '',
    });
  } finally {
    await closeServer(server);
  }
});

test('第一个域名 5xx 时故障转移到第二个域名', async () => {
  let secondCalls = 0;
  const first = await startUpstream((req, res) => {
    res.writeHead(500);
    res.end('boom');
  });
  const second = await startUpstream((req, res) => {
    secondCalls += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 200, data: { merchantInfos: [{ shopName: 'B 店' }] } }));
  });

  try {
    const data = await fetchUsableStation({
      orderId: '9701090345282028477',
      bases: [first.base, second.base],
      timeoutMs: 3000,
    });
    assert.equal(data.merchantInfos[0].shopName, 'B 店');
    assert.equal(secondCalls, 1);
  } finally {
    await closeServer(first.server);
    await closeServer(second.server);
  }
});

test('卡号不存在返回 NotFound 且不再尝试其他域名', async () => {
  let secondCalls = 0;
  const first = await startUpstream((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 500, msg: '卡号不存在' }));
  });
  const second = await startUpstream((req, res) => {
    secondCalls += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 200, data: {} }));
  });

  try {
    await assert.rejects(
      fetchUsableStation({
        orderId: '9701090345282028477',
        bases: [first.base, second.base],
        timeoutMs: 3000,
      }),
      (error) => error instanceof UpstreamNotFoundError,
    );
    assert.equal(secondCalls, 0);
  } finally {
    await closeServer(first.server);
    await closeServer(second.server);
  }
});

test('总预算耗尽返回 TimeoutError', async () => {
  const { server, base } = await startUpstream((req, res) => {
    setTimeout(() => {
      if (!res.writableEnded) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 200, data: {} }));
      }
    }, 1000);
  });

  try {
    await assert.rejects(
      fetchUsableStation({
        orderId: '9701090345282028477',
        bases: [base],
        timeoutMs: 150,
      }),
      (error) => error instanceof UpstreamTimeoutError,
    );
  } finally {
    await closeServer(server);
  }
});

test('连接失败且没有备用域名时返回 UpstreamError', async () => {
  const base = await unusedBase();
  await assert.rejects(
    fetchUsableStation({
      orderId: '9701090345282028477',
      bases: [base],
      timeoutMs: 800,
    }),
    (error) => error instanceof UpstreamError && !(error instanceof UpstreamTimeoutError),
  );
});

test('非法 JSON 返回 UpstreamError', async () => {
  const { server, base } = await startUpstream((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('not json');
  });

  try {
    await assert.rejects(
      fetchUsableStation({
        orderId: '9701090345282028477',
        bases: [base],
        timeoutMs: 1000,
      }),
      (error) => error instanceof UpstreamError,
    );
  } finally {
    await closeServer(server);
  }
});
