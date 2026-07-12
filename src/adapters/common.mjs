export class DownloadAdapterError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'DownloadAdapterError';
    this.provider = options.provider || '';
    this.status = options.status || 0;
    this.body = options.body || '';
  }
}

export function createTimeoutFetch(fetchImpl, timeoutSeconds) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is required.');
  return async function timeoutFetch(url, init = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Download adapter request timed out.')), timeoutSeconds * 1000);
    const signal = init.signal;
    const abort = () => controller.abort(signal.reason);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', abort, { once: true });
    }
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', abort);
    }
  };
}

export function basicAuth(username, password) {
  if (!username && !password) return '';
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

export function joinUrl(base, path) {
  return `${String(base || '').replace(/\/+$/u, '')}/${String(path || '').replace(/^\/+/u, '')}`;
}

export async function readJsonResponse(response, provider) {
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new DownloadAdapterError(`${provider} returned non-JSON response.`, {
      provider,
      status: response.status,
      body: text,
      cause: error
    });
  }
  if (!response.ok) {
    throw new DownloadAdapterError(`${provider} HTTP ${response.status}`, {
      provider,
      status: response.status,
      body: text
    });
  }
  return json;
}

export async function readTextResponse(response, provider) {
  const text = await response.text();
  if (!response.ok) {
    throw new DownloadAdapterError(`${provider} HTTP ${response.status}: ${text}`, {
      provider,
      status: response.status,
      body: text
    });
  }
  return text;
}

export function formBody(value) {
  const body = new URLSearchParams();
  for (const [key, entry] of Object.entries(value || {})) {
    if (entry === undefined || entry === null || entry === '') continue;
    if (Array.isArray(entry)) body.set(key, entry.join(','));
    else body.set(key, String(entry));
  }
  return body;
}

export function splitIds(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

export function headerArray(headers = {}) {
  return Object.entries(headers || {}).map(([key, value]) => `${key}: ${value}`);
}

export function mapStatus(status) {
  const text = String(status || '').toLowerCase();
  if (['downloading', 'download', 'active', 'running'].includes(text)) return 'downloading';
  if (['paused', 'stopped', 'pause'].includes(text)) return 'paused';
  if (['uploading', 'seeding', 'seed'].includes(text)) return 'seeding';
  if (['complete', 'completed', 'finished'].includes(text)) return 'completed';
  if (['error', 'failed'].includes(text)) return 'error';
  return text || 'unknown';
}
