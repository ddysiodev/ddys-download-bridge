# API Shapes

The project targets these public downloader APIs:

- qBittorrent Web API: `/api/v2/auth/login`, `/api/v2/torrents/add`, `/api/v2/torrents/info`, `/api/v2/torrents/pause`, `/api/v2/torrents/resume`, `/api/v2/torrents/delete`
- aria2 JSON-RPC: `aria2.addUri`, `aria2.tellActive`, `aria2.tellWaiting`, `aria2.tellStopped`, `aria2.tellStatus`, `aria2.pause`, `aria2.unpause`, `aria2.remove`
- Transmission RPC: `torrent-add`, `torrent-get`, `torrent-stop`, `torrent-start`, `torrent-remove`, with automatic retry for `X-Transmission-Session-Id`
- Synology Download Station: `SYNO.API.Auth` login and `SYNO.DownloadStation.Task` create, list, getinfo, pause, resume, delete

Transmission also has newer underscore method names. The adapter defaults to classic hyphen names and can switch to underscore mode with `transmissionRpcStyle`.
