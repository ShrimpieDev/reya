# Reya Wallet Dashboard

A lightweight front-end dashboard for entering any EVM wallet address and viewing:

- account value breakdown (`rUSD` + `srUSD`)
- margin usage and liquidation risk meter
- unrealized/live PnL
- open positions table
- trade history and realized PnL summary
- market intel feed
- spot market board
- daredevil risk panel

## Run locally

Because this is a static app, any local HTTP server works:

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

## Notes

- The dashboard layout and styling are inspired by the provided screenshot.
- A hook is included for real Reya endpoints, but this environment did not provide a reachable public API URL from docs, so deterministic mock wallet data is used as fallback.
