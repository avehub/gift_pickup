import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeOrder, normalizeStore } from '../src/normalize.js';

test('normalizeOrder 兼容 null 数组与缺省字段', () => {
  const order = normalizeOrder(
    {
      physicalCardOrderDetails: null,
      merchantInfos: null,
      endTime: '2027-08-06 18:20:00',
      sxStationName: '  ',
    },
    '9701090345282028477',
  );

  assert.equal(order.orderId, '9701090345282028477');
  assert.equal(order.expiresAt, '2027-08-06 18:20:00');
  assert.equal(order.sxStationName, null);
  assert.deepEqual(order.items, []);
  assert.deepEqual(order.stores, []);
});

test('normalizeOrder 规范化商品与门店', () => {
  const order = normalizeOrder(
    {
      physicalCardOrderDetails: [
        { itemTitle: '  53度贵州茅台酒15年陈酿500ml ', quantity: 6, unitPrice: '4110' },
        { itemTitle: '', quantity: 1 },
      ],
      merchantInfos: [
        {
          id: 1001,
          shopName: ' 榆林长兴路店 ',
          tel: '0912-3851188',
          address: '榆林市榆阳区长兴路6号',
          latitude: '38.2852',
          longitude: '109.7450',
        },
        {
          id: 1002,
          shopName: '',
          tel: '1',
        },
      ],
    },
    '9701090345282028477',
  );

  assert.deepEqual(order.items, [
    {
      title: '53度贵州茅台酒15年陈酿500ml',
      quantity: '6',
      unitPrice: 4110,
    },
  ]);
  assert.equal(order.stores.length, 1);
  assert.deepEqual(order.stores[0], {
    id: '1001',
    name: '榆林长兴路店',
    phone: '0912-3851188',
    address: '榆林市榆阳区长兴路6号',
    lat: 38.2852,
    lng: 109.745,
  });
});

test('normalizeStore 拒绝非法经纬度', () => {
  const store = normalizeStore(
    {
      id: 1,
      shopName: '测试店',
      latitude: '95',
      longitude: 'abc',
    },
    0,
  );
  assert.equal(store.lat, null);
  assert.equal(store.lng, null);
});

test('normalizeStore 缺少 id 时生成稳定 id', () => {
  const store = normalizeStore({ shopName: '测试店' }, 2);
  assert.equal(store.id, 'store-3');
});
