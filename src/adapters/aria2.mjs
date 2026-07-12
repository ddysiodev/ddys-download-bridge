import { createTimeoutFetch, headerArray, readJsonResponse, splitIds } from './common.mjs';

const PROVIDER = 'aria2';

export function createAria2Adapter(target, runtime = {}) {
  const fetchImpl = createTimeoutFetch(runtime.fetch || globalThis.fetch, target.timeoutSeconds);
  let id = 0;

  async function rpc(method, params = [], signal) {
    const body = {
      jsonrpc: '2.0',
      id: `ddys-${++id}`,
      method,
      params: target.secret ? [`token:${target.secret}`, ...params] : params
    };
    const response = await fetchImpl(target.baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });
    const json = await readJsonResponse(response, PROVIDER);
    if (json.error) {
      const message = json.error.message || `aria2 RPC error ${json.error.code}`;
      throw new Error(message);
    }
    return json.result;
  }

  async function add(task, signal) {
    const options = {};
    if (task.savePath) options.dir = task.savePath;
    if (task.paused) options.pause = 'true';
    if (task.headers && Object.keys(task.headers).length) options.header = headerArray(task.headers);
    const gid = await rpc('aria2.addUri', [[task.url], options], signal);
    return { ok: true, provider: PROVIDER, id: gid, gid, url: task.url, status: task.paused ? 'paused' : 'queued' };
  }

  async function list(signal) {
    const fields = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'uploadSpeed', 'files', 'dir', 'errorMessage'];
    const [active, waiting, stopped] = await Promise.all([
      rpc('aria2.tellActive', [fields], signal),
      rpc('aria2.tellWaiting', [0, 100, fields], signal),
      rpc('aria2.tellStopped', [0, 100, fields], signal)
    ]);
    return [...active, ...waiting, ...stopped].map(mapTask);
  }

  async function status(taskId, signal) {
    const fields = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'uploadSpeed', 'files', 'dir', 'errorMessage'];
    return mapTask(await rpc('aria2.tellStatus', [String(taskId), fields], signal));
  }

  async function pause(ids, signal) {
    const out = [];
    for (const idValue of splitIds(ids)) out.push(await rpc('aria2.pause', [idValue], signal));
    return { ok: true, provider: PROVIDER, ids: out };
  }

  async function resume(ids, signal) {
    const out = [];
    for (const idValue of splitIds(ids)) out.push(await rpc('aria2.unpause', [idValue], signal));
    return { ok: true, provider: PROVIDER, ids: out };
  }

  async function remove(ids, options = {}, signal) {
    const out = [];
    for (const idValue of splitIds(ids)) {
      try {
        out.push(await rpc('aria2.remove', [idValue], signal));
      } catch {
        out.push(await rpc('aria2.removeDownloadResult', [idValue], signal));
      }
      if (options.deleteFiles) {
        // aria2 RPC intentionally does not delete completed files; callers keep filesystem policy external.
      }
    }
    return { ok: true, provider: PROVIDER, ids: out };
  }

  async function diagnostics(signal) {
    const version = await rpc('aria2.getVersion', [], signal);
    return { ok: true, provider: PROVIDER, version: version.version, enabledFeatures: version.enabledFeatures || [] };
  }

  return { provider: PROVIDER, target, add, list, status, pause, resume, remove, diagnostics };
}

function mapTask(task) {
  const total = Number(task.totalLength || 0);
  const completed = Number(task.completedLength || 0);
  const firstFile = task.files?.[0]?.path || '';
  return {
    id: task.gid,
    gid: task.gid,
    name: firstFile.split(/[\\/]/u).pop() || task.gid,
    status: task.status,
    progress: total > 0 ? completed / total : 0,
    totalBytes: total,
    completedBytes: completed,
    downloadSpeed: Number(task.downloadSpeed || 0),
    uploadSpeed: Number(task.uploadSpeed || 0),
    dir: task.dir || '',
    error: task.errorMessage || ''
  };
}
