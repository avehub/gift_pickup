import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mockUrl = new URL('../data/mock-gift.json', import.meta.url);
const mock = JSON.parse(await readFile(mockUrl, 'utf8'));

test('mock 默认礼品为 53 度贵州茅台酒 15 年陈酿 500ml，数量 6', () => {
  assert.equal(mock.physicalCardOrderDetails.length, 1);
  const [item] = mock.physicalCardOrderDetails;
  assert.equal(item.itemTitle, '53度贵州茅台酒15年陈酿500ml');
  assert.equal(String(item.quantity), '6');
});

test('mock 门店包含设计稿四家门店，并保持页面展示顺序', () => {
  assert.deepEqual(
    mock.merchantInfos.map((store) => store.id),
    [
      'mock-yulin-changxing',
      'mock-xa-hanguang',
      'mock-xa-cien',
      'mock-xa-jinshuiwan',
    ],
  );
  assert.deepEqual(
    mock.merchantInfos.map((store) => store.shopName),
    [
      '榆林长兴路店',
      '西安雁塔区配送点',
      '西安雁塔区提货点',
      '西安雁塔区提货点',
    ],
  );
});
