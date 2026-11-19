import fs from 'node:fs/promises';

export const EMPTY_STORE_CONFIG = Object.freeze({
  mode: 'merge',
  hide: [],
  overrides: [],
  add: [],
});

function text(value) {
  return value == null ? '' : String(value).trim();
}

function coordinates(entry) {
  const result = {};
  for (const [key, min, max] of [
    ['lat', -90, 90],
    ['lng', -180, 180],
  ]) {
    if (!(key in entry)) continue;
    const value = entry[key];
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed >= min && parsed <= max) result[key] = parsed;
  }
  return result;
}

function normalizeOverride(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const match = text(entry.match ?? entry.id ?? entry.name);
  if (!match) return null;

  const override = { match };
  for (const field of ['phone', 'address']) {
    if (field in entry) override[field] = text(entry[field]);
  }
  if (text(entry.name)) override.name = text(entry.name);
  Object.assign(override, coordinates(entry));
  return override;
}

function normalizeAdd(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const name = text(entry.name);
  if (!name) return null;

  return {
    id: text(entry.id) || `custom-${index + 1}`,
    name,
    phone: text(entry.phone),
    address: text(entry.address),
    ...coordinates(entry),
  };
}

export function parseStoreConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('门店配置必须是 JSON 对象');
  }

  const hideSource = Array.isArray(raw.hide)
    ? raw.hide
    : typeof raw.hide === 'string'
      ? [raw.hide]
      : [];
  const hide = [
    ...new Set(hideSource.map((item) => text(item)).filter(Boolean)),
  ];

  const overrides = (Array.isArray(raw.overrides) ? raw.overrides : [])
    .map(normalizeOverride)
    .filter(Boolean);

  const seenIds = new Set();
  const add = [];
  const addSource = Array.isArray(raw.add) ? raw.add : [];
  addSource.forEach((entry, index) => {
    const normalized = normalizeAdd(entry, index);
    if (!normalized) return;
    if (seenIds.has(normalized.id)) return;
    seenIds.add(normalized.id);
    add.push(normalized);
  });

  return {
    mode: raw.mode === 'replace' ? 'replace' : 'merge',
    hide,
    overrides,
    add,
  };
}

export function applyStoreConfig(stores, config = EMPTY_STORE_CONFIG, warn = () => {}) {
  const list = Array.isArray(stores) ? stores.map((store) => ({ ...store })) : [];
  const base = config.mode === 'replace' ? [] : list;

  const hidden = new Set(config.hide ?? []);
  const visible = base.filter(
    (store) => !hidden.has(String(store.id)) && !hidden.has(store.name),
  );

  const findByMatch = (match) =>
    visible.find((store) => String(store.id) === match || store.name === match);

  for (const override of config.overrides ?? []) {
    const target = findByMatch(override.match);
    if (!target) {
      warn(`[stores] 覆盖规则未匹配到门店：${override.match}`);
      continue;
    }
    if (override.name) target.name = override.name;
    if (override.phone !== undefined) target.phone = override.phone;
    if (override.address !== undefined) target.address = override.address;
    if (override.lat !== undefined) target.lat = override.lat;
    if (override.lng !== undefined) target.lng = override.lng;
  }

  const ids = new Set(visible.map((store) => String(store.id)));
  for (const entry of config.add ?? []) {
    if (ids.has(String(entry.id))) {
      warn(`[stores] 追加门店 id 冲突，已跳过：${entry.id}`);
      continue;
    }
    visible.push({ ...entry });
    ids.add(String(entry.id));
  }

  return visible;
}

export function createStoreConfigLoader(filePath, { logger = console } = {}) {
  let cache = { mtimeMs: -1, size: -1, config: EMPTY_STORE_CONFIG };
  let lastError = '';

  return async function loadStoreConfig() {
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        if (cache.mtimeMs !== -1) {
          logger.warn?.(`[stores] 配置文件已移除，停止应用门店规则：${filePath}`);
        }
        cache = { mtimeMs: -1, size: -1, config: EMPTY_STORE_CONFIG };
        return EMPTY_STORE_CONFIG;
      }
      logger.warn?.(`[stores] 读取配置失败：${error.message}`);
      return cache.config;
    }

    if (!stat.isFile()) {
      logger.warn?.(`[stores] 配置路径不是文件：${filePath}`);
      return cache.config;
    }

    if (stat.mtimeMs === cache.mtimeMs && stat.size === cache.size) {
      return cache.config;
    }

    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const config = parseStoreConfig(JSON.parse(raw));
      cache = { mtimeMs: stat.mtimeMs, size: stat.size, config };
      lastError = '';
      return config;
    } catch (error) {
      cache = { ...cache, mtimeMs: stat.mtimeMs, size: stat.size };
      if (error.message !== lastError) {
        logger.warn?.(`[stores] 配置无效，保留上一份有效配置：${error.message}`);
        lastError = error.message;
      }
      return cache.config;
    }
  };
}
