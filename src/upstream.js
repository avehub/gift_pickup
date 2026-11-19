export class UpstreamError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = 'UpstreamError';
  }
}

export class UpstreamNotFoundError extends UpstreamError {
  constructor(message = '卡号不存在') {
    super(message);
    this.name = 'UpstreamNotFoundError';
  }
}

export class UpstreamTimeoutError extends UpstreamError {
  constructor(message = '上游查询超时') {
    super(message);
    this.name = 'UpstreamTimeoutError';
  }
}

const UPSTREAM_PATH = '/gateway/mall/physicalCardOrder/getUsableStation';

function isTimeout(error) {
  return (
    error?.name === 'TimeoutError' ||
    error?.name === 'AbortError' ||
    error?.code === 'ABORT_ERR'
  );
}

function businessMessage(payload) {
  return String(payload?.msg ?? payload?.message ?? '').trim();
}

/**
 * 依次尝试 UPSTREAM_BASES 中的域名。所有尝试共享 timeoutMs 总预算。
 * 业务错误（如卡号不存在）直接终止；网络/5xx/超时才尝试下一个域名。
 */
export async function fetchUsableStation({
  orderId,
  bases,
  timeoutMs = 10000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const list = Array.isArray(bases) ? bases.filter(Boolean) : [];
  if (!list.length) throw new UpstreamError('未配置上游域名');

  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let timedOut = false;

  for (const base of list) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      timedOut = true;
      break;
    }

    const url = `${String(base).replace(/\/+$/, '')}${UPSTREAM_PATH}`;
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          orderId: String(orderId),
          latitude: '',
          longitude: '',
        }),
        signal: AbortSignal.timeout(remaining),
      });

      if (!response.ok) {
        lastError = new UpstreamError(`上游 HTTP ${response.status}`);
        continue;
      }

      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        lastError = new UpstreamError('上游返回了非法 JSON', { cause: error });
        continue;
      }

      const code = Number(payload?.code);
      if (code === 200) {
        return payload.data ?? {};
      }

      const message = businessMessage(payload);
      if (message.includes('卡号不存在')) {
        throw new UpstreamNotFoundError(message);
      }
      throw new UpstreamError(message || `上游业务错误 code=${payload?.code}`);
    } catch (error) {
      // 主动抛出的业务错误（卡号不存在/其他业务码）是确定结论，不再尝试其他域名。
      if (error instanceof UpstreamError) throw error;
      if (isTimeout(error)) timedOut = true;
      lastError = error;
    }
  }

  if (timedOut) {
    throw new UpstreamTimeoutError(lastError?.message || '上游查询超时');
  }
  throw new UpstreamError(lastError?.message || '上游服务不可用', {
    cause: lastError,
  });
}
