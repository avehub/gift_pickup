import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig, parseUpstreamBases } from '../src/config.js';

test('parseUpstreamBases 去重、去尾斜杠并跳过非法项', () => {
  const bases = parseUpstreamBases(
    ' https://a.example.com/ , https://b.example.com/path/ ,not-a-url, https://a.example.com ',
    'https://fallback.example.com',
  );
  assert.deepEqual(bases, ['https://a.example.com', 'https://b.example.com/path']);
});

test('parseUpstreamBases 全部非法时回退默认域名', () => {
  assert.deepEqual(parseUpstreamBases('not-a-url, ftp://x'), [
    'https://mm.qfmjh.cn',
  ]);
});

test('loadConfig 使用默认值', () => {
  const config = loadConfig({});
  assert.equal(config.port, 3000);
  assert.equal(config.upstreamTimeoutMs, 10000);
  assert.equal(config.mapReferer, '188');
  assert.equal(config.mockEnabled, false);
  assert.deepEqual(config.upstreamBases, ['https://mm.qfmjh.cn']);
  assert.equal(config.publicBaseUrl, '');
});

test('loadConfig 解析环境变量并校验范围', () => {
  const config = loadConfig({
    PORT: '9001',
    UPSTREAM_BASES: 'https://one.example.com,https://two.example.com/',
    UPSTREAM_TIMEOUT_MS: '2500',
    PUBLIC_BASE_URL: 'https://gift.example.com/',
    MAP_REFERER: 'test-ref',
    MOCK: '1',
    STORE_CONFIG_FILE: 'config/custom.json',
  });

  assert.equal(config.port, 9001);
  assert.equal(config.upstreamTimeoutMs, 2500);
  assert.equal(config.publicBaseUrl, 'https://gift.example.com');
  assert.equal(config.mapReferer, 'test-ref');
  assert.equal(config.mockEnabled, true);
  assert.match(config.storeConfigFile, /config[\\/]custom\.json$/);
  assert.deepEqual(config.upstreamBases, [
    'https://one.example.com',
    'https://two.example.com',
  ]);
});

test('loadConfig 非法端口与超时回退默认值', () => {
  const config = loadConfig({ PORT: '0', UPSTREAM_TIMEOUT_MS: '999999' });
  assert.equal(config.port, 3000);
  assert.equal(config.upstreamTimeoutMs, 10000);
});
