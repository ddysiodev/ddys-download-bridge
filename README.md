# ddys-download-bridge

把 DDYS 资源推送到 qBittorrent、aria2、Transmission、群晖 Download Station 的下载桥接服务。

它可以作为命令行工具使用，也可以启动本地 HTTP API，给桌面端、TVBox、STRM、脚本或自动化平台调用。

## 支持能力

- DDYS 搜索、最新、热门、详情资源读取
- 磁力、`.torrent`、HTTP/HTTPS、直链媒体、ed2k 识别，并按下载器能力自动过滤
- qBittorrent Web API 推送、列表、状态、暂停、继续、删除
- aria2 JSON-RPC 推送、列表、状态、暂停、继续、删除
- Transmission RPC 推送、列表、状态、暂停、继续、删除
- Synology Download Station 任务创建、列表、状态、暂停、继续、删除
- 保存路径、分类、标签、暂停添加、顺序下载等任务选项
- 按影片 slug 批量推送剧集或资源
- dry-run 预览、Bearer 鉴权、本地 HTTP API、Webhook 通知
- Docker / docker-compose 运行示例

## 命令行

```powershell
node cli/ddys-download-bridge.mjs search "电影名"
node cli/ddys-download-bridge.mjs resources movie-slug --type downloadable
node cli/ddys-download-bridge.mjs push movie-slug --all --dry-run
node cli/ddys-download-bridge.mjs add "magnet:?xt=urn:btih:..." --provider aria2
node cli/ddys-download-bridge.mjs tasks
node cli/ddys-download-bridge.mjs status TASK_ID
```

## aria2

```powershell
node cli/ddys-download-bridge.mjs add "magnet:?xt=urn:btih:..." `
  --provider aria2 `
  --base-url http://127.0.0.1:6800/jsonrpc `
  --secret YOUR_RPC_SECRET `
  --save-path D:\Downloads\DDYS
```

## qBittorrent

```powershell
node cli/ddys-download-bridge.mjs push movie-slug `
  --provider qbittorrent `
  --base-url http://127.0.0.1:8080 `
  --username admin `
  --password adminadmin `
  --category ddys `
  --tags ddys,auto
```

## Transmission

```powershell
node cli/ddys-download-bridge.mjs add "https://example.com/file.torrent" `
  --provider transmission `
  --base-url http://127.0.0.1:9091/transmission/rpc `
  --username transmission `
  --password secret `
  --save-path /downloads/ddys
```

## 群晖 Download Station

```powershell
node cli/ddys-download-bridge.mjs push movie-slug `
  --provider synology `
  --base-url http://nas.local:5000/webapi `
  --username admin `
  --password secret `
  --save-path video/ddys
```

## 配置文件

```powershell
node cli/ddys-download-bridge.mjs doctor --config examples/config.example.json
node cli/ddys-download-bridge.mjs serve --config examples/config.example.json
```

配置文件可以定义多个目标：

```json
{
  "target": "aria2",
  "targets": {
    "aria2": {
      "provider": "aria2",
      "baseUrl": "http://127.0.0.1:6800/jsonrpc",
      "secret": "",
      "savePath": "/downloads/ddys",
      "tags": ["ddys"]
    },
    "qb": {
      "provider": "qbittorrent",
      "baseUrl": "http://127.0.0.1:8080",
      "username": "admin",
      "password": "adminadmin",
      "category": "ddys",
      "tags": ["ddys"]
    }
  }
}
```

## HTTP API

```powershell
node cli/ddys-download-bridge.mjs serve --host 0.0.0.0 --port 8788 --auth-token TOKEN
```

常用接口：

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

推送 DDYS 详情资源：

```json
{
  "slug": "movie-slug",
  "target": "aria2",
  "all": true,
  "type": "downloadable"
}
```

推送单个链接：

```json
{
  "url": "magnet:?xt=urn:btih:...",
  "target": "qb",
  "category": "ddys",
  "tags": ["ddys", "manual"]
}
```

如果配置了 `DDYS_BRIDGE_TOKEN` 或 `--auth-token`，请求需要：

```text
Authorization: Bearer TOKEN
```

## 环境变量

```text
DDYS_API_BASE=https://ddys.io/api/v1
DDYS_API_KEY=
DDYS_DOWNLOAD_PROVIDER=aria2
DDYS_DOWNLOAD_BASE_URL=http://127.0.0.1:6800/jsonrpc
DDYS_ARIA2_SECRET=
DDYS_DOWNLOAD_SAVE_PATH=
DDYS_DOWNLOAD_CATEGORY=ddys
DDYS_DOWNLOAD_TAGS=ddys
DDYS_BRIDGE_TOKEN=
DDYS_WEBHOOK_URL=
DDYS_WEBHOOK_SECRET=
```

## Webhook

配置 `DDYS_WEBHOOK_URL` 后，添加、批量推送、暂停、继续、删除都会发送 JSON 通知。

如果设置 `DDYS_WEBHOOK_SECRET`，请求头会带：

```text
X-DDYS-Signature: sha256=<hmac>
```
