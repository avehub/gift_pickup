import {
  formatDistance,
  parseDebugCoordinates,
  requestBrowserPosition,
  sortStoresByDistance,
} from './geo.js';

const $ = (id) => document.getElementById(id);

const els = {
  main: $('main'),
  giftSection: $('gift-section'),
  giftItems: $('gift-items'),
  giftTag: $('gift-tag'),
  giftSkeleton: $('gift-skeleton'),
  storesSection: $('stores-section'),
  storeList: $('store-list'),
  storeSkeleton: $('store-skeleton'),
  locationStatus: $('location-status'),
  locationText: $('location-text'),
  relocate: $('relocate'),
  errorState: $('error-state'),
  errorTitle: $('error-title'),
  errorDetail: $('error-detail'),
  retry: $('retry'),
};

const params = new URLSearchParams(window.location.search);
const orderId = (params.get('orderId') ?? '').trim();
const wantsMock = params.get('mock') === '1';
const mapReferer =
  document.querySelector('meta[name="map-referer"]')?.content?.trim() || '188';

const ERROR_COPY = {
  INVALID_ORDER_ID: [
    '提货链接无效',
    '请核对链接中的订单号，或联系门店客服重新获取提货链接。',
    false,
  ],
  ORDER_NOT_FOUND: [
    '未找到提货订单',
    '该订单不存在或已失效，请核对链接，或联系门店客服。',
    true,
  ],
  MOCK_DISABLED: [
    '演示模式未开启',
    '当前服务未启用演示数据，请使用真实的礼品提货链接。',
    false,
  ],
  MOCK_UNAVAILABLE: [
    '演示数据不可用',
    '演示数据暂时不可用，请稍后重新加载。',
    true,
  ],
  UPSTREAM_TIMEOUT: [
    '门店信息加载超时',
    '订单服务响应较慢，请稍后重新加载。',
    true,
  ],
  UPSTREAM_ERROR: [
    '门店信息加载失败',
    '订单服务暂时不可用，请稍后重新加载。',
    true,
  ],
  NETWORK_ERROR: [
    '网络连接失败',
    '请检查网络连接后重新加载。',
    true,
  ],
  DEFAULT: [
    '页面加载失败',
    '请稍后重新加载；如仍无法打开，请联系门店客服。',
    true,
  ],
};

const state = {
  order: null,
  origin: null,
  locationState: 'idle',
  requestToken: 0,
};

const ERROR_STATES = new Set(['denied', 'timeout', 'unsupported', 'insecure', 'off', 'granted', 'debug']);

function setBusy(busy) {
  els.main.setAttribute('aria-busy', String(busy));
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function showLoading() {
  setBusy(true);
  els.errorState.hidden = true;
  els.giftSection.hidden = true;
  els.giftSkeleton.hidden = false;
  els.storesSection.hidden = false;
  els.storeSkeleton.hidden = false;
  els.storeList.replaceChildren();
  els.locationStatus.hidden = true;
  els.locationStatus.className = 'location-status';
}

function showError(title, detail, { retry = true } = {}) {
  setBusy(false);
  els.giftSkeleton.hidden = true;
  els.giftSection.hidden = true;
  els.storesSection.hidden = true;
  els.errorState.hidden = false;
  els.errorTitle.textContent = title;
  els.errorDetail.textContent = detail;
  els.retry.hidden = !retry;
}

function showApiError(code) {
  const [title, detail, retry] = ERROR_COPY[code] || ERROR_COPY.DEFAULT;
  showError(title, detail, { retry });
}

function isSecureLocationContext() {
  if (window.isSecureContext) return true;
  if (window.location.protocol === 'https:') return true;
  return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
}

function renderOrder() {
  const order = state.order;
  if (!order) return;

  els.giftSkeleton.hidden = true;
  els.giftSection.hidden = false;
  els.storeSkeleton.hidden = true;
  els.storesSection.hidden = false;
  setBusy(false);

  els.giftItems.replaceChildren();
  const items = Array.isArray(order.items) ? order.items : [];

  if (items.length === 0) {
    els.giftItems.append(createElement('p', 'gift-empty', '礼品信息暂缺，请联系门店确认。'));
  } else {
    for (const item of items) {
      const row = createElement('div', 'gift-item');

      const thumb = createElement('div', 'gift-thumb');
      const image = document.createElement('img');
      image.src = '/assets/gift-thumb.png';
      image.width = 62;
      image.height = 62;
      image.alt = '';
      thumb.append(image);

      const copy = createElement('div', 'gift-copy');
      copy.append(createElement('div', 'gift-name', item.title || '礼品'));

      const quantity = String(item.quantity ?? '').trim();
      if (quantity) {
        copy.append(createElement('div', 'gift-qty', `x${quantity}`));
      }

      row.append(thumb, copy);
      els.giftItems.append(row);
    }
  }

  const sxStationName = String(order.sxStationName ?? '').trim();
  els.giftTag.textContent = sxStationName;
  els.giftTag.hidden = !sxStationName;

  renderStores();
}

function createAddressText(address) {
  // WORD JOINER 让“5号”“10幢”这类门牌不被拆行，同时保留中文自然换行。
  const text = String(address).replace(/(\d)(?=(?:号|幢|层|楼|室|单元|栋|座|弄|巷))/g, '$1\u2060');
  return document.createTextNode(text);
}

function createStoreRow(labelText, value) {
  const row = createElement('div', 'store-row');
  row.append(createElement('span', 'store-label', labelText));
  const valueNode = createElement('span', 'store-value');
  valueNode.append(value);
  row.append(valueNode);
  return row;
}

function createPhoneLink(phone) {
  const link = document.createElement('a');
  link.href = `tel:${phone.replace(/[^\d+]/g, '')}`;
  link.textContent = phone;
  link.addEventListener('click', (event) => event.stopPropagation());
  return link;
}

function openMap(store) {
  const referer = encodeURIComponent(mapReferer);
  const name = store.name || '提货门店';

  let url;
  if (Number.isFinite(store.lat) && Number.isFinite(store.lng)) {
    const marker = `coord:${store.lat},${store.lng};title:${encodeURIComponent(name)};addr:${encodeURIComponent(store.address || '')}`;
    url = `https://apis.map.qq.com/uri/v1/marker?marker=${marker}&referer=${referer}`;
  } else {
    const keyword = encodeURIComponent([name, store.address].filter(Boolean).join(' '));
    url = `https://apis.map.qq.com/uri/v1/search?keyword=${keyword}&referer=${referer}`;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

function createStoreCard(store) {
  const card = createElement('article', 'store-card');
  card.tabIndex = 0;
  card.setAttribute('role', 'link');
  card.setAttribute('aria-label', `查看${store.name || '提货门店'}的地图位置`);

  card.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a')) return;
    openMap(store);
  });

  card.addEventListener('keydown', (event) => {
    if (event.target !== card) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMap(store);
    }
  });

  const inner = createElement('div', 'store-inner');

  const icon = createElement('div', 'store-icon');
  const iconImage = document.createElement('img');
  iconImage.src = '/assets/store-glyph.png';
  iconImage.width = 37;
  iconImage.height = 37;
  iconImage.alt = '';
  icon.append(iconImage);

  const main = createElement('div', 'store-main');
  const head = createElement('div', 'store-head');
  head.append(createElement('h3', 'store-name', store.name || '提货门店'));

  if (Number.isFinite(store.distanceKm)) {
    const distance = createElement(
      'span',
      'store-distance',
      formatDistance(store.distanceKm),
    );
    head.append(distance);
  }

  main.append(head);

  if (store.phone) {
    main.append(createStoreRow('电话：', createPhoneLink(String(store.phone))));
  }
  if (store.address) {
    main.append(createStoreRow('地址：', createAddressText(store.address)));
  }

  inner.append(icon, main);
  card.append(inner);
  return card;
}

function renderStores() {
  if (!state.order) return;

  const stores = Array.isArray(state.order.stores) ? state.order.stores : [];
  const sorted = sortStoresByDistance(stores, state.origin);

  els.storeList.replaceChildren();
  if (sorted.length === 0) {
    els.storeList.append(
      createElement('p', 'empty-stores', '暂无可提货门店，请联系门店客服确认提货方式。'),
    );
  } else {
    for (const store of sorted) {
      els.storeList.append(createStoreCard(store));
    }
  }

  updateLocationStatus();
}

function updateLocationStatus() {
  const hasStores = Boolean(state.order && state.order.stores && state.order.stores.length);
  if (!hasStores) {
    els.locationStatus.hidden = true;
    return;
  }

  // 成功或用户主动关闭定位时不额外占一行；距离徽标和警告已足够表达状态。
  if (['granted', 'debug', 'off'].includes(state.locationState)) {
    els.locationStatus.hidden = true;
    els.relocate.hidden = true;
    return;
  }

  let text = '门店按默认顺序展示';
  let className = '';
  let retry = false;

  switch (state.locationState) {
    case 'locating':
      text = '正在获取位置，按距离排序…';
      className = 'is-locating';
      break;
    case 'granted':
      text = '已按距离由近到远排序';
      className = 'is-done';
      break;
    case 'debug':
      text = '已按调试坐标由近到远排序';
      className = 'is-done';
      break;
    case 'off':
      text = '已关闭定位，门店按默认顺序展示';
      break;
    case 'denied':
      text = '未开启定位，门店按默认顺序展示';
      className = 'is-warn';
      retry = true;
      break;
    case 'timeout':
      text = '定位超时，门店按默认顺序展示';
      className = 'is-warn';
      retry = true;
      break;
    case 'unsupported':
      text = '当前浏览器不支持定位，门店按默认顺序展示';
      className = 'is-warn';
      break;
    case 'insecure':
      text = '当前页面未启用 HTTPS，无法定位，门店按默认顺序展示';
      className = 'is-warn';
      break;
    default:
      break;
  }

  els.locationText.textContent = text;
  els.locationStatus.className = `location-status${className ? ` ${className}` : ''}`;
  els.relocate.hidden = !retry;
  els.locationStatus.hidden = false;
}

async function locate() {
  state.locationState = 'locating';
  updateLocationStatus();

  try {
    const position = await requestBrowserPosition({ timeout: 8000 });
    if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
      throw new Error('invalid position');
    }
    state.origin = { lat: position.lat, lng: position.lng, source: 'browser' };
    state.locationState = 'granted';
  } catch (error) {
    state.origin = null;
    state.locationState = error?.code === 3 ? 'timeout' : 'denied';
  }

  renderStores();
}

function startLocation() {
  if (!state.order) return;

  const debug = parseDebugCoordinates(window.location.search);
  if (debug) {
    state.origin = debug;
    state.locationState = 'debug';
    renderStores();
    return;
  }

  if (params.get('geo') === 'off') {
    state.origin = null;
    state.locationState = 'off';
    renderStores();
    return;
  }

  if (state.origin) {
    renderStores();
    return;
  }

  if (ERROR_STATES.has(state.locationState) && state.locationState !== 'granted') {
    renderStores();
    return;
  }

  if (!navigator.geolocation) {
    state.locationState = 'unsupported';
    renderStores();
    return;
  }

  if (!isSecureLocationContext()) {
    state.locationState = 'insecure';
    renderStores();
    return;
  }

  locate();
}

async function loadOrder() {
  if (!/^\d{10,25}$/.test(orderId)) {
    showApiError('INVALID_ORDER_ID');
    return;
  }

  const token = ++state.requestToken;
  showLoading();

  try {
    const query = new URLSearchParams({ orderId });
    if (wantsMock) query.set('mock', '1');

    const response = await fetch(`/api/gift?${query.toString()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);

    if (token !== state.requestToken) return;

    if (!response.ok || !payload || payload.ok !== true || !payload.order) {
      showApiError(payload?.code || 'DEFAULT');
      return;
    }

    state.order = payload.order;
    renderOrder();
    startLocation();
  } catch {
    if (token !== state.requestToken) return;
    showApiError('NETWORK_ERROR');
  }
}

els.retry.addEventListener('click', loadOrder);
els.relocate.addEventListener('click', locate);

if (!orderId) {
  showError(
    '缺少提货订单号',
    '请通过完整的礼品提货链接进入，或联系门店客服获取正确链接。',
    { retry: false },
  );
} else {
  loadOrder();
}
