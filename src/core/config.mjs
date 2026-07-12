export const VERSION = '0.1.1';

export const DEFAULTS = Object.freeze({
  apiBase: 'https://ddys.io/api/v1',
  siteBase: 'https://ddys.io',
  userAgent: `ddys-download-bridge/${VERSION}`,
  timeoutSeconds: 20,
  pageSize: 20,
  homeLimit: 20,
  enableCache: true,
  cacheMinutes: 5,
  target: 'default',
  host: '127.0.0.1',
  port: 8788,
  publicBase: 'http://127.0.0.1:8788',
  authToken: '',
  webhookUrl: '',
  webhookSecret: '',
  includeUnsupported: false,
  directOnly: false,
  dedupe: true,
  defaultResourceType: 'downloadable'
});

export const SUPPORTED_PROVIDERS = Object.freeze([
  'qbittorrent',
  'aria2',
  'transmission',
  'synology'
]);

export function optionsFromEnv(env = process.env) {
  const target = {
    name: env.DDYS_DOWNLOAD_TARGET || 'default',
    provider: env.DDYS_DOWNLOAD_PROVIDER,
    baseUrl: env.DDYS_DOWNLOAD_BASE_URL,
    username: env.DDYS_DOWNLOAD_USERNAME,
    password: env.DDYS_DOWNLOAD_PASSWORD,
    secret: env.DDYS_ARIA2_SECRET || env.ARIA2_SECRET,
    token: env.DDYS_DOWNLOAD_TOKEN,
    savePath: env.DDYS_DOWNLOAD_SAVE_PATH,
    category: env.DDYS_DOWNLOAD_CATEGORY,
    tags: env.DDYS_DOWNLOAD_TAGS,
    paused: env.DDYS_DOWNLOAD_PAUSED,
    sequential: env.DDYS_DOWNLOAD_SEQUENTIAL,
    firstLastPiece: env.DDYS_DOWNLOAD_FIRST_LAST_PIECE,
    deleteFiles: env.DDYS_DOWNLOAD_DELETE_FILES,
    synologySession: env.DDYS_SYNOLOGY_SESSION,
    synologyTaskVersion: env.DDYS_SYNOLOGY_TASK_VERSION,
    transmissionRpcStyle: env.DDYS_TRANSMISSION_RPC_STYLE
  };

  return compactObject({
    apiBase: env.DDYS_API_BASE,
    siteBase: env.DDYS_SITE_BASE,
    apiKey: env.DDYS_API_KEY,
    userAgent: env.DDYS_USER_AGENT,
    timeoutSeconds: env.DDYS_TIMEOUT_SECONDS,
    pageSize: env.DDYS_PAGE_SIZE,
    homeLimit: env.DDYS_HOME_LIMIT,
    enableCache: env.DDYS_ENABLE_CACHE,
    cacheMinutes: env.DDYS_CACHE_MINUTES,
    target: target.name,
    targets: target.provider || target.baseUrl ? { [target.name]: compactObject(target) } : undefined,
    host: env.DDYS_BRIDGE_HOST,
    port: env.DDYS_BRIDGE_PORT,
    publicBase: env.DDYS_BRIDGE_PUBLIC_BASE,
    authToken: env.DDYS_BRIDGE_TOKEN,
    webhookUrl: env.DDYS_WEBHOOK_URL,
    webhookSecret: env.DDYS_WEBHOOK_SECRET,
    includeUnsupported: env.DDYS_INCLUDE_UNSUPPORTED,
    directOnly: env.DDYS_DIRECT_ONLY,
    dedupe: env.DDYS_DEDUPE,
    defaultResourceType: env.DDYS_RESOURCE_TYPE
  });
}

export function normalizeOptions(options = {}) {
  const merged = { ...DEFAULTS, ...options };
  const targets = normalizeTargets(merged.targets, merged);
  const targetName = normalizeTargetName(merged.target, targets);
  const settings = {
    apiBase: normalizeBaseUrl(merged.apiBase || DEFAULTS.apiBase),
    siteBase: normalizeBaseUrl(merged.siteBase || DEFAULTS.siteBase),
    apiKey: trim(merged.apiKey),
    userAgent: trim(merged.userAgent) || DEFAULTS.userAgent,
    timeoutSeconds: clampInt(merged.timeoutSeconds, DEFAULTS.timeoutSeconds, 3, 180),
    pageSize: clampInt(merged.pageSize, DEFAULTS.pageSize, 1, 100),
    homeLimit: clampInt(merged.homeLimit, DEFAULTS.homeLimit, 1, 100),
    enableCache: toBool(merged.enableCache, DEFAULTS.enableCache),
    cacheMinutes: clampInt(merged.cacheMinutes, DEFAULTS.cacheMinutes, 0, 1440),
    target: targetName,
    targets,
    host: trim(merged.host) || DEFAULTS.host,
    port: clampInt(merged.port, DEFAULTS.port, 1, 65535),
    publicBase: normalizeBaseUrl(merged.publicBase || DEFAULTS.publicBase),
    authToken: trim(merged.authToken),
    webhookUrl: trim(merged.webhookUrl),
    webhookSecret: trim(merged.webhookSecret),
    includeUnsupported: toBool(merged.includeUnsupported, DEFAULTS.includeUnsupported),
    directOnly: toBool(merged.directOnly, DEFAULTS.directOnly),
    dedupe: toBool(merged.dedupe, DEFAULTS.dedupe),
    defaultResourceType: normalizeResourceType(merged.defaultResourceType || DEFAULTS.defaultResourceType)
  };
  return settings;
}

export function describePublicOptions(settings) {
  const normalized = normalizeOptions(settings);
  const targets = Object.fromEntries(Object.entries(normalized.targets).map(([name, target]) => [name, {
    provider: target.provider,
    baseUrl: target.baseUrl,
    usernameConfigured: Boolean(target.username),
    passwordConfigured: Boolean(target.password),
    secretConfigured: Boolean(target.secret),
    savePath: target.savePath,
    category: target.category,
    tags: target.tags,
    paused: target.paused
  }]));
  return {
    apiBase: normalized.apiBase,
    siteBase: normalized.siteBase,
    apiKeyConfigured: Boolean(normalized.apiKey),
    timeoutSeconds: normalized.timeoutSeconds,
    target: normalized.target,
    targets,
    authEnabled: Boolean(normalized.authToken),
    webhookEnabled: Boolean(normalized.webhookUrl),
    directOnly: normalized.directOnly,
    includeUnsupported: normalized.includeUnsupported
  };
}

export function normalizeTargetName(value, targets) {
  const name = trim(value) || 'default';
  if (targets[name]) return name;
  const first = Object.keys(targets)[0];
  return first || 'default';
}

export function normalizeResourceType(value) {
  const text = trim(value).toLowerCase();
  if (['all', 'downloadable', 'magnet', 'torrent', 'http', 'direct', 'ed2k', 'cloud', 'unsupported'].includes(text)) {
    return text;
  }
  return DEFAULTS.defaultResourceType;
}

export function normalizeTargets(targets, root = {}) {
  const out = {};
  if (targets && typeof targets === 'object' && !Array.isArray(targets)) {
    for (const [name, target] of Object.entries(targets)) {
      const normalized = normalizeTarget({ name, ...target });
      if (normalized) out[name] = normalized;
    }
  }

  if (Object.keys(out).length === 0 && (root.provider || root.baseUrl || root.downloadProvider || root.downloadBaseUrl)) {
    const name = trim(root.target) || 'default';
    const normalized = normalizeTarget({
      name,
      provider: root.provider || root.downloadProvider,
      baseUrl: root.baseUrl || root.downloadBaseUrl,
      username: root.username,
      password: root.password,
      secret: root.secret,
      token: root.token,
      savePath: root.savePath,
      category: root.category,
      tags: root.tags,
      paused: root.paused,
      sequential: root.sequential,
      firstLastPiece: root.firstLastPiece,
      deleteFiles: root.deleteFiles,
      synologySession: root.synologySession,
      synologyTaskVersion: root.synologyTaskVersion,
      transmissionRpcStyle: root.transmissionRpcStyle
    });
    if (normalized) out[name] = normalized;
  }

  if (Object.keys(out).length === 0) {
    out.default = normalizeTarget({
      name: 'default',
      provider: 'aria2',
      baseUrl: 'http://127.0.0.1:6800/jsonrpc'
    });
  }
  return out;
}

export function normalizeTarget(input = {}) {
  const provider = trim(input.provider || input.type).toLowerCase();
  if (!provider) return null;
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported download provider: ${provider}`);
  }
  const baseUrl = normalizeTargetBaseUrl(provider, input.baseUrl || input.url || '');
  return {
    name: trim(input.name) || 'default',
    provider,
    baseUrl,
    username: trim(input.username || input.account),
    password: trim(input.password || input.passwd),
    secret: trim(input.secret),
    token: trim(input.token),
    savePath: trim(input.savePath || input.dir || input.destination),
    category: trim(input.category),
    tags: toList(input.tags),
    paused: toBool(input.paused, false),
    sequential: toBool(input.sequential, false),
    firstLastPiece: toBool(input.firstLastPiece, false),
    deleteFiles: toBool(input.deleteFiles, false),
    synologySession: trim(input.synologySession) || 'DownloadStation',
    synologyTaskVersion: clampInt(input.synologyTaskVersion, 1, 1, 3),
    transmissionRpcStyle: normalizeTransmissionStyle(input.transmissionRpcStyle),
    timeoutSeconds: clampInt(input.timeoutSeconds, 30, 3, 180)
  };
}

export function normalizeTargetBaseUrl(provider, value) {
  const fallback = {
    qbittorrent: 'http://127.0.0.1:8080',
    aria2: 'http://127.0.0.1:6800/jsonrpc',
    transmission: 'http://127.0.0.1:9091/transmission/rpc',
    synology: 'http://127.0.0.1:5000/webapi'
  }[provider];
  const base = normalizeBaseUrl(value || fallback);
  if (provider === 'aria2') return base.endsWith('/jsonrpc') ? base : `${base}/jsonrpc`;
  if (provider === 'transmission') return base.endsWith('/rpc') ? base : `${base}/transmission/rpc`;
  if (provider === 'synology') return base.endsWith('/webapi') ? base : `${base}/webapi`;
  return base;
}

export function normalizeBaseUrl(value) {
  const text = trim(value);
  try {
    const url = new URL(text || 'http://127.0.0.1');
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/u, '');
  } catch {
    throw new Error(`Invalid URL: ${text}`);
  }
}

function normalizeTransmissionStyle(value) {
  const text = trim(value).toLowerCase();
  if (['underscore', 'snake', 'jsonrpc'].includes(text)) return 'underscore';
  if (['hyphen', 'classic', 'legacy'].includes(text)) return 'hyphen';
  return 'auto';
}

export function toList(value) {
  if (Array.isArray(value)) return value.map((item) => trim(item)).filter(Boolean);
  return trim(value).split(',').map((item) => trim(item)).filter(Boolean);
}

export function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

export function clampInt(value, fallback, min, max) {
  const number = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

export function trim(value) {
  return String(value ?? '').trim();
}

function compactObject(value) {
  const out = {};
  for (const [key, entry] of Object.entries(value || {})) {
    if (entry !== undefined && entry !== null && entry !== '') out[key] = entry;
  }
  return out;
}
