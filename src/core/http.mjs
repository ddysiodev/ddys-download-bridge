import http from 'node:http';
import { createDownloadBridge } from './bridge.mjs';

export async function startNodeServer(options = {}, runtime = {}) {
  const bridge = createDownloadBridge(options, runtime);
  const server = http.createServer((request, response) => {
    handleRequest(bridge, request, response).catch((error) => {
      writeJson(response, error.statusCode || 500, { ok: false, error: error.message || String(error) });
    });
  });
  await new Promise((resolve) => server.listen(bridge.settings.port, bridge.settings.host, resolve));
  const url = `http://${bridge.settings.host}:${bridge.settings.port}`;
  return { server, bridge, url, settings: bridge.settings };
}

export async function handleRequest(bridge, request, response) {
  setCors(response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  authorize(bridge, request);
  const url = new URL(request.url || '/', bridge.settings.publicBase);
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (url.pathname === '/' || url.pathname === '/health') {
    writeJson(response, 200, { ok: true, name: 'ddys-download-bridge' });
    return;
  }
  if (url.pathname === '/routes') {
    writeJson(response, 200, routes(bridge.settings.publicBase));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/search') {
    writeJson(response, 200, await bridge.search(url.searchParams.get('q') || '', readPaging(url), request.signal));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/latest') {
    writeJson(response, 200, await bridge.latest(Number(url.searchParams.get('limit') || bridge.settings.homeLimit), request.signal));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/hot') {
    writeJson(response, 200, await bridge.hot(Number(url.searchParams.get('limit') || bridge.settings.homeLimit), request.signal));
    return;
  }
  if (request.method === 'GET' && segments[0] === 'api' && segments[1] === 'movies' && segments[3] === 'resources') {
    writeJson(response, 200, await bridge.resources(segments[2], queryOptions(url), request.signal));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/downloads') {
    const body = await readJson(request);
    if (body.url) writeJson(response, 200, await bridge.addUrl(body.url, { ...body, target: body.target || url.searchParams.get('target') }, request.signal));
    else writeJson(response, 200, await bridge.push(body.slug, { ...body, target: body.target || url.searchParams.get('target') }, request.signal));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/tasks') {
    writeJson(response, 200, await bridge.list(queryOptions(url), request.signal));
    return;
  }
  if (segments[0] === 'api' && segments[1] === 'tasks' && segments[2]) {
    await taskRoute(bridge, segments, request, response, url);
    return;
  }
  throw Object.assign(new Error(`Not found: ${url.pathname}`), { statusCode: 404 });
}

async function taskRoute(bridge, segments, request, response, url) {
  const id = segments[2];
  const action = segments[3] || 'status';
  if (request.method === 'GET' && action === 'status') {
    writeJson(response, 200, await bridge.status(id, queryOptions(url), request.signal));
    return;
  }
  if (request.method !== 'POST') throw Object.assign(new Error('Method not allowed.'), { statusCode: 405 });
  const body = await readJson(request);
  if (action === 'pause') writeJson(response, 200, await bridge.pause(id, { ...queryOptions(url), ...body }, request.signal));
  else if (action === 'resume') writeJson(response, 200, await bridge.resume(id, { ...queryOptions(url), ...body }, request.signal));
  else if (action === 'remove') writeJson(response, 200, await bridge.remove(id, { ...queryOptions(url), ...body }, request.signal));
  else throw Object.assign(new Error(`Unknown task action: ${action}`), { statusCode: 404 });
}

function authorize(bridge, request) {
  if (!bridge.settings.authToken) return;
  const authorization = request.headers.authorization || request.headers.Authorization || '';
  const token = authorization.replace(/^Bearer\s+/iu, '').trim();
  if (token !== bridge.settings.authToken) {
    throw Object.assign(new Error('Unauthorized.'), { statusCode: 401 });
  }
}

function readPaging(url) {
  return {
    page: Number(url.searchParams.get('page') || 1),
    perPage: Number(url.searchParams.get('perPage') || url.searchParams.get('per_page') || 20)
  };
}

function queryOptions(url) {
  return {
    target: url.searchParams.get('target') || undefined,
    type: url.searchParams.get('type') || undefined,
    index: url.searchParams.get('index') || undefined,
    indexes: url.searchParams.get('indexes') || undefined,
    limit: Number(url.searchParams.get('limit') || 0) || undefined,
    all: ['1', 'true', 'yes'].includes(String(url.searchParams.get('all') || '').toLowerCase()),
    dryRun: ['1', 'true', 'yes'].includes(String(url.searchParams.get('dryRun') || url.searchParams.get('dry_run') || '').toLowerCase())
  };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

function writeJson(response, statusCode, value) {
  setCors(response);
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value, null, 2));
}

function setCors(response) {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  response.setHeader('access-control-allow-headers', 'Authorization, Content-Type');
}

function routes(base) {
  const root = String(base || '').replace(/\/$/u, '');
  return {
    health: `${root}/health`,
    search: `${root}/api/search?q=keyword`,
    latest: `${root}/api/latest`,
    hot: `${root}/api/hot`,
    resources: `${root}/api/movies/{slug}/resources`,
    add: `${root}/api/downloads`,
    tasks: `${root}/api/tasks`
  };
}
