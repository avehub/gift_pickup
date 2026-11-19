const EARTH_RADIUS_KM = 6371.0088;

/**
 * 将输入解析为指定范围内的经纬度；非法值返回 null。
 */
export function toCoordinate(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
}

/**
 * 两点间大圆距离（Haversine），单位公里。
 */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = Math.PI / 180;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const deltaPhi = (lat2 - lat1) * toRad;
  const deltaLambda = (lng2 - lng1) * toRad;

  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * 读取 ?lat=&lng= 调试坐标；缺一或越界返回 null。
 */
export function parseDebugCoordinates(search) {
  const params = new URLSearchParams(search || '');
  const lat = toCoordinate(params.get('lat'), -90, 90);
  const lng = toCoordinate(params.get('lng'), -180, 180);
  if (lat === null || lng === null) return null;
  return { lat, lng, source: 'debug' };
}

/**
 * 按距离升序返回门店副本；没有坐标的门店排在最后，保持原有相对顺序。
 */
export function sortStoresByDistance(stores, origin) {
  if (!Array.isArray(stores)) return [];

  const enriched = stores.map((store, index) => {
    const lat = toCoordinate(store?.lat, -90, 90);
    const lng = toCoordinate(store?.lng, -180, 180);
    const distanceKm =
      origin && lat !== null && lng !== null
        ? haversineKm(origin.lat, origin.lng, lat, lng)
        : null;
    return { ...store, distanceKm, _index: index };
  });

  enriched.sort((left, right) => {
    if (left.distanceKm === null && right.distanceKm === null) {
      return left._index - right._index;
    }
    if (left.distanceKm === null) return 1;
    if (right.distanceKm === null) return -1;
    return left.distanceKm - right.distanceKm || left._index - right._index;
  });

  return enriched.map(({ _index, ...store }) => store);
}

export function formatDistance(distanceKm) {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return '';
  if (distanceKm < 0.01) return '<10m';
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)}m`;
  if (distanceKm < 10) return `${distanceKm.toFixed(1)}km`;
  return `${Math.round(distanceKm)}km`;
}

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

/**
 * 浏览器定位；失败时抛出 GeolocationPositionError（code 1/2/3）。
 */
export function requestBrowserPosition({ timeout = 12000, maximumAge = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      const error = new Error('当前浏览器不支持定位');
      error.code = 0;
      reject(error);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          source: 'browser',
        });
      },
      (error) => reject(error),
      {
        enableHighAccuracy: false,
        timeout,
        maximumAge,
      },
    );
  });
}
