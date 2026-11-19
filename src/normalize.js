function text(value) {
  return value == null ? '' : String(value).trim();
}

function coordinate(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function toPrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeStore(raw, index = 0) {
  const id = text(raw?.id ?? raw?.shopId ?? raw?.storeId) || `store-${index + 1}`;
  return {
    id,
    name: text(raw?.shopName ?? raw?.name),
    phone: text(raw?.tel ?? raw?.phone),
    address: text(raw?.address),
    lat: coordinate(raw?.latitude ?? raw?.lat, -90, 90),
    lng: coordinate(raw?.longitude ?? raw?.lng, -180, 180),
  };
}

export function normalizeOrder(data, orderId) {
  const rawItems = Array.isArray(data?.physicalCardOrderDetails)
    ? data.physicalCardOrderDetails
    : [];
  const rawStores = Array.isArray(data?.merchantInfos) ? data.merchantInfos : [];

  return {
    orderId: text(data?.orderId) || text(orderId),
    expiresAt: text(data?.endTime ?? data?.expiresAt),
    sxStationName: text(data?.sxStationName) || null,
    items: rawItems
      .map((item) => ({
        title: text(item?.itemTitle ?? item?.title),
        quantity: text(item?.quantity ?? item?.qty),
        unitPrice: toPrice(item?.unitPrice),
      }))
      .filter((item) => item.title),
    stores: rawStores
      .map((store, index) => normalizeStore(store, index))
      .filter((store) => store.name),
  };
}
