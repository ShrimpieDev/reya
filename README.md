# Reya Wallet Dashboard (Live)

This is a live-only Reya dashboard (no demo fallback).

## Features
- live wallet positions from Reya WebSocket v2
- live wallet perp executions (trade feed)
- live market summaries and prices
- automatic reconnect + endpoint fallback
- REST snapshot backfill for positions/trades/prices (when available)
- GitHub Pages deployable static site

## Run locally

```bash
python3 -m http.server 4173