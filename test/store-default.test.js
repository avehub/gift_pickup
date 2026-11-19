import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyStoreConfig, parseStoreConfig } from '../src/stores.js';

const raw = JSON.parse(
  await readFile(new URL('../config/stores.json', import.meta.url), 'utf8'),
);

test('默认门店配置只展示设计稿给定的四家门店', () => {
  const config = parseStoreConfig(raw);
  assert.equal(config.mode, 'replace');
  assert.equal(config.add.length, 4);

  const stores = applyStoreConfig([], config);
  assert.deepEqual(
    stores.map((store) => store.name),
    [
      '榆林长兴路店',
      '西安雁塔区提货点',
      '西安雁塔区提货点',
      '西安雁塔区配送点',
    ],
  );
  for (const store of stores) {
    assert.ok(store.phone);
    assert.ok(store.address);
    assert.ok(Number.isFinite(store.lat));
    assert.ok(Number.isFinite(store.lng));
  }
});
