import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  EMPTY_STORE_CONFIG,
  applyStoreConfig,
  createStoreConfigLoader,
  parseStoreConfig,
} from '../src/stores.js';

const baseStores = [
  {
    id: '1001',
    name: '榆林长兴路店',
    phone: '0912-0000000',
    address: '旧地址',
    lat: 38.2,
    lng: 109.7,
  },
  {
    id: '1002',
    name: '神木大柳塔店',
    phone: '19900000000',
    address: '神木地址',
    lat: 38.8,
    lng: 110.5,
  },
];

test('parseStoreConfig 规范化字段并忽略非法条目', () => {
  const config = parseStoreConfig({
    mode: 'replace',
    hide: ['1002', '  ', 1003],
    overrides: [
      { match: '榆林长兴路店', phone: '0912-1111111', lat: '38.4', lng: 200 },
      { match: '  ' },
    ],
    add: [
      { name: '西安提货点', phone: '18500000000', lat: 34.2, lng: 108.9 },
      { name: '' },
      { name: '重复 id', id: 'x' },
      { name: '重复 id 2', id: 'x' },
    ],
  });

  assert.equal(config.mode, 'replace');
  assert.deepEqual(config.hide, ['1002', '1003']);
  assert.equal(config.overrides.length, 1);
  assert.equal(config.overrides[0].phone, '0912-1111111');
  assert.equal(config.overrides[0].lat, 38.4);
  assert.equal(config.overrides[0].lng, undefined);
  assert.equal(config.add.length, 2);
  assert.equal(config.add[0].id, 'custom-1');
  assert.equal(config.add[1].id, 'x');
});

test('merge 模式隐藏、覆盖并追加门店', () => {
  const warnings = [];
  const config = parseStoreConfig({
    hide: ['1002'],
    overrides: [{ match: '1001', phone: '0912-2222222', address: '新地址', lat: 38.3 }],
    add: [{ id: 'xa-1', name: '西安提货点', lat: 34.2, lng: 108.9 }],
  });

  const result = applyStoreConfig(baseStores, config, (message) => warnings.push(message));

  assert.equal(result.length, 2);
  assert.equal(result[0].name, '榆林长兴路店');
  assert.equal(result[0].phone, '0912-2222222');
  assert.equal(result[0].address, '新地址');
  assert.equal(result[0].lat, 38.3);
  assert.equal(result[1].id, 'xa-1');
  assert.equal(warnings.length, 0);
});

test('replace 模式只返回 add 列表', () => {
  const config = parseStoreConfig({
    mode: 'replace',
    add: [{ name: '仅此一家', phone: '1', address: '地址' }],
  });
  const result = applyStoreConfig(baseStores, config);
  assert.deepEqual(result, [
    {
      id: 'custom-1',
      name: '仅此一家',
      phone: '1',
      address: '地址',
    },
  ]);
});

test('追加门店 id 冲突时跳过并告警', () => {
  const warnings = [];
  const config = parseStoreConfig({
    add: [{ id: '1001', name: '冲突门店' }],
  });
  const result = applyStoreConfig(baseStores, config, (message) => warnings.push(message));
  assert.equal(result.length, 2);
  assert.equal(result[1].name, '神木大柳塔店');
  assert.match(warnings[0], /id 冲突/);
});

test('未匹配的覆盖规则告警但不影响结果', () => {
  const warnings = [];
  const result = applyStoreConfig(
    baseStores,
    { ...EMPTY_STORE_CONFIG, overrides: [{ match: '不存在' }] },
    (message) => warnings.push(message),
  );
  assert.equal(result.length, 2);
  assert.match(warnings[0], /未匹配/);
});

test('配置加载器按 mtime/size 热加载、坏配置回退、文件移除清空', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gift-stores-'));
  const file = path.join(dir, 'stores.json');
  const warnings = [];
  const logger = { warn: (message) => warnings.push(message) };

  const config = {
    mode: 'merge',
    hide: [],
    overrides: [],
    add: [{ name: 'A 店', phone: '1' }],
  };
  await fs.writeFile(file, JSON.stringify(config), 'utf8');

  const load = createStoreConfigLoader(file, { logger });
  const first = await load();
  assert.equal(first.add.length, 1);
  assert.equal(first.add[0].name, 'A 店');

  await fs.writeFile(file, '{ invalid json', 'utf8');
  // 确保 mtime/size 变化；体积不同，足以触发重新读取。
  const second = await load();
  assert.equal(second.add.length, 1);
  assert.equal(warnings.length, 1);

  await fs.writeFile(
    file,
    JSON.stringify({ add: [{ name: 'B 店' }, { name: 'C 店' }] }),
    'utf8',
  );
  const third = await load();
  assert.equal(third.add.length, 2);

  await fs.rm(file);
  const fourth = await load();
  assert.deepEqual(fourth, EMPTY_STORE_CONFIG);
});
