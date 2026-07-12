import { createAria2Adapter } from './aria2.mjs';
import { createQbittorrentAdapter } from './qbittorrent.mjs';
import { createSynologyAdapter } from './synology.mjs';
import { createTransmissionAdapter } from './transmission.mjs';

export function createDownloadAdapter(target, runtime = {}) {
  if (!target || !target.provider) throw new Error('Download target is required.');
  if (target.provider === 'aria2') return createAria2Adapter(target, runtime);
  if (target.provider === 'qbittorrent') return createQbittorrentAdapter(target, runtime);
  if (target.provider === 'transmission') return createTransmissionAdapter(target, runtime);
  if (target.provider === 'synology') return createSynologyAdapter(target, runtime);
  throw new Error(`Unsupported download provider: ${target.provider}`);
}

export {
  createAria2Adapter,
  createQbittorrentAdapter,
  createSynologyAdapter,
  createTransmissionAdapter
};
