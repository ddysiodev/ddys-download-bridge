import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'package.json',
  'README.md',
  'README.en.md',
  'LICENSE',
  '.env.example',
  'Dockerfile',
  'docker-compose.yml',
  'index.d.ts',
  '.github/workflows/build.yml',
  'docs/architecture.md',
  'docs/api-shapes.md',
  'examples/config.example.json',
  'tools/check.mjs',
  'tools/build-package.ps1',
  'tests/run.mjs',
  'cli/ddys-download-bridge.mjs',
  'src/index.mjs',
  'src/server.mjs',
  'src/core/bridge.mjs',
  'src/core/client.mjs',
  'src/core/config.mjs',
  'src/core/http.mjs',
  'src/core/notify.mjs',
  'src/core/resources.mjs',
  'src/adapters/aria2.mjs',
  'src/adapters/common.mjs',
  'src/adapters/index.mjs',
  'src/adapters/qbittorrent.mjs',
  'src/adapters/synology.mjs',
  'src/adapters/transmission.mjs'
];

const forbiddenDirs = new Set(['.git', '.wrangler', 'node_modules', 'dist', 'build', 'coverage', 'package', 'bin-output', 'obj']);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(relative) {
  try {
    await fs.access(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
}

async function read(relative) {
  return fs.readFile(path.join(root, relative), 'utf8');
}

async function listFiles(dir = root, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (forbiddenDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await listFiles(full, out);
    else out.push(full);
  }
  return out;
}

async function main() {
  for (const file of required) assert(await exists(file), `Missing required file: ${file}`);

  const pkg = JSON.parse(await read('package.json'));
  assert(pkg.name === 'ddys-download-bridge', 'package name mismatch.');
  assert(pkg.version === '0.1.1', 'package version mismatch.');
  assert(pkg.type === 'module', 'package must be ESM.');
  assert(pkg.bin && pkg.bin['ddys-download-bridge'], 'CLI bin missing.');
  assert(pkg.private === true, 'package must remain private until npm publishing is requested.');

  const adapters = {
    'src/adapters/qbittorrent.mjs': ['/api/v2/auth/login', '/api/v2/torrents/add', '/api/v2/torrents/info', '/api/v2/torrents/delete'],
    'src/adapters/aria2.mjs': ['aria2.addUri', 'aria2.tellActive', 'aria2.tellStatus', 'aria2.pause', 'aria2.unpause'],
    'src/adapters/transmission.mjs': ['torrent-add', 'torrent-get', 'x-transmission-session-id', 'torrent-remove'],
    'src/adapters/synology.mjs': ['SYNO.API.Auth', 'SYNO.DownloadStation.Task', 'create', 'getinfo', 'delete']
  };
  for (const [file, fragments] of Object.entries(adapters)) {
    const text = await read(file);
    for (const fragment of fragments) assert(text.includes(fragment), `${file} missing ${fragment}.`);
  }

  const resources = await read('src/core/resources.mjs');
  for (const fragment of ['magnet', 'ed2k', 'torrent', 'direct', 'cloud', 'providerSupportsType']) {
    assert(resources.includes(fragment), `Resource classifier missing ${fragment}.`);
  }

  const http = await read('src/core/http.mjs');
  for (const fragment of ['/api/search', '/api/downloads', '/api/tasks', 'Authorization', 'access-control-allow-origin']) {
    assert(http.includes(fragment), `HTTP API missing ${fragment}.`);
  }

  const readme = await read('README.md');
  for (const fragment of ['qBittorrent', 'aria2', 'Transmission', 'Download Station', 'Webhook', 'HTTP API']) {
    assert(readme.includes(fragment), `README missing ${fragment}.`);
  }
  assert(!readme.includes('## **开发打包**'), 'README contains unwanted developer packaging section.');

  const workflow = await read('.github/workflows/build.yml');
  assert(workflow.includes('node tools/check.mjs'), 'workflow must run check.');
  assert(workflow.includes('node tests/run.mjs'), 'workflow must run tests.');
  assert(workflow.includes('tools/build-package.ps1'), 'workflow must build release package.');

  const files = await listFiles();
  for (const file of files) {
    const relative = path.relative(root, file).replaceAll(path.sep, '/');
    assert(!relative.endsWith('.env'), 'Environment files must not be included.');
    assert(!relative.includes('/node_modules/'), 'node_modules must not be included.');
    assert(!relative.includes('/package/'), 'package directory must not be included.');
  }

  const textFiles = files.filter((file) => /\.(mjs|js|md|json|yml|yaml|ps1|env|Dockerfile)$/i.test(file) || path.basename(file) === 'Dockerfile');
  const allText = (await Promise.all(textFiles.map((file) => fs.readFile(file, 'utf8')))).join('\n');
  assert(!/ghp_[A-Za-z0-9_]+/.test(allText), 'GitHub token-like value found.');
  assert(!/github_pat_[A-Za-z0-9_]+/.test(allText), 'GitHub fine-grained token-like value found.');
  assert(!/npm_[A-Za-z0-9_]+/.test(allText), 'npm token-like value found.');
  assert(!/sk-[A-Za-z0-9]{20,}/.test(allText), 'OpenAI token-like value found.');
  assert(!allText.includes('\uFFFD'), 'Replacement character found.');

  console.log(JSON.stringify({ ok: true, package: 'ddys-download-bridge', files: files.length }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
