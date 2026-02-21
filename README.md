# Reya Wallet Dashboard

A live wallet dashboard UI inspired by the Reya trading layout, with:

- auto WebSocket connection to Reya DEX V2
- live wallet positions stream
- live wallet execution stream (trade history panel)
- live market summary and prices streams
- risk, margin, and exposure estimates from streaming data

## Run locally

```bash
python3 -m http.server 4173
```

Open <http://localhost:4173>.

## How live API is now handled automatically

When you enter a wallet and click **Load Wallet**, the app automatically connects to Reya WebSocket V2 and subscribes to:

- `/v2/wallet/{address}/positions`
- `/v2/wallet/{address}/perpExecutions`
- `/v2/prices`
- `/v2/markets/summary`

Primary endpoint: `wss://ws.reya.xyz`  
Fallback endpoint: `wss://websocket-testnet.reya.xyz`

The app handles heartbeat ping/pong automatically and reconnects with backoff if disconnected.

## Publish as a live website on GitHub Pages

1. Push to GitHub.
2. In **Settings → Pages**, set source to **GitHub Actions**.
3. Wait for **Deploy static dashboard to GitHub Pages** workflow.
4. Open: `https://<your-username>.github.io/<repo-name>/`
