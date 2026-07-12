import { DEFAULTS, normalizeOptions } from './config.mjs';
import { normalizeResource } from './resources.mjs';

const cache = new Map();

export function createDdysClient(options = {}, runtime = {}) {
  const settings = normalizeOptions(options);
  const fetchImpl = runtime.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is required.');

  async function latest(limit = settings.homeLimit, signal) {
    const root = await getJson('/latest', { limit: String(clamp(limit, settings.homeLimit, 1, 100)) }, signal);
    return readMovieList(root, settings);
  }

  async function hot(limit = settings.homeLimit, signal) {
    const root = await getJson('/hot', { limit: String(clamp(limit, settings.homeLimit, 1, 100)) }, signal);
    return readMovieList(root, settings);
  }

  async function movies(mediaType = 'movie', page = 1, perPage = settings.pageSize, signal) {
    const root = await getJson('/movies', {
      type: mediaType || 'movie',
      page: String(Math.max(1, Number(page) || 1)),
      per_page: String(clamp(perPage, settings.pageSize, 1, 100))
    }, signal);
    return readPagedMovies(root, settings);
  }

  async function search(query, page = 1, perPage = settings.pageSize, signal) {
    const text = String(query || '').trim();
    if (!text) return emptyPage(settings);
    const root = await getJson('/search', {
      q: text,
      page: String(Math.max(1, Number(page) || 1)),
      per_page: String(clamp(perPage, settings.pageSize, 1, 100))
    }, signal);
    return readPagedMovies(root, settings);
  }

  async function detailBundle(slug, signal) {
    const encodedSlug = encodeURIComponent(String(slug || '').trim());
    if (!encodedSlug) throw new Error('Movie slug is required.');
    const detailRoot = await getJson(`/movies/${encodedSlug}`, null, signal);
    const sourcesRoot = await getJsonOrFallback(`/movies/${encodedSlug}/sources`, signal);
    const relatedRoot = await getJsonOrFallback(`/movies/${encodedSlug}/related`, signal);
    const movie = readMovie(unwrapData(detailRoot), settings);
    return {
      movie,
      sourceGroups: readSourceGroups(unwrapData(sourcesRoot), movie),
      related: readRelated(unwrapData(relatedRoot), settings)
    };
  }

  async function diagnostics(signal) {
    const sample = await latest(1, signal);
    return {
      ok: true,
      apiBase: settings.apiBase,
      siteBase: settings.siteBase,
      apiKeyConfigured: Boolean(settings.apiKey),
      sampleCount: sample.length,
      cacheEnabled: settings.enableCache,
      cacheMinutes: settings.cacheMinutes
    };
  }

  async function getJsonOrFallback(path, signal) {
    try {
      return await getJson(path, null, signal);
    } catch {
      return {};
    }
  }

  async function getJson(path, query, signal) {
    const url = buildUrl(settings.apiBase, path, query);
    const cacheKey = `${url}|auth:${settings.apiKey ? '1' : '0'}`;
    if (settings.enableCache && cache.has(cacheKey)) {
      const entry = cache.get(cacheKey);
      if (entry.expiresAt > Date.now()) return cloneJson(entry.value);
      cache.delete(cacheKey);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('DDYS API request timed out.')), settings.timeoutSeconds * 1000);
    const abort = () => controller.abort(signal.reason);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', abort, { once: true });
    }

    try {
      const headers = {
        accept: 'application/json',
        'user-agent': settings.userAgent
      };
      if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
      const response = await fetchImpl(url, { headers, signal: controller.signal });
      const text = stripBom(await response.text());
      let root;
      try {
        root = JSON.parse(text || '{}');
      } catch (error) {
        throw new Error(`DDYS API returned non-JSON response: HTTP ${response.status}`, { cause: error });
      }
      if (!response.ok || isEnvelopeFailure(root)) {
        throw new Error(readMessage(root) || `DDYS API HTTP ${response.status}`);
      }
      if (settings.enableCache) {
        cache.set(cacheKey, { value: cloneJson(root), expiresAt: Date.now() + settings.cacheMinutes * 60 * 1000 });
      }
      return root;
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', abort);
    }
  }

  return { options: settings, latest, hot, movies, search, detailBundle, diagnostics };
}

export function clearDdysCache() {
  cache.clear();
}

export function readMovie(element, settings = DEFAULTS) {
  if (!element || typeof element !== 'object' || Array.isArray(element)) return emptyMovie();
  const slug = firstString(element, 'slug', 'vod_id', 'id', 'key', 'code', 'video_id');
  const title = firstString(element, 'title', 'name', 'vod_name', 'title_cn') || slug;
  const category = toStringList(firstValue(element, 'category', 'vod_class', 'genre', 'genres', 'tags'));
  return {
    slug,
    title,
    poster: absoluteUrl(firstString(element, 'poster', 'pic', 'cover', 'vod_pic', 'image', 'thumbnail'), settings.siteBase),
    fanart: absoluteUrl(firstString(element, 'fanart', 'backdrop', 'background', 'vod_pic_slide'), settings.siteBase),
    year: firstString(element, 'year', 'release_year', 'vod_year', 'date', 'release_date'),
    region: joinValues(firstValue(element, 'region', 'area', 'vod_area')),
    typeName: joinValues(firstValue(element, 'type_name', 'type', 'category', 'vod_class')),
    actor: joinValues(firstValue(element, 'actor', 'actors', 'cast', 'vod_actor')),
    director: joinValues(firstValue(element, 'director', 'directors', 'vod_director')),
    overview: firstString(element, 'intro', 'description', 'summary', 'content', 'vod_content'),
    remarks: joinValues(firstValue(element, 'remarks', 'vod_remarks', 'episode', 'episode_text', 'score', 'year')),
    url: absoluteUrl(firstNonEmpty(firstString(element, 'url', 'link', 'href'), slug ? `/movie/${slug}` : ''), settings.siteBase),
    date: firstString(element, 'date', 'pubdate', 'updated_at', 'update_time', 'vod_time', 'created_at'),
    score: readFloat(firstValue(element, 'score', 'rating', 'rate', 'vod_score')),
    tags: category
  };
}

export function readSourceGroups(data, movie = {}) {
  const groups = [];
  if (Array.isArray(data)) {
    addGroup(groups, 'Online', data, movie);
    return groups;
  }
  if (!data || typeof data !== 'object') return groups;
  addGroup(groups, 'Online', collectArrays(data, 'online', 'play', 'playlist', 'episodes', 'items', 'resources', 'urls', 'links', 'list'), movie);
  addGroup(groups, 'Download', collectArrays(data, 'download', 'downloads', 'down'), movie);
  addGroup(groups, 'Cloud Drive', collectArrays(data, 'cloud', 'netdisk', 'drive', 'shares'), movie);
  addGroup(groups, 'Magnet', collectArrays(data, 'magnet', 'magnets', 'bt'), movie);
  const used = new Set(['online', 'play', 'playlist', 'episodes', 'items', 'resources', 'urls', 'links', 'list', 'download', 'downloads', 'down', 'cloud', 'netdisk', 'drive', 'shares', 'magnet', 'magnets', 'bt']);
  for (const [key, value] of Object.entries(data)) {
    if (!used.has(key.toLowerCase()) && Array.isArray(value)) addGroup(groups, readableGroupName(key), value, movie);
  }
  return groups.filter((group) => group.items.length > 0);
}

function readMovieList(root, settings) {
  const data = arrayData(unwrapData(root), 'items', 'results', 'movies', 'records', 'list', 'data');
  if (!Array.isArray(data)) return [];
  return data.map((item) => readMovie(item, settings)).filter((item) => item.slug && item.title);
}

function readPagedMovies(root, settings) {
  const data = arrayData(unwrapData(root), 'items', 'results', 'movies', 'records', 'list', 'data');
  const movies = Array.isArray(data) ? readMovieList(root, settings) : [];
  const meta = root && typeof root === 'object' ? root.meta || root.pagination || {} : {};
  return {
    data: movies,
    total: readInt(meta, movies.length, 'total', 'count'),
    page: readInt(meta, 1, 'page', 'current_page'),
    perPage: readInt(meta, movies.length || settings.pageSize, 'per_page', 'perPage', 'limit'),
    totalPages: readInt(meta, 1, 'total_pages', 'last_page', 'totalPages')
  };
}

function readRelated(data, settings) {
  const movies = [];
  if (Array.isArray(data)) movies.push(...data.map((item) => readMovie(item, settings)));
  else if (data && typeof data === 'object') movies.push(...collectArrays(data, 'series', 'related', 'items').map((item) => readMovie(item, settings)));
  const seen = new Set();
  return movies.filter((item) => item.slug && item.title).filter((item) => {
    if (seen.has(item.slug)) return false;
    seen.add(item.slug);
    return true;
  });
}

function addGroup(groups, name, elements, movie) {
  const directItems = [];
  for (const [index, element] of Array.from(elements || []).entries()) {
    if (isNestedResourceGroup(element)) {
      for (const [nestedName, nestedItems] of nestedResourceArrays(element)) {
        addGroup(groups, nestedName || name, nestedItems, movie);
      }
      continue;
    }
    const item = normalizeResource(element, {
      slug: movie.slug,
      title: movie.title,
      groupName: name,
      index
    });
    if (item.url) directItems.push(item);
  }
  if (directItems.length > 0) groups.push({ name, items: directItems });
}

function buildUrl(base, path, query) {
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  return url;
}

function unwrapData(root) {
  return root && typeof root === 'object' && !Array.isArray(root) && Object.hasOwn(root, 'data') ? root.data : root;
}

function isEnvelopeFailure(root) {
  return root && typeof root === 'object' && (root.success === false || root.code >= 400 || root.error);
}

function readMessage(root) {
  if (!root || typeof root !== 'object') return '';
  return firstString(root, 'message', 'msg', 'error', 'detail');
}

function emptyPage(settings) {
  return { data: [], total: 0, page: 1, perPage: settings.pageSize, totalPages: 1 };
}

function emptyMovie() {
  return { slug: '', title: '', poster: '', fanart: '', year: '', region: '', typeName: '', actor: '', director: '', overview: '', remarks: '', url: '', date: '', score: 0, tags: [] };
}

function firstString(element, ...keys) {
  const value = firstValue(element, ...keys);
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join(', ');
  return String(value).trim();
}

function firstValue(element, ...keys) {
  if (!element || typeof element !== 'object') return undefined;
  for (const key of keys) {
    if (Object.hasOwn(element, key)) return element[key];
    const lower = key.toLowerCase();
    for (const [entryKey, value] of Object.entries(element)) {
      if (entryKey.toLowerCase() === lower) return value;
    }
  }
  return undefined;
}

function firstNonEmpty(...values) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function toStringList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || '').split(/[,/|，、\s]+/u).map((item) => item.trim()).filter(Boolean);
}

function joinValues(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join(', ');
  return String(value || '').trim();
}

function collectArrays(element, ...keys) {
  const out = [];
  for (const key of keys) {
    const value = firstValue(element, key);
    if (Array.isArray(value)) out.push(...value);
  }
  return out;
}

function arrayData(value, ...keys) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) {
    const nested = firstValue(value, key);
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function isNestedResourceGroup(element) {
  if (!element || typeof element !== 'object' || Array.isArray(element)) return false;
  if (firstString(element, 'url', 'link', 'href', 'src', 'value', 'file', 'path', 'play_url', 'download_url', 'magnet', 'ed2k')) return false;
  return nestedResourceArrays(element).length > 0;
}

function nestedResourceArrays(element) {
  const names = ['items', 'resources', 'episodes', 'list', 'urls', 'links', 'playlist', 'play', 'online', 'download', 'downloads', 'magnets', 'magnet', 'cloud', 'netdisk', 'drive'];
  const out = [];
  for (const name of names) {
    const value = firstValue(element, name);
    if (Array.isArray(value)) {
      const groupName = firstString(element, 'name', 'title', 'label', 'source', 'line', 'group') || readableGroupName(name);
      out.push([groupName, value]);
    }
  }
  return out;
}

function readableGroupName(key) {
  return String(key || 'Source').replace(/[_-]+/gu, ' ').replace(/\b\w/gu, (char) => char.toUpperCase());
}

function absoluteUrl(value, base) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return new URL(text, base).toString();
  } catch {
    return text;
  }
}

function readFloat(value) {
  const number = Number.parseFloat(String(value || '').replace(/[^\d.]+/gu, ''));
  return Number.isFinite(number) ? number : 0;
}

function readInt(element, fallback, ...keys) {
  const number = Number.parseInt(String(firstValue(element, ...keys) ?? ''), 10);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, fallback, min, max) {
  const number = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stripBom(value) {
  return String(value || '').replace(/^\uFEFF/u, '');
}
