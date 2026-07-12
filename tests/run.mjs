import assert from 'node:assert/strict';
import { createAria2Adapter, createQbittorrentAdapter, createSynologyAdapter, createTransmissionAdapter } from '../src/adapters/index.mjs';
import { createDownloadBridge } from '../src/core/bridge.mjs';
import { normalizeOptions } from '../src/core/config.mjs';
import { classifyResource, createDownloadTask, providerSupportsType } from '../src/core/resources.mjs';

const tests = [];

test('classifies resource types and provider capabilities', () => {
  assert.equal(classifyResource('magnet:?xt=urn:btih:abcdef'), 'magnet');
  assert.equal(classifyResource('ed2k://|file|movie.mkv|1|hash|/'), 'ed2k');
  assert.equal(classifyResource('https://example.com/a.torrent'), 'torrent');
  assert.equal(classifyResource('https://example.com/movie.mkv?x=1'), 'direct');
  assert.equal(classifyResource('https://pan.baidu.com/s/abc'), 'cloud');
  assert.equal(providerSupportsType('aria2', 'ed2k'), true);
  assert.equal(providerSupportsType('transmission', 'ed2k'), false);
  assert.equal(providerSupportsType('qbittorrent', 'direct'), false);
  assert.equal(providerSupportsType('transmission', 'http'), false);
});

test('normalizes env-style single target config', () => {
  const settings = normalizeOptions({
    target: 'qb',
    targets: {
      qb: {
        provider: 'qbittorrent',
        baseUrl: 'http://localhost:8080/',
        tags: 'ddys,auto',
        paused: 'true'
      }
    }
  });
  assert.equal(settings.target, 'qb');
  assert.equal(settings.targets.qb.baseUrl, 'http://localhost:8080');
  assert.deepEqual(settings.targets.qb.tags, ['ddys', 'auto']);
  assert.equal(settings.targets.qb.paused, true);
});

test('aria2 addUri includes token and download options', async () => {
  const calls = [];
  const adapter = createAria2Adapter({
    name: 'a',
    provider: 'aria2',
    baseUrl: 'http://aria2/jsonrpc',
    secret: 'secret',
    timeoutSeconds: 5
  }, { fetch: fakeFetch(async (url, init) => {
    calls.push(JSON.parse(init.body));
    return jsonResponse({ jsonrpc: '2.0', id: calls.at(-1).id, result: 'gid1' });
  }) });
  const result = await adapter.add({ url: 'magnet:?xt=urn:btih:abc', savePath: '/downloads', paused: true, headers: { Referer: 'https://ddys.io' } });
  assert.equal(result.gid, 'gid1');
  assert.equal(calls[0].method, 'aria2.addUri');
  assert.equal(calls[0].params[0], 'token:secret');
  assert.equal(calls[0].params[2].dir, '/downloads');
  assert.deepEqual(calls[0].params[2].header, ['Referer: https://ddys.io']);
});

test('qBittorrent logs in and submits multipart add request', async () => {
  const urls = [];
  const adapter = createQbittorrentAdapter({
    name: 'qb',
    provider: 'qbittorrent',
    baseUrl: 'http://qb',
    username: 'admin',
    password: 'pass',
    timeoutSeconds: 5
  }, { fetch: fakeFetch(async (url, init) => {
    urls.push([String(url), init.method || 'GET', init.body?.constructor?.name || '']);
    if (String(url).endsWith('/api/v2/auth/login')) return textResponse('Ok.', 200, { 'set-cookie': 'SID=abc; Path=/' });
    if (String(url).endsWith('/api/v2/torrents/add')) return textResponse('Ok.');
    return textResponse('missing', 404);
  }) });
  const result = await adapter.add({ url: 'magnet:?xt=urn:btih:abc', category: 'ddys', tags: ['ddys'] });
  assert.equal(result.ok, true);
  assert.equal(urls[0][0], 'http://qb/api/v2/auth/login');
  assert.equal(urls[1][0], 'http://qb/api/v2/torrents/add');
  assert.equal(urls[1][2], 'FormData');
});

test('Transmission retries with session id then adds torrent', async () => {
  const calls = [];
  const adapter = createTransmissionAdapter({
    name: 'tr',
    provider: 'transmission',
    baseUrl: 'http://tr/transmission/rpc',
    timeoutSeconds: 5,
    transmissionRpcStyle: 'auto'
  }, { fetch: fakeFetch(async (url, init) => {
    calls.push({ headers: init.headers, body: JSON.parse(init.body) });
    if (calls.length === 1) return jsonResponse({}, 409, { 'x-transmission-session-id': 'sid1' });
    return jsonResponse({ result: 'success', arguments: { 'torrent-added': { id: 7, hashString: 'hash', name: 'movie' } } });
  }) });
  const result = await adapter.add({ url: 'magnet:?xt=urn:btih:abc', tags: ['ddys'] });
  assert.equal(result.id, 7);
  assert.equal(calls[1].headers['x-transmission-session-id'], 'sid1');
  assert.equal(calls[1].body.method, 'torrent-add');
});

test('Synology logs in and creates Download Station task', async () => {
  const calls = [];
  const adapter = createSynologyAdapter({
    name: 'syno',
    provider: 'synology',
    baseUrl: 'http://nas/webapi',
    username: 'admin',
    password: 'pass',
    synologySession: 'DownloadStation',
    synologyTaskVersion: 1,
    timeoutSeconds: 5
  }, { fetch: fakeFetch(async (url, init = {}) => {
    calls.push([String(url), init.method || 'GET', String(init.body || '')]);
    if (String(url).includes('/auth.cgi')) return jsonResponse({ success: true, data: { sid: 'sid1' } });
    return jsonResponse({ success: true, data: { task_id: 'task1' } });
  }) });
  const result = await adapter.add({ url: 'https://example.com/a.torrent', savePath: 'video/ddys' });
  assert.equal(result.ok, true);
  assert.ok(calls[0][0].includes('SYNO.API.Auth'));
  assert.ok(calls[1][0].endsWith('/DownloadStation/task.cgi'));
  assert.ok(calls[1][2].includes('method=create'));
});

test('bridge dry-run filters DDYS sources by target capability', async () => {
  const bridge = createDownloadBridge({
    enableCache: false,
    targets: {
      tr: {
        provider: 'transmission',
        baseUrl: 'http://tr/transmission/rpc'
      }
    },
    target: 'tr'
  }, { fetch: fakeFetch(async (url) => {
    const text = String(url);
    if (text.includes('/movies/demo/sources')) {
      return jsonResponse({ data: {
        download: [
          { name: 'Magnet', url: 'magnet:?xt=urn:btih:abc' },
          { name: 'ed2k', url: 'ed2k://|file|a.mkv|1|hash|/' },
          { name: 'cloud', url: 'https://pan.baidu.com/s/abc' }
        ]
      } });
    }
    if (text.includes('/movies/demo/related')) return jsonResponse({ data: [] });
    if (text.includes('/movies/demo')) return jsonResponse({ data: { slug: 'demo', title: 'Demo Movie' } });
    if (text.includes('/latest')) return jsonResponse({ data: [{ slug: 'demo', title: 'Demo Movie' }] });
    return jsonResponse({ data: [] });
  }) });
  const result = await bridge.push('demo', { all: true, dryRun: true });
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].type, 'magnet');
});

test('bridge keeps string false booleans false and normalizes string tags', async () => {
  const task = createDownloadTask(
    { url: 'magnet:?xt=urn:btih:abc', name: 'Demo' },
    { name: 'qb', provider: 'qbittorrent', tags: ['target'], paused: true, sequential: true, firstLastPiece: true },
    {
      tags: 'ddys,manual',
      paused: 'false',
      sequential: 'false',
      firstLastPiece: 'false',
      headers: 'Referer: https://ddys.io'
    }
  );
  assert.deepEqual(task.tags, ['ddys', 'manual']);
  assert.equal(task.paused, false);
  assert.equal(task.sequential, false);
  assert.equal(task.firstLastPiece, false);
  assert.deepEqual(task.headers, { Referer: 'https://ddys.io' });
});

test('DDYS grouped source arrays are expanded instead of dropped', async () => {
  const bridge = createDownloadBridge({
    enableCache: false,
    targets: {
      aria: {
        provider: 'aria2',
        baseUrl: 'http://aria2/jsonrpc'
      }
    },
    target: 'aria'
  }, { fetch: fakeFetch(async (url) => {
    const text = String(url);
    if (text.includes('/movies/grouped/sources')) {
      return jsonResponse({ data: [
        { name: 'Line A', items: [{ name: 'EP01', url: 'magnet:?xt=urn:btih:aaa' }] },
        { title: 'Line B', resources: [{ label: 'EP02', link: 'https://example.com/ep02.mkv' }] }
      ] });
    }
    if (text.includes('/movies/grouped/related')) return jsonResponse({ data: [] });
    if (text.includes('/movies/grouped')) return jsonResponse({ data: { slug: 'grouped', title: 'Grouped Movie' } });
    return jsonResponse({ data: [] });
  }) });
  const result = await bridge.resources('grouped', { all: true });
  assert.equal(result.allResources.length, 2);
  assert.equal(result.allResources[0].groupName, 'Line A');
  assert.equal(result.allResources[1].groupName, 'Line B');
  assert.equal(result.resources.length, 2);
});

test('string false deleteFiles remains false for downloader adapters', async () => {
  const calls = [];
  const adapter = createTransmissionAdapter({
    name: 'tr',
    provider: 'transmission',
    baseUrl: 'http://tr/transmission/rpc',
    deleteFiles: true,
    timeoutSeconds: 5,
    transmissionRpcStyle: 'hyphen'
  }, { fetch: fakeFetch(async (url, init) => {
    calls.push(JSON.parse(init.body));
    return jsonResponse({ result: 'success', arguments: {} });
  }) });
  await adapter.remove('7', { deleteFiles: 'false' });
  assert.equal(calls[0].arguments['delete-local-data'], false);
});

for (const entry of tests) {
  try {
    await entry.fn();
  } catch (error) {
    console.error(`not ok - ${entry.name}`);
    throw error;
  }
}

console.log(JSON.stringify({ ok: true, tests: tests.length }, null, 2));

function test(name, fn) {
  tests.push({ name, fn });
}

function fakeFetch(handler) {
  return async (url, init = {}) => handler(url, init);
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function textResponse(value, status = 200, headers = {}) {
  return new Response(value, { status, headers });
}
