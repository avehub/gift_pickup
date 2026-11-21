import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const defaultUrl = new URL('../data/default-gift.json', import.meta.url);
const defaultGift = JSON.parse(await readFile(defaultUrl, 'utf8'));

test('默认礼品为飞天茅台及 15 年、30 年、50 年贵州茅台酒', () => {
  assert.deepEqual(
    defaultGift.physicalCardOrderDetails.map((item) => item.itemTitle),
    [
      '53度飞天茅台500ml',
      '53度贵州茅台酒15年陈酿500ml',
      '53度贵州茅台酒30年陈年500ml',
      '53度贵州茅台酒50年陈年500ml',
    ],
  );
  assert.equal(
    defaultGift.physicalCardOrderDetails.some((item) => 'quantity' in item),
    false,
  );
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
