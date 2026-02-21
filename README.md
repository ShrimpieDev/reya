# Reya Wallet Dashboard (Live)

This is a live-only Reya dashboard (no demo fallback).

Features:
- live wallet positions from Reya WebSocket v2
- live wallet perp executions (trade feed)
- live market summaries and prices
- automatic reconnect + endpoint fallback
- REST snapshot backfill for positions/trades/prices (when available)
- GitHub Pages deployable static site

## Run locally

```bash
python3 -m http.server 4173
```

Open:
- `http://localhost:4173`
- Optional wallet deep-link: `http://localhost:4173/?wallet=0x...`

## Live data flow

On load (and on wallet submit), the app:

1. Normalizes the wallet address to lowercase
2. Tries REST snapshot backfill from:
   - `https://api.reya.xyz`
   - `https://reya.xyz/api`
3. Connects to WebSocket:
   - primary: `wss://ws.reya.xyz`
   - fallback: `wss://websocket-testnet.reya.xyz`
4. Subscribes to:
   - `/v2/wallet/{address}/positions`
   - `/v2/wallet/{address}/perpExecutions`
   - `/v2/wallet/{address}/orderChanges`
   - `/v2/prices`
   - `/v2/markets/summary`

The app responds to server `ping` with client `pong`.

## Publish live website on GitHub Pages

1. Push repository to GitHub.
2. In **Settings → Pages**, choose **GitHub Actions**.
3. Wait for workflow: **Deploy static dashboard to GitHub Pages**.
4. Open: `https://<your-username>.github.io/<repo-name>/`

## If GitHub is not updating automatically

If your site does not refresh after push, usually one of these is missing:

1. The repo contains `.github/workflows/deploy-pages.yml`.
2. In **Settings → Pages**, source is set to **GitHub Actions**.
3. You pushed to an allowed deploy branch: `main` or `master` (feature branches are intentionally blocked to satisfy Pages environment protection rules).
4. In **Actions**, the run **Deploy static dashboard to GitHub Pages** is green.
5. In **Settings → Actions → General**, workflow permissions are set to **Read and write permissions** (required for Pages deploy token).

After the workflow finishes, hard refresh your site (`Ctrl/Cmd + Shift + R`).

### Quick publish commands

```bash
git add .
git commit -m "update dashboard"
git push origin main
```

Note: this coding environment can commit changes, but it cannot push to your GitHub account unless you run `git push` from your side.


6. If GitHub says "This branch had an error being deployed", keep `.nojekyll` in the repo root to bypass Jekyll branch-build failures.

7. If you see **"failed (outdated) deployment"**, that is usually a canceled older run. Open the latest run for the same branch and confirm it succeeded.

8. Manual **Run workflow** from a feature branch can still be rejected by environment protection; deploy from `main` (or `master`) only.
