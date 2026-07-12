# ddys-download-bridge

Download bridge for pushing DDYS resources to qBittorrent, aria2, Transmission, and Synology Download Station.

It can run as a CLI or as a local HTTP API for desktop apps, TV clients, STRM workflows, scripts, and automation services.

## Features

- DDYS search, latest, hot, and detail resource discovery
- Magnet, `.torrent`, HTTP/HTTPS, direct media, and ed2k classification with downloader capability filtering
- qBittorrent Web API adapter
- aria2 JSON-RPC adapter
- Transmission RPC adapter
- Synology Download Station adapter
- Save path, category, labels/tags, paused add, sequential download options
- Batch push by DDYS movie slug
- dry-run previews, Bearer auth, local HTTP API, webhook notifications
- Docker and docker-compose examples

## CLI

```bash
node cli/ddys-download-bridge.mjs search "keyword"
node cli/ddys-download-bridge.mjs resources movie-slug --type downloadable
node cli/ddys-download-bridge.mjs push movie-slug --all --dry-run
node cli/ddys-download-bridge.mjs add "magnet:?xt=urn:btih:..." --provider aria2
node cli/ddys-download-bridge.mjs tasks
node cli/ddys-download-bridge.mjs status TASK_ID
```

## HTTP API

```bash
node cli/ddys-download-bridge.mjs serve --host 0.0.0.0 --port 8788 --auth-token TOKEN
```

Endpoints:

```text
GET  /health
GET  /api/search?q=keyword
GET  /api/latest
GET  /api/hot
GET  /api/movies/{slug}/resources
POST /api/downloads
GET  /api/tasks
GET  /api/tasks/{id}/status
POST /api/tasks/{id}/pause
POST /api/tasks/{id}/resume
POST /api/tasks/{id}/remove
```

Batch push:

```json
{
  "slug": "movie-slug",
  "target": "aria2",
  "all": true,
  "type": "downloadable"
}
```

Direct URL push:

```json
{
  "url": "magnet:?xt=urn:btih:...",
  "target": "qb",
  "category": "ddys",
  "tags": ["ddys", "manual"]
}
```
