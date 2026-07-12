import { boolOption, createTimeoutFetch, formBody, joinUrl, readJsonResponse, splitIds } from './common.mjs';

const PROVIDER = 'synology';

export function createSynologyAdapter(target, runtime = {}) {
  const fetchImpl = createTimeoutFetch(runtime.fetch || globalThis.fetch, target.timeoutSeconds);
  let sid = target.token || '';

  async function login(signal) {
    if (sid) return sid;
    if (!target.username || !target.password) throw new Error('Synology username and password are required.');
    const url = new URL(joinUrl(target.baseUrl, '/auth.cgi'));
    url.search = formBody({
      api: 'SYNO.API.Auth',
      version: 2,
      method: 'login',
      account: target.username,
      passwd: target.password,
      session: target.synologySession,
      format: 'sid'
    }).toString();
    const response = await fetchImpl(url, { signal });
    const json = await readJsonResponse(response, PROVIDER);
    assertSynology(json);
    sid = json.data.sid;
    return sid;
  }

  async function task(method, params = {}, signal, post = false) {
    const currentSid = await login(signal);
    const body = formBody({
      api: 'SYNO.DownloadStation.Task',
      version: target.synologyTaskVersion,
      method,
      _sid: currentSid,
      ...params
    });
    const url = new URL(joinUrl(target.baseUrl, '/DownloadStation/task.cgi'));
    let response;
    if (post) {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal
      });
    } else {
      url.search = body.toString();
      response = await fetchImpl(url, { signal });
    }
    const json = await readJsonResponse(response, PROVIDER);
    assertSynology(json);
    return json.data || {};
  }

  async function add(taskInput, signal) {
    const result = await task('create', {
      uri: taskInput.url,
      destination: taskInput.savePath || undefined
    }, signal, true);
    return { ok: true, provider: PROVIDER, id: result.task_id || '', url: taskInput.url, status: 'queued' };
  }

  async function list(signal) {
    const result = await task('list', { additional: 'detail,transfer,file' }, signal);
    return (result.tasks || []).map(mapTask);
  }

  async function status(taskId, signal) {
    const result = await task('getinfo', { id: splitIds(taskId).join(','), additional: 'detail,transfer,file' }, signal);
    return (result.tasks || []).map(mapTask)[0] || { id: String(taskId), status: 'unknown' };
  }

  async function pause(ids, signal) {
    await task('pause', { id: splitIds(ids).join(',') }, signal, true);
    return { ok: true, provider: PROVIDER, ids: splitIds(ids) };
  }

  async function resume(ids, signal) {
    await task('resume', { id: splitIds(ids).join(',') }, signal, true);
    return { ok: true, provider: PROVIDER, ids: splitIds(ids) };
  }

  async function remove(ids, options = {}, signal) {
    await task('delete', { id: splitIds(ids).join(','), force_complete: boolOption(options.deleteFiles, target.deleteFiles) }, signal, true);
    return { ok: true, provider: PROVIDER, ids: splitIds(ids) };
  }

  async function diagnostics(signal) {
    await login(signal);
    return { ok: true, provider: PROVIDER, session: target.synologySession };
  }

  return { provider: PROVIDER, target, add, list, status, pause, resume, remove, diagnostics };
}

function assertSynology(json) {
  if (!json || json.success !== true) {
    const code = json?.error?.code || 'unknown';
    throw new Error(`Synology API failed: ${code}`);
  }
}

function mapTask(task) {
  const size = Number(task.size || 0);
  const transfer = task.additional?.transfer || {};
  const downloaded = Number(transfer.size_downloaded || 0);
  return {
    id: task.id,
    name: task.title || task.id,
    status: task.status,
    progress: size > 0 ? downloaded / size : 0,
    totalBytes: size,
    completedBytes: downloaded,
    downloadSpeed: Number(transfer.speed_download || 0),
    uploadSpeed: Number(transfer.speed_upload || 0),
    savePath: task.additional?.detail?.destination || '',
    error: task.status_extra?.error_detail || ''
  };
}
