import { buildMapUrl } from './map.js';

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
  requestToken: 0,
};

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

      const figure = createElement('div', 'gift-figure');
      const thumb = createElement('div', 'gift-thumb');
      const image = document.createElement('img');
      image.src = '/assets/gift-thumb.png';
      image.width = 62;
      image.height = 62;
      image.alt = '';
      thumb.append(image);
      figure.append(thumb);

      const year = /(\d{1,3}年)/.exec(item.title || '');
      if (year) {
        figure.append(createElement('span', 'gift-year', year[1]));
      }

      const copy = createElement('div', 'gift-copy');
      copy.append(createElement('div', 'gift-name', item.title || '礼品'));

      // 所有礼品都不展示数量。
      row.append(figure, copy);
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
  // 需求：点击门店后在当前页面直接打开地图，不再新开标签页。
  window.location.href = buildMapUrl(store, { referer: mapReferer });
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

  // 展示顺序由服务端下发（config/stores.json 的 add 顺序）决定，不再按定位距离排序。
  const stores = Array.isArray(state.order.stores) ? state.order.stores : [];

  els.storeList.replaceChildren();
  if (stores.length === 0) {
    els.storeList.append(
      createElement('p', 'empty-stores', '暂无可提货门店，请联系门店客服确认提货方式。'),
    );
  } else {
    for (const store of stores) {
      els.storeList.append(createStoreCard(store));
    }
  }
}

const hasOrderId = /^\d{10,25}$/.test(orderId);

async function loadOrder() {
  if (orderId && !hasOrderId) {
    showApiError('INVALID_ORDER_ID');
    return;
  }

  const token = ++state.requestToken;
  showLoading();

  try {
    const query = new URLSearchParams();
    if (hasOrderId) query.set('orderId', orderId);
    // 无订单号时直接请求默认礼品，主链接即可展示 30/50/80 年陈年茅台。
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
  } catch {
    if (token !== state.requestToken) return;
    showApiError('NETWORK_ERROR');
  }
}

els.retry.addEventListener('click', loadOrder);

loadOrder();
