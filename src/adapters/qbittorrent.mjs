import { createTimeoutFetch, formBody, joinUrl, readTextResponse, splitIds } from './common.mjs';

const PROVIDER = 'qbittorrent';

export function createQbittorrentAdapter(target, runtime = {}) {
  const fetchImpl = createTimeoutFetch(runtime.fetch || globalThis.fetch, target.timeoutSeconds);
  let cookie = '';

  async function login(signal) {
    if (!target.username && !target.password) return '';
    const response = await fetchImpl(joinUrl(target.baseUrl, '/api/v2/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({ username: target.username, password: target.password }),
      signal
    });
    const text = await readTextResponse(response, PROVIDER);
    if (!/^ok\.?$/iu.test(text.trim())) throw new Error(`qBittorrent login failed: ${text}`);
    cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie;
    return cookie;
  }

  async function request(path, init = {}, retry = true) {
    const headers = { ...(init.headers || {}) };
    if (cookie) headers.cookie = cookie;
    const response = await fetchImpl(joinUrl(target.baseUrl, path), { ...init, headers });
    if ((response.status === 401 || response.status === 403) && retry && (target.username || target.password)) {
      await login(init.signal);
      return request(path, init, false);
    }
    return response;
  }

  async function add(task, signal) {
    await login(signal);
    const body = new FormData();
    body.set('urls', task.url);
    if (task.savePath) body.set('savepath', task.savePath);
    if (task.category) body.set('category', task.category);
    if (task.tags?.length) body.set('tags', task.tags.join(','));
    if (task.paused) body.set('paused', 'true');
    if (task.sequential) body.set('sequentialDownload', 'true');
    if (task.firstLastPiece) body.set('firstLastPiecePrio', 'true');
    const response = await request('/api/v2/torrents/add', { method: 'POST', body, signal });
    const text = await readTextResponse(response, PROVIDER);
    return { ok: true, provider: PROVIDER, id: '', url: task.url, status: 'queued', message: text || 'Ok.' };
  }

  async function list(signal) {
    await login(signal);
    const response = await request('/api/v2/torrents/info', { signal });
    const text = await readTextResponse(response, PROVIDER);
    return JSON.parse(text || '[]').map(mapTorrent);
  }

  async function status(taskId, signal) {
    await login(signal);
    const query = formBody({ hashes: String(taskId) }).toString();
    const response = await request(`/api/v2/torrents/info?${query}`, { signal });
    const text = await readTextResponse(response, PROVIDER);
    return (JSON.parse(text || '[]').map(mapTorrent))[0] || { id: String(taskId), status: 'unknown' };
  }

  async function pause(ids, signal) {
    return hashAction(['/api/v2/torrents/pause', '/api/v2/torrents/stop'], ids, signal);
  }

  async function resume(ids, signal) {
    return hashAction(['/api/v2/torrents/resume', '/api/v2/torrents/start'], ids, signal);
  }

  async function remove(ids, options = {}, signal) {
    await login(signal);
    const response = await request('/api/v2/torrents/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formBody({ hashes: splitIds(ids).join('|'), deleteFiles: Boolean(options.deleteFiles || target.deleteFiles) }),
      signal
    });
    await readTextResponse(response, PROVIDER);
    return { ok: true, provider: PROVIDER, ids: splitIds(ids) };
  }

  async function hashAction(paths, ids, signal) {
    await login(signal);
    const hashes = splitIds(ids).join('|');
    let lastError;
    for (const path of paths) {
      try {
        const response = await request(path, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: formBody({ hashes }),
          signal
        }, false);
        await readTextResponse(response, PROVIDER);
        return { ok: true, provider: PROVIDER, ids: splitIds(ids) };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async function diagnostics(signal) {
    await login(signal);
    const response = await request('/api/v2/app/version', { signal });
    const version = await readTextResponse(response, PROVIDER);
    return { ok: true, provider: PROVIDER, version };
  }

  return { provider: PROVIDER, target, add, list, status, pause, resume, remove, diagnostics };
}

function mapTorrent(torrent) {
  return {
    id: torrent.hash,
    hash: torrent.hash,
    name: torrent.name,
    status: torrent.state,
    progress: Number(torrent.progress || 0),
    totalBytes: Number(torrent.size || 0),
    completedBytes: Number(torrent.completed || 0),
    downloadSpeed: Number(torrent.dlspeed || 0),
    uploadSpeed: Number(torrent.upspeed || 0),
    savePath: torrent.save_path || '',
    category: torrent.category || '',
    tags: String(torrent.tags || '').split(',').map((item) => item.trim()).filter(Boolean)
  };
}
