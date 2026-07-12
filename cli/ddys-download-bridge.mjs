#!/usr/bin/env node
import fs from 'node:fs/promises';
import process from 'node:process';
import { createDownloadBridge } from '../src/core/bridge.mjs';
import { describePublicOptions, normalizeOptions, optionsFromEnv, toBool, VERSION } from '../src/core/config.mjs';
import { startNodeServer } from '../src/core/http.mjs';

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed.positionals[0] || 'help';
  if (parsed.options.help || command === 'help') {
    console.log(helpText());
    return;
  }
  if (command === 'version' || command === '--version') {
    console.log(VERSION);
    return;
  }

  const fileConfig = await readConfig(parsed.options.config);
  const config = normalizeOptions({ ...optionsFromEnv(), ...fileConfig, ...configFromOptions(parsed.options) });
  const bridge = createDownloadBridge(config);

  if (command === 'serve') {
    const { url } = await startNodeServer(config);
    console.log(JSON.stringify({ ok: true, url }, null, 2));
    return;
  }

  if (command === 'doctor' || command === 'diag') {
    console.log(JSON.stringify(await bridge.diagnostics(), null, 2));
    return;
  }

  if (command === 'config') {
    console.log(JSON.stringify(describePublicOptions(config), null, 2));
    return;
  }

  if (command === 'routes') {
    console.log(JSON.stringify({
      health: `${config.publicBase}/health`,
      search: `${config.publicBase}/api/search?q=keyword`,
      resources: `${config.publicBase}/api/movies/{slug}/resources`,
      add: `${config.publicBase}/api/downloads`,
      tasks: `${config.publicBase}/api/tasks`
    }, null, 2));
    return;
  }

  if (command === 'search') {
    const query = parsed.positionals.slice(1).join(' ') || parsed.options.query || parsed.options.q;
    console.log(JSON.stringify(await bridge.search(query, paging(parsed.options)), null, 2));
    return;
  }

  if (command === 'latest') {
    console.log(JSON.stringify(await bridge.latest(parsed.options.limit || config.homeLimit), null, 2));
    return;
  }

  if (command === 'hot') {
    console.log(JSON.stringify(await bridge.hot(parsed.options.limit || config.homeLimit), null, 2));
    return;
  }

  if (command === 'resources') {
    const slug = required(parsed.positionals[1], 'Movie slug is required.');
    console.log(JSON.stringify(await bridge.resources(slug, resourceOptions(parsed.options)), null, 2));
    return;
  }

  if (command === 'add') {
    const urls = parsed.positionals.slice(1);
    if (urls.length === 0) throw new Error('At least one URL is required.');
    const results = [];
    for (const url of urls) results.push(await bridge.addUrl(url, pushOptions(parsed.options)));
    console.log(JSON.stringify({ ok: results.every((item) => item.ok), results }, null, 2));
    return;
  }

  if (command === 'push') {
    const slug = required(parsed.positionals[1], 'Movie slug is required.');
    console.log(JSON.stringify(await bridge.push(slug, pushOptions(parsed.options)), null, 2));
    return;
  }

  if (command === 'tasks' || command === 'list') {
    console.log(JSON.stringify(await bridge.list(taskOptions(parsed.options)), null, 2));
    return;
  }

  if (command === 'status') {
    console.log(JSON.stringify(await bridge.status(required(parsed.positionals[1], 'Task id is required.'), taskOptions(parsed.options)), null, 2));
    return;
  }

  if (command === 'pause') {
    console.log(JSON.stringify(await bridge.pause(ids(parsed), taskOptions(parsed.options)), null, 2));
    return;
  }

  if (command === 'resume') {
    console.log(JSON.stringify(await bridge.resume(ids(parsed), taskOptions(parsed.options)), null, 2));
    return;
  }

  if (command === 'remove' || command === 'delete') {
    console.log(JSON.stringify(await bridge.remove(ids(parsed), { ...taskOptions(parsed.options), deleteFiles: Boolean(parsed.options.deleteFiles) }), null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function readConfig(file) {
  if (!file) return {};
  const text = await fs.readFile(file, 'utf8');
  return JSON.parse(text);
}

function configFromOptions(options) {
  const config = {};
  const direct = [
    'apiBase', 'siteBase', 'apiKey', 'userAgent', 'timeoutSeconds', 'pageSize', 'homeLimit',
    'host', 'port', 'publicBase', 'authToken', 'webhookUrl', 'webhookSecret',
    'includeUnsupported', 'directOnly', 'dedupe', 'defaultResourceType', 'target'
  ];
  for (const key of direct) if (options[key] !== undefined) config[key] = options[key];

  if (options.provider || options.baseUrl || options.username || options.password || options.secret) {
    const name = options.target || 'default';
    config.target = name;
    config.targets = {
      [name]: {
        name,
        provider: options.provider,
        baseUrl: options.baseUrl,
        username: options.username,
        password: options.password,
        secret: options.secret,
        token: options.token,
        savePath: options.savePath,
        category: options.category,
        tags: options.tags,
        paused: options.paused,
        sequential: options.sequential,
        firstLastPiece: options.firstLastPiece,
        deleteFiles: options.deleteFiles,
        synologySession: options.synologySession,
        synologyTaskVersion: options.synologyTaskVersion,
        transmissionRpcStyle: options.transmissionRpcStyle
      }
    };
  }
  return config;
}

function pushOptions(options) {
  return {
    ...resourceOptions(options),
    target: options.target,
    dryRun: Boolean(options.dryRun),
    all: Boolean(options.all),
    continueOnError: Boolean(options.continueOnError),
    savePath: options.savePath,
    category: options.category,
    tags: options.tags ? String(options.tags).split(',').map((item) => item.trim()).filter(Boolean) : undefined,
    paused: options.paused,
    sequential: options.sequential,
    firstLastPiece: options.firstLastPiece
  };
}

function resourceOptions(options) {
  return {
    target: options.target,
    type: options.type || options.resourceType,
    index: options.index,
    indexes: options.indexes,
    limit: options.limit,
    includeUnsupported: options.includeUnsupported ? true : undefined,
    directOnly: options.directOnly ? true : undefined
  };
}

function taskOptions(options) {
  return { target: options.target };
}

function paging(options) {
  return { page: options.page, perPage: options.perPage || options.per_page };
}

function ids(parsed) {
  const values = parsed.positionals.slice(1);
  if (values.length === 0) throw new Error('Task id is required.');
  return values;
}

function required(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function parseArgs(argv) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    const [rawName, inlineValue] = arg.replace(/^--?/, '').split(/=(.*)/s, 2);
    const name = toCamel(rawName);
    if ([
      'help', 'dryRun', 'all', 'paused', 'sequential', 'firstLastPiece', 'deleteFiles',
      'continueOnError', 'includeUnsupported', 'directOnly', 'dedupe'
    ].includes(name)) {
      options[name] = inlineValue === undefined ? true : toBool(inlineValue, true);
      continue;
    }
    const value = inlineValue !== undefined ? inlineValue : argv[++index];
    if (value === undefined) throw new Error(`Missing value for --${rawName}.`);
    options[name] = value;
  }
  return { options, positionals };
}

function toCamel(value) {
  return String(value || '').replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function helpText() {
  return [
    'ddys-download-bridge',
    '',
    'Usage:',
    '  ddys-download-bridge serve --provider aria2 --base-url http://127.0.0.1:6800/jsonrpc',
    '  ddys-download-bridge doctor --config ./config.json',
    '  ddys-download-bridge search "keyword"',
    '  ddys-download-bridge resources movie-slug --type downloadable',
    '  ddys-download-bridge push movie-slug --target nas --all --dry-run',
    '  ddys-download-bridge add "magnet:?xt=urn:btih:..." --target qb',
    '  ddys-download-bridge tasks',
    '  ddys-download-bridge status TASK_ID',
    '  ddys-download-bridge pause TASK_ID',
    '  ddys-download-bridge resume TASK_ID',
    '  ddys-download-bridge remove TASK_ID --delete-files',
    '',
    'Options:',
    '  --config FILE              JSON config file',
    '  --api-base URL             DDYS API base URL',
    '  --api-key TOKEN            DDYS API token',
    '  --target NAME              target name from config',
    '  --provider NAME            qbittorrent, aria2, transmission, synology',
    '  --base-url URL             downloader API URL',
    '  --username USER            downloader username',
    '  --password PASS            downloader password',
    '  --secret TOKEN             aria2 RPC secret',
    '  --save-path PATH           download directory',
    '  --category NAME            downloader category',
    '  --tags LIST                comma-separated tags or labels',
    '  --paused                   add as paused',
    '  --sequential               sequential download where supported',
    '  --type TYPE                downloadable, all, magnet, torrent, http, direct, ed2k',
    '  --index N                  resource index from resources output',
    '  --all                      push all matching resources',
    '  --dry-run                  only print tasks',
    '  --auth-token TOKEN         local HTTP API bearer token',
    '  --webhook-url URL          webhook notification endpoint'
  ].join('\n');
}
