import { normalizeResourceType } from './config.mjs';

const directMediaPattern = /\.(m3u8|mp4|m4v|mkv|mov|flv|avi|ts|webm|mpd|iso)(\?|#|$)/iu;
const torrentPattern = /\.torrent(\?|#|$)/iu;
const cloudDomainPattern = /(pan\.|drive\.|cloud\.|aliyundrive|alipan|quark|uc\.cn|baidu|115\.com|123pan|pikpak|terabox|onedrive|sharepoint|google\.com\/drive)/iu;

export function classifyResource(url) {
  const text = String(url || '').trim();
  const lower = text.toLowerCase();
  if (!text) return 'unsupported';
  if (lower.startsWith('magnet:?')) return 'magnet';
  if (lower.startsWith('ed2k://')) return 'ed2k';
  if (lower.startsWith('torrent:') || torrentPattern.test(lower)) return 'torrent';
  if (directMediaPattern.test(lower)) return 'direct';
  if (/^https?:\/\//iu.test(lower)) {
    if (cloudDomainPattern.test(lower)) return 'cloud';
    return 'http';
  }
  if (/^ftp:\/\//iu.test(lower)) return 'http';
  return 'unsupported';
}

export function isDownloadable(resource, provider = '') {
  const type = typeof resource === 'string' ? classifyResource(resource) : resource.type;
  return providerSupportsType(provider, type);
}

export function providerSupportsType(provider, type) {
  const name = String(provider || '').toLowerCase();
  if (!type || type === 'unsupported' || type === 'cloud') return false;
  if (name === 'aria2') return ['magnet', 'torrent', 'direct', 'http', 'ed2k'].includes(type);
  if (name === 'synology') return ['magnet', 'torrent', 'direct', 'http', 'ed2k'].includes(type);
  if (name === 'qbittorrent') return ['magnet', 'torrent'].includes(type);
  if (name === 'transmission') return ['magnet', 'torrent'].includes(type);
  return ['magnet', 'torrent', 'direct', 'http'].includes(type);
}

export function normalizeResource(resource, context = {}) {
  if (typeof resource === 'string') {
    return normalizeResource({ url: resource }, context);
  }
  const input = resource && typeof resource === 'object' ? resource : {};
  const url = firstString(input, 'url', 'link', 'href', 'play_url', 'download_url', 'magnet', 'ed2k');
  const type = classifyResource(url);
  const name = firstString(input, 'name', 'title', 'label', 'episode', 'quality', 'format') || context.title || 'DDYS resource';
  const headers = normalizeHeaders(input.headers || input.header || context.headers);
  return {
    id: firstString(input, 'id', 'hash', 'gid') || stableId(`${context.slug || ''}|${context.groupName || ''}|${name}|${url}`),
    name,
    url,
    type,
    groupName: context.groupName || firstString(input, 'groupName', 'source', 'line'),
    movieSlug: context.slug || firstString(input, 'movieSlug', 'slug'),
    movieTitle: context.title || firstString(input, 'movieTitle', 'title'),
    index: Number.isInteger(context.index) ? context.index : Number(input.index || 0),
    supported: true,
    headers
  };
}

export function flattenSourceGroups(sourceGroups = [], movie = {}) {
  const resources = [];
  for (const [groupIndex, group] of (sourceGroups || []).entries()) {
    const groupName = group.name || `Group ${groupIndex + 1}`;
    for (const [itemIndex, item] of (group.items || []).entries()) {
      resources.push(normalizeResource(item, {
        slug: movie.slug,
        title: movie.title,
        groupName,
        index: resources.length,
        itemIndex
      }));
    }
  }
  return resources;
}

export function filterResources(resources = [], options = {}) {
  const provider = options.provider || '';
  const requestedType = normalizeResourceType(options.type || options.resourceType || 'downloadable');
  const indexes = normalizeIndexes(options.indexes ?? options.index);
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 0;
  const includeUnsupported = Boolean(options.includeUnsupported);
  const directOnly = Boolean(options.directOnly);
  const dedupe = options.dedupe !== false;
  const seen = new Set();
  const out = [];

  for (const resource of resources.map((item) => normalizeResource(item))) {
    resource.supported = providerSupportsType(provider, resource.type);
    if (indexes.size > 0 && !indexes.has(resource.index)) continue;
    if (directOnly && resource.type !== 'direct') continue;
    if (!matchesType(resource, requestedType, provider)) continue;
    if (!includeUnsupported && !resource.supported) continue;
    if (dedupe) {
      const key = resource.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(resource);
    if (limit && out.length >= limit) break;
  }
  return out;
}

export function createDownloadTask(resource, target, options = {}) {
  const normalized = normalizeResource(resource);
  return {
    name: options.name || normalized.name,
    url: normalized.url,
    type: normalized.type,
    provider: target.provider,
    target: target.name,
    savePath: options.savePath || target.savePath,
    category: options.category || target.category,
    tags: options.tags || target.tags,
    paused: options.paused ?? target.paused,
    sequential: options.sequential ?? target.sequential,
    firstLastPiece: options.firstLastPiece ?? target.firstLastPiece,
    headers: { ...normalized.headers, ...(options.headers || {}) },
    meta: {
      movieSlug: normalized.movieSlug,
      movieTitle: normalized.movieTitle,
      groupName: normalized.groupName,
      resourceIndex: normalized.index
    }
  };
}

export function normalizeHeaders(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    const headers = {};
    for (const line of value.split(/\r?\n/u)) {
      const index = line.indexOf(':');
      if (index > 0) headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    return headers;
  }
  if (Array.isArray(value)) {
    return Object.fromEntries(value.map((item) => {
      const [name, ...rest] = String(item).split(':');
      return [name.trim(), rest.join(':').trim()];
    }).filter(([name]) => name));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, String(entry)]).filter(([key]) => key));
  }
  return {};
}

export function normalizeIndexes(value) {
  const out = new Set();
  const values = Array.isArray(value) ? value : String(value ?? '').split(',');
  for (const item of values) {
    const text = String(item).trim();
    if (!text) continue;
    const number = Number.parseInt(text, 10);
    if (Number.isFinite(number) && number >= 0) out.add(number);
  }
  return out;
}

function matchesType(resource, requestedType, provider) {
  if (requestedType === 'all') return true;
  if (requestedType === 'downloadable') return providerSupportsType(provider, resource.type);
  return resource.type === requestedType;
}

function firstString(element, ...keys) {
  for (const key of keys) {
    const value = getProperty(element, key);
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function getProperty(element, key) {
  if (!element || typeof element !== 'object') return undefined;
  if (Object.hasOwn(element, key)) return element[key];
  const lower = key.toLowerCase();
  for (const [entryKey, value] of Object.entries(element)) {
    if (entryKey.toLowerCase() === lower) return value;
  }
  return undefined;
}

function stableId(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `r${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
