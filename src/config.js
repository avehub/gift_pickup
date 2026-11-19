import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_UPSTREAM = 'https://mm.qfmjh.cn';

function parseInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function normalizeBase(raw) {
  try {
    const url = new URL(String(raw).trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function parseUpstreamBases(raw, fallback = DEFAULT_UPSTREAM) {
  const fallbackBase = normalizeBase(fallback) || DEFAULT_UPSTREAM;
  const parts = String(raw ?? '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const bases = [];
  for (const item of parts.length ? parts : [fallbackBase]) {
    const normalized = normalizeBase(item);
    if (normalized && !bases.includes(normalized)) bases.push(normalized);
  }
  return bases.length ? bases : [fallbackBase];
}

function parsePublicBaseUrl(raw) {
  const value = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return value;
  } catch {
    return '';
  }
}

function parseBoolean(raw) {
  return /^(1|true|yes|on)$/i.test(String(raw ?? '').trim());
}

export function loadConfig(env = process.env) {
  const storeConfigFile = String(env.STORE_CONFIG_FILE ?? '').trim() || 'config/stores.json';

  return {
    root: ROOT,
    port: parseInteger(env.PORT, 3000, { min: 1, max: 65535 }),
    upstreamBases: parseUpstreamBases(env.UPSTREAM_BASES),
    upstreamTimeoutMs: parseInteger(env.UPSTREAM_TIMEOUT_MS, 10000, { min: 1000, max: 60000 }),
    publicBaseUrl: parsePublicBaseUrl(env.PUBLIC_BASE_URL),
    domains: String(env.DOMAINS ?? '')
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean),
    mapReferer: String(env.MAP_REFERER ?? '188').trim() || '188',
    storeConfigFile: path.resolve(ROOT, storeConfigFile),
    mockEnabled: parseBoolean(env.MOCK),
  };
}
