export interface DownloadTarget {
  name?: string;
  provider: 'qbittorrent' | 'aria2' | 'transmission' | 'synology';
  baseUrl?: string;
  username?: string;
  password?: string;
  secret?: string;
  token?: string;
  savePath?: string;
  category?: string;
  tags?: string[] | string;
  paused?: boolean;
  sequential?: boolean;
  firstLastPiece?: boolean;
  deleteFiles?: boolean;
}

export interface BridgeOptions {
  apiBase?: string;
  siteBase?: string;
  apiKey?: string;
  target?: string;
  targets?: Record<string, DownloadTarget>;
  authToken?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  directOnly?: boolean;
  includeUnsupported?: boolean;
}

export interface DownloadResource {
  id: string;
  name: string;
  url: string;
  type: 'magnet' | 'torrent' | 'direct' | 'http' | 'ed2k' | 'cloud' | 'unsupported';
  supported: boolean;
}

export function createDownloadBridge(options?: BridgeOptions, runtime?: { fetch?: typeof fetch }): unknown;
export function createDdysClient(options?: BridgeOptions, runtime?: { fetch?: typeof fetch }): unknown;
export function normalizeOptions(options?: BridgeOptions): BridgeOptions;
export function optionsFromEnv(env?: Record<string, string | undefined>): BridgeOptions;
export function classifyResource(url: string): DownloadResource['type'];
export function providerSupportsType(provider: string, type: string): boolean;
export const VERSION: string;
