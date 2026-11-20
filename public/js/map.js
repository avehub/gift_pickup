/**
 * 生成腾讯地图 URI。有坐标时用 marker（coord_type=2 表示 GCJ-02 腾讯坐标），
 * 无坐标时按「门店名 + 地址」搜索，保证地图默认定位与门店地址一致。
 */
export function buildMapUrl(store, { referer = '188' } = {}) {
  const name = store?.name || '提货门店';
  const encodedReferer = encodeURIComponent(referer);

  if (Number.isFinite(store?.lat) && Number.isFinite(store?.lng)) {
    const marker = `coord:${store.lat},${store.lng};title:${encodeURIComponent(name)};addr:${encodeURIComponent(store.address || '')}`;
    return `https://apis.map.qq.com/uri/v1/marker?marker=${marker}&coord_type=2&referer=${encodedReferer}`;
  }

  const keyword = encodeURIComponent([name, store?.address].filter(Boolean).join(' '));
  return `https://apis.map.qq.com/uri/v1/search?keyword=${keyword}&referer=${encodedReferer}`;
}
