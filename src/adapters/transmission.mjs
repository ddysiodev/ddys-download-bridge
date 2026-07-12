import { basicAuth, boolOption, createTimeoutFetch, readJsonResponse, splitIds } from './common.mjs';

const PROVIDER = 'transmission';

export function createTransmissionAdapter(target, runtime = {}) {
  const fetchImpl = createTimeoutFetch(runtime.fetch || globalThis.fetch, target.timeoutSeconds);
  let sessionId = target.token || '';
  let methodStyle = target.transmissionRpcStyle === 'auto' ? 'hyphen' : target.transmissionRpcStyle;

  async function call(method, args = {}, signal, allowFallback = true) {
    const styledMethod = styleMethod(method, methodStyle);
    const body = { method: styledMethod, arguments: styleArguments(args, methodStyle) };
    const headers = { 'content-type': 'application/json' };
    if (sessionId) headers['x-transmission-session-id'] = sessionId;
    const auth = basicAuth(target.username, target.password);
    if (auth) headers.authorization = auth;
    const response = await fetchImpl(target.baseUrl, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (response.status === 409) {
      const nextSessionId = response.headers.get('x-transmission-session-id') || '';
      if (!nextSessionId || nextSessionId === sessionId) throw new Error('Transmission did not return a new session id.');
      sessionId = nextSessionId;
      return call(method, args, signal, allowFallback);
    }
    const json = await readJsonResponse(response, PROVIDER);
    if (json.result && json.result !== 'success') {
      if (allowFallback && target.transmissionRpcStyle === 'auto') {
        methodStyle = methodStyle === 'hyphen' ? 'underscore' : 'hyphen';
        return call(method, args, signal, false);
      }
      throw new Error(`Transmission RPC failed: ${json.result}`);
    }
    return json.arguments || {};
  }

  async function add(task, signal) {
    const args = {
      filename: task.url,
      paused: Boolean(task.paused),
      labels: task.tags || []
    };
    if (task.savePath) args['download-dir'] = task.savePath;
    if (task.sequential) args['sequential-download'] = true;
    const result = await call('torrent-add', args, signal);
    const added = result['torrent-added'] || result.torrent_added || result['torrent-duplicate'] || result.torrent_duplicate || {};
    return { ok: true, provider: PROVIDER, id: added.id || added.hashString || '', hash: added.hashString || '', name: added.name || task.name, status: 'queued' };
  }

  async function list(signal) {
    const result = await call('torrent-get', { fields: fields() }, signal);
    return (result.torrents || []).map(mapTorrent);
  }

  async function status(taskId, signal) {
    const result = await call('torrent-get', { ids: splitIds(taskId), fields: fields() }, signal);
    return (result.torrents || []).map(mapTorrent)[0] || { id: String(taskId), status: 'unknown' };
  }

  async function pause(ids, signal) {
    await call('torrent-stop', { ids: splitIds(ids) }, signal);
    return { ok: true, provider: PROVIDER, ids: splitIds(ids) };
  }

  async function resume(ids, signal) {
    await call('torrent-start', { ids: splitIds(ids) }, signal);
    return { ok: true, provider: PROVIDER, ids: splitIds(ids) };
  }

  async function remove(ids, options = {}, signal) {
    await call('torrent-remove', { ids: splitIds(ids), 'delete-local-data': boolOption(options.deleteFiles, target.deleteFiles) }, signal);
    return { ok: true, provider: PROVIDER, ids: splitIds(ids) };
  }

  async function diagnostics(signal) {
    const result = await call('session-get', { fields: ['version', 'rpc-version'] }, signal);
    return { ok: true, provider: PROVIDER, version: result.version || '', rpcVersion: result['rpc-version'] || result.rpc_version || '' };
  }

  return { provider: PROVIDER, target, add, list, status, pause, resume, remove, diagnostics };
}

function fields() {
  return ['id', 'name', 'hashString', 'status', 'percentDone', 'totalSize', 'downloadDir', 'rateDownload', 'rateUpload', 'labels', 'errorString'];
}

function styleMethod(method, style) {
  return style === 'underscore' ? method.replaceAll('-', '_') : method;
}

function styleArguments(args, style) {
  if (style !== 'underscore') return args;
  const out = {};
  for (const [key, value] of Object.entries(args)) out[key.replaceAll('-', '_')] = value;
  return out;
}

function mapTorrent(torrent) {
  return {
    id: torrent.id,
    hash: torrent.hashString || torrent.hash_string || '',
    name: torrent.name,
    status: mapTransmissionStatus(torrent.status),
    progress: Number(torrent.percentDone ?? torrent.percent_done ?? 0),
    totalBytes: Number(torrent.totalSize ?? torrent.total_size ?? 0),
    downloadSpeed: Number(torrent.rateDownload ?? torrent.rate_download ?? 0),
    uploadSpeed: Number(torrent.rateUpload ?? torrent.rate_upload ?? 0),
    savePath: torrent.downloadDir || torrent.download_dir || '',
    tags: torrent.labels || [],
    error: torrent.errorString || torrent.error_string || ''
  };
}

function mapTransmissionStatus(status) {
  const code = Number(status);
  if (code === 0) return 'paused';
  if (code === 4) return 'downloading';
  if (code === 6) return 'seeding';
  return String(status || 'unknown');
}
