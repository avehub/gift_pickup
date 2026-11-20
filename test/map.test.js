import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMapUrl } from '../public/js/map.js';

test('buildMapUrl 有坐标时用 marker，坐标与门店地址一起传入', () => {
  const store = {
    name: '西安雁塔区提货点',
    address: '陕西省西安市雁塔区慈恩东路10号（中国茶叶名酒专卖 | 提货点）',
    lat: 34.209481,
    lng: 108.96626,
  };
  const url = buildMapUrl(store, { referer: '188' });

  assert.ok(
    url.startsWith(
      'https://apis.map.qq.com/uri/v1/marker?marker=coord:34.209481,108.96626;title:',
    ),
    url,
  );
  assert.ok(url.includes(encodeURIComponent(store.name)), url);
  assert.ok(url.includes(encodeURIComponent(store.address)), url);
  assert.ok(url.includes('&coord_type=2&referer=188'), url);
});

test('buildMapUrl 无坐标时按门店名与地址搜索', () => {
  const url = buildMapUrl(
    { name: '测试提货点', address: '测试路 1 号' },
    { referer: 'my app' },
  );

  assert.ok(url.startsWith('https://apis.map.qq.com/uri/v1/search?keyword='), url);
  assert.ok(url.includes(encodeURIComponent('测试提货点 测试路 1 号')), url);
  assert.ok(url.endsWith('&referer=my%20app'), url);
});
