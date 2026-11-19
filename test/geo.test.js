import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatDistance,
  haversineKm,
  parseDebugCoordinates,
  sortStoresByDistance,
  toCoordinate,
} from '../public/js/geo.js';

test('haversineKm 计算北京到上海约 1067km', () => {
  const distance = haversineKm(39.9042, 116.4074, 31.2304, 121.4737);
  assert.ok(distance > 1060 && distance < 1075, `distance=${distance}`);
});

test('toCoordinate 严格校验范围与空值', () => {
  assert.equal(toCoordinate('34.2', -90, 90), 34.2);
  assert.equal(toCoordinate(0, -90, 90), 0);
  assert.equal(toCoordinate('', -90, 90), null);
  assert.equal(toCoordinate(null, -90, 90), null);
  assert.equal(toCoordinate('91', -90, 90), null);
  assert.equal(toCoordinate('abc', -90, 90), null);
});

test('parseDebugCoordinates 需要同时提供合法 lat/lng', () => {
  assert.deepEqual(parseDebugCoordinates('?lat=34.2&lng=108.9'), {
    lat: 34.2,
    lng: 108.9,
    source: 'debug',
  });
  assert.equal(parseDebugCoordinates('?lat=34.2'), null);
  assert.equal(parseDebugCoordinates('?lat=95&lng=108.9'), null);
});

test('sortStoresByDistance 升序、无坐标门店置后且稳定', () => {
  const stores = [
    { id: 'far', name: '远', lat: 34.5, lng: 109.0 },
    { id: 'none-1', name: '无坐标 1', lat: null, lng: null },
    { id: 'near', name: '近', lat: 34.201, lng: 108.901 },
    { id: 'none-2', name: '无坐标 2' },
  ];

  const sorted = sortStoresByDistance(stores, { lat: 34.2, lng: 108.9 });
  assert.deepEqual(
    sorted.map((store) => store.id),
    ['near', 'far', 'none-1', 'none-2'],
  );
  assert.ok(sorted[0].distanceKm > 0.1 && sorted[0].distanceKm < 0.2);
  assert.ok(sorted[1].distanceKm > sorted[0].distanceKm);
  assert.equal(sorted[2].distanceKm, null);
  assert.equal(sorted[3].distanceKm, null);
});

test('sortStoresByDistance 无定位时保持上游顺序', () => {
  const stores = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(
    sortStoresByDistance(stores, null).map((store) => store.id),
    ['a', 'b', 'c'],
  );
});

test('formatDistance 按区间格式化', () => {
  assert.equal(formatDistance(0.004), '<10m');
  assert.equal(formatDistance(0.35), '350m');
  assert.equal(formatDistance(0.999), '999m');
  assert.equal(formatDistance(1.24), '1.2km');
  assert.equal(formatDistance(9.96), '10.0km');
  assert.equal(formatDistance(12.4), '12km');
  assert.equal(formatDistance(null), '');
});
