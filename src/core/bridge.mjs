import { createDownloadAdapter } from '../adapters/index.mjs';
import { createDdysClient } from './client.mjs';
import { describePublicOptions, normalizeOptions } from './config.mjs';
import { createDownloadTask, filterResources, flattenSourceGroups, normalizeResource, providerSupportsType } from './resources.mjs';
import { sendWebhook } from './notify.mjs';

export function createDownloadBridge(options = {}, runtime = {}) {
  const settings = normalizeOptions(options);
  const ddys = createDdysClient(settings, runtime);
  const adapters = new Map();

  function getTarget(name = settings.target) {
    const target = settings.targets[name] || settings.targets[settings.target];
    if (!target) throw new Error(`Unknown download target: ${name}`);
    return target;
  }

  function getAdapter(name = settings.target) {
    const target = getTarget(name);
    if (!adapters.has(target.name)) adapters.set(target.name, createDownloadAdapter(target, runtime));
    return adapters.get(target.name);
  }

  async function search(query, opts = {}, signal) {
    return ddys.search(query, opts.page, opts.perPage, signal);
  }

  async function latest(limit = settings.homeLimit, signal) {
    return ddys.latest(limit, signal);
  }

  async function hot(limit = settings.homeLimit, signal) {
    return ddys.hot(limit, signal);
  }

  async function resources(slug, opts = {}, signal) {
    const target = getTarget(opts.target || settings.target);
    const bundle = await ddys.detailBundle(slug, signal);
    const flattened = flattenSourceGroups(bundle.sourceGroups, bundle.movie).map((resource, index) => ({
      ...resource,
      index,
      supported: providerSupportsType(target.provider, resource.type)
    }));
    const filtered = filterResources(flattened, {
      provider: target.provider,
      type: opts.type || opts.resourceType || settings.defaultResourceType,
      indexes: opts.indexes ?? opts.index,
      limit: opts.limit,
      includeUnsupported: opts.includeUnsupported ?? settings.includeUnsupported,
      directOnly: opts.directOnly ?? settings.directOnly,
      dedupe: opts.dedupe ?? settings.dedupe
    });
    return { movie: bundle.movie, resources: filtered, allResources: flattened, target: publicTarget(target) };
  }

  async function addUrl(url, opts = {}, signal) {
    const target = getTarget(opts.target || settings.target);
    const resource = normalizeResource({ url, name: opts.name });
    resource.supported = providerSupportsType(target.provider, resource.type);
    if (!resource.supported && !opts.includeUnsupported && !settings.includeUnsupported) {
      throw new Error(`${target.provider} does not support ${resource.type || 'this'} resource: ${resource.url}`);
    }
    const task = createDownloadTask(resource, target, opts);
    if (opts.dryRun) return { ok: true, dryRun: true, target: publicTarget(target), tasks: [task] };
    const adapter = getAdapter(target.name);
    const result = await adapter.add(task, signal);
    await notify('download.added', { target: publicTarget(target), resource, result });
    return { ok: true, target: publicTarget(target), resource, result };
  }

  async function push(slug, opts = {}, signal) {
    const target = getTarget(opts.target || settings.target);
    const plan = await resources(slug, { ...opts, target: target.name }, signal);
    const selected = opts.all ? plan.resources : plan.resources.slice(0, Number(opts.limit || 1));
    if (selected.length === 0) {
      return { ok: false, target: publicTarget(target), movie: plan.movie, added: [], skipped: plan.allResources.length, message: 'No matching downloadable resources.' };
    }
    const tasks = selected.map((resource) => createDownloadTask(resource, target, opts));
    if (opts.dryRun) return { ok: true, dryRun: true, target: publicTarget(target), movie: plan.movie, tasks, resources: selected };
    const adapter = getAdapter(target.name);
    const added = [];
    const errors = [];
    for (const [index, task] of tasks.entries()) {
      try {
        const result = await adapter.add(task, signal);
        added.push({ resource: selected[index], result });
      } catch (error) {
        errors.push({ resource: selected[index], error: error.message || String(error) });
        if (!opts.continueOnError) break;
      }
    }
    const response = { ok: errors.length === 0, target: publicTarget(target), movie: plan.movie, added, errors };
    await notify('download.batch', response);
    return response;
  }

  async function list(opts = {}, signal) {
    const target = getTarget(opts.target || settings.target);
    return { ok: true, target: publicTarget(target), tasks: await getAdapter(target.name).list(signal) };
  }

  async function status(id, opts = {}, signal) {
    const target = getTarget(opts.target || settings.target);
    return { ok: true, target: publicTarget(target), task: await getAdapter(target.name).status(id, signal) };
  }

  async function pause(ids, opts = {}, signal) {
    const target = getTarget(opts.target || settings.target);
    const result = await getAdapter(target.name).pause(ids, signal);
    await notify('download.paused', { target: publicTarget(target), ids });
    return result;
  }

  async function resume(ids, opts = {}, signal) {
    const target = getTarget(opts.target || settings.target);
    const result = await getAdapter(target.name).resume(ids, signal);
    await notify('download.resumed', { target: publicTarget(target), ids });
    return result;
  }

  async function remove(ids, opts = {}, signal) {
    const target = getTarget(opts.target || settings.target);
    const result = await getAdapter(target.name).remove(ids, opts, signal);
    await notify('download.removed', { target: publicTarget(target), ids, deleteFiles: Boolean(opts.deleteFiles) });
    return result;
  }

  async function diagnostics(signal) {
    const targetResults = [];
    for (const target of Object.values(settings.targets)) {
      try {
        targetResults.push(await getAdapter(target.name).diagnostics(signal));
      } catch (error) {
        targetResults.push({ ok: false, provider: target.provider, target: target.name, error: error.message || String(error) });
      }
    }
    let ddysResult;
    try {
      ddysResult = await ddys.diagnostics(signal);
    } catch (error) {
      ddysResult = { ok: false, error: error.message || String(error) };
    }
    return {
      ok: Boolean(ddysResult.ok) && targetResults.every((item) => item.ok),
      ddys: ddysResult,
      bridge: describePublicOptions(settings),
      targets: targetResults
    };
  }

  async function notify(event, payload) {
    try {
      return await sendWebhook(settings, event, payload, runtime);
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  }

  return {
    settings,
    ddys,
    getTarget,
    getAdapter,
    search,
    latest,
    hot,
    resources,
    addUrl,
    push,
    list,
    status,
    pause,
    resume,
    remove,
    diagnostics
  };
}

function publicTarget(target) {
  return {
    name: target.name,
    provider: target.provider,
    baseUrl: target.baseUrl,
    savePath: target.savePath,
    category: target.category,
    tags: target.tags,
    paused: target.paused
  };
}
