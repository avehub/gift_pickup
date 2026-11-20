import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const defaultUrl = new URL('../data/default-gift.json', import.meta.url);
const defaultGift = JSON.parse(await readFile(defaultUrl, 'utf8'));

test('默认礼品保留 15 年，并包含 30 年、50 年、52 度 80 年陈年贵州茅台酒', () => {
  assert.deepEqual(
    defaultGift.physicalCardOrderDetails.map((item) => item.itemTitle),
    [
      '53度贵州茅台酒15年陈酿500ml',
      '53度贵州茅台酒30年陈年500ml',
      '53度贵州茅台酒50年陈年500ml',
      '52度贵州茅台酒80年陈年500ml',
    ],
  );
  assert.equal(String(defaultGift.physicalCardOrderDetails[0].quantity), '6');
});

test('默认礼品自带四家门店兜底，可被 config/stores.json 覆盖', () => {
  const names = defaultGift.merchantInfos.map((store) => store.shopName);
  assert.deepEqual(names, [
    '榆林长兴路店',
    '西安雁塔区提货点',
    '西安雁塔区提货点',
    '西安雁塔区配送点',
  ]);
});
