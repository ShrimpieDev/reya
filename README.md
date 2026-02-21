# Reya Wallet Dashboard (Live)

This is a live-only Reya dashboard (no demo fallback).

Features:
- live wallet positions from Reya WebSocket v2
- live wallet perp executions (trade feed)
- live market summaries and prices
- automatic reconnect + endpoint fallback
- GitHub Pages deployable static site

## Run locally

```bash
python3 -m http.server 4173
```

Open:
- `http://localhost:4173`
- Optional wallet deep-link: `http://localhost:4173/?wallet=0x...`

## Live API channels used automatically

On load (and on wallet submit), the app connects to:
- `wss://ws.reya.xyz`
- fallback: `wss://websocket-testnet.reya.xyz`

Then subscribes to:
- `/v2/wallet/{address}/positions`
- `/v2/wallet/{address}/perpExecutions`
- `/v2/wallet/{address}/orderChanges`
- `/v2/prices`
- `/v2/markets/summary`

It also handles server `ping` with client `pong`.

## Publish live website on GitHub Pages

1. Push repository to GitHub.
2. In **Settings → Pages**, choose **GitHub Actions**.
3. Wait for workflow: **Deploy static dashboard to GitHub Pages**.
4. Open: `https://<your-username>.github.io/<repo-name>/`
