# Reya Wallet Dashboard

A wallet dashboard UI inspired by the Reya trading layout, with support for:

- account value / margin usage / unrealized PnL / staked srUSD
- live-updating positions table
- trade history + realized PnL summary
- market intel, spot board, and risk meter
- wallet input for any EVM address

## Run locally

```bash
python3 -m http.server 4173
```

Open <http://localhost:4173>.

## Publish as a live website on GitHub Pages

This repo includes `.github/workflows/deploy-pages.yml` and is ready to deploy.

### 1) Push to GitHub

Push this branch to your repository:

```bash
git push origin work
```

(Workflow also listens on `main` and `master`.)

### 2) Enable Pages with GitHub Actions

In your GitHub repo:

- **Settings** → **Pages**
- Under **Build and deployment**, set **Source** to **GitHub Actions**

### 3) Wait for deployment

- Open **Actions** tab
- Wait for **Deploy static dashboard to GitHub Pages** to pass

### 4) Open your live site

Your URL will be:

- Project site: `https://<your-username>.github.io/<repo-name>/`
- User site repo (`<your-username>.github.io`): `https://<your-username>.github.io/`

## API integration

By default, the dashboard runs in demo mode (deterministic mock data).

To connect real endpoints, open the app and fill the **API settings** section with URLs that include `{wallet}` placeholders, for example:

- `https://api.example.com/wallet/{wallet}/overview`
- `https://api.example.com/wallet/{wallet}/positions`
- `https://api.example.com/wallet/{wallet}/trades`

The settings are stored in browser localStorage.
