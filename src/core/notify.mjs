import crypto from 'node:crypto';

export async function sendWebhook(settings, event, payload, runtime = {}) {
  if (!settings.webhookUrl) return { skipped: true };
  const fetchImpl = runtime.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { skipped: true, reason: 'fetch unavailable' };
  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    payload
  });
  const headers = {
    'content-type': 'application/json',
    'user-agent': settings.userAgent
  };
  if (settings.webhookSecret) {
    headers['x-ddys-signature'] = `sha256=${crypto.createHmac('sha256', settings.webhookSecret).update(body).digest('hex')}`;
  }
  const response = await fetchImpl(settings.webhookUrl, { method: 'POST', headers, body });
  return { ok: response.ok, status: response.status };
}
