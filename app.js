const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = "reya-dashboard-api-settings";

const state = {
  wallet: "",
  positions: [],
  trades: [],
  account: { rUsd: 0, srUsd: 0, srUsdPrice: 1.0463, marginUsage: 0 },
  spot: [],
  intel: [],
  timer: null,
  endpoints: { overview: "", positions: "", trades: "" },
};

const formatUsd = (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
const formatNum = (v, d = 3) => Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const hashSeed = (a) => [...a.toLowerCase()].reduce((x, c) => x + c.charCodeAt(0), 0) || 42;

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    state.endpoints = {
      overview: saved.overview || "",
      positions: saved.positions || "",
      trades: saved.trades || "",
    };
    $("overviewEndpoint").value = state.endpoints.overview;
    $("positionsEndpoint").value = state.endpoints.positions;
    $("tradesEndpoint").value = state.endpoints.trades;
  } catch {
    // no-op
  }
}

function saveSettings() {
  state.endpoints.overview = $("overviewEndpoint").value.trim();
  state.endpoints.positions = $("positionsEndpoint").value.trim();
  state.endpoints.trades = $("tradesEndpoint").value.trim();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.endpoints));
  $("status").textContent = "Saved API settings.";
}

function endpointFor(template, wallet) {
  return template.replaceAll("{wallet}", wallet);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function buildMockData(wallet) {
  const seed = hashSeed(wallet);
  const btcPrice = 65000 + (seed % 3500);
  const entry = btcPrice + 6000 - (seed % 1500);
  const size = 10 + (seed % 24) / 2;
  const pnl = (btcPrice - entry) * size;
  const value = btcPrice * size;

  state.positions = [
    { market: "BTC", leverage: 40, size, accountName: "Main", value, pnl, markPrice: btcPrice, entry },
    { market: "ETH", leverage: 20, size: size * 1.8, accountName: "Sub", value: (btcPrice / 23) * size * 1.8, pnl: pnl * -0.25, markPrice: btcPrice / 23, entry: btcPrice / 21 },
  ];

  state.trades = Array.from({ length: 10 }, (_, i) => {
    const realized = ((i % 3 === 0 ? -1 : 1) * (2500 + (seed % 300) * (i + 1))) / 10;
    return { time: new Date(Date.now() - i * 3600_000).toLocaleString(), market: i % 2 ? "BTC" : "ETH", side: i % 2 ? "Long" : "Short", size: ((size / 6) * (1 + i / 12)).toFixed(3), price: (btcPrice / (i % 2 ? 1 : 23) + i * 12).toFixed(2), realized };
  });

  const rUsd = -Math.abs(pnl) * 1.7;
  const srUsd = Math.abs(pnl) * 3.2;
  state.account = { rUsd, srUsd, srUsdPrice: 1.0463, marginUsage: Math.min(92, 18 + Math.abs(pnl) / value * 100) };

  state.spot = [["BTC", btcPrice, -1.2, 912_000_000], ["ETH", btcPrice / 23, 2.4, 401_200_000], ["SOL", 186 + (seed % 12), 1.1, 120_240_000], ["ARB", 1.1 + (seed % 13) / 100, -3.6, 58_000_000]];
  state.intel = [
    `Wallet ${wallet.slice(0, 6)}...${wallet.slice(-4)} currently has ${state.positions.length} open perp positions.`,
    `Largest exposure: ${state.positions[0].market} ${formatNum(state.positions[0].size)} at ${state.positions[0].leverage}x leverage.`,
    `Recent trade cadence: ${state.trades.length} fills in the last 10 hours.`,
    `Margin usage at ${state.account.marginUsage.toFixed(2)}% ${state.account.marginUsage > 70 ? "(elevated risk)" : "(healthy)"}.`,
  ];
}

function mapOverview(o = {}) {
  state.account = {
    rUsd: Number(o.rUsd ?? o.rusd ?? 0),
    srUsd: Number(o.srUsd ?? o.srusd ?? 0),
    srUsdPrice: Number(o.srUsdPrice ?? o.srusdPrice ?? 1.0463),
    marginUsage: Number(o.marginUsage ?? 0),
  };
}
function mapPositions(rows = []) {
  state.positions = rows.map((p) => ({
    market: p.market ?? p.symbol ?? "UNK",
    leverage: Number(p.leverage ?? 1),
    size: Number(p.size ?? 0),
    accountName: p.accountName ?? "Main",
    value: Number(p.value ?? p.positionValue ?? 0),
    pnl: Number(p.pnl ?? p.livePnl ?? 0),
    markPrice: Number(p.markPrice ?? 0),
    entry: Number(p.entry ?? p.entryPrice ?? 0),
  }));
}
function mapTrades(rows = []) {
  state.trades = rows.slice(0, 10).map((t) => ({
    time: t.time ?? t.timestamp ?? "",
    market: t.market ?? "UNK",
    side: t.side ?? "N/A",
    size: Number(t.size ?? 0).toFixed(3),
    price: Number(t.price ?? 0).toFixed(2),
    realized: Number(t.realized ?? t.realizedPnl ?? 0),
  }));
}

async function loadData(wallet) {
  $("status").textContent = "Loading wallet...";
  const { overview, positions, trades } = state.endpoints;
  const hasApi = overview && positions && trades;

  if (!hasApi) {
    buildMockData(wallet);
    $("status").textContent = "Demo mode: add API settings to load live Reya data.";
    render();
    return;
  }

  try {
    const [o, p, t] = await Promise.all([
      fetchJson(endpointFor(overview, wallet)),
      fetchJson(endpointFor(positions, wallet)),
      fetchJson(endpointFor(trades, wallet)),
    ]);
    mapOverview(o);
    mapPositions(Array.isArray(p) ? p : p.items || []);
    mapTrades(Array.isArray(t) ? t : t.items || []);
    state.spot = state.spot.length ? state.spot : [["BTC", 0, 0, 0], ["ETH", 0, 0, 0]];
    state.intel = [`Loaded API data for ${wallet.slice(0, 8)}...${wallet.slice(-4)}.`, `Positions: ${state.positions.length}`, `Trades shown: ${state.trades.length}`];
    $("status").textContent = "Connected mode: showing API data.";
  } catch (err) {
    buildMockData(wallet);
    $("status").textContent = `API load failed (${err.message}). Showing demo mode.`;
  }

  render();
}

function render() {
  const unrealized = state.positions.reduce((s, p) => s + p.pnl, 0);
  const accountValue = state.account.rUsd + state.account.srUsd;

  $("accountValue").textContent = formatUsd(accountValue);
  $("accountBreakdown").textContent = `rUSD: ${formatUsd(state.account.rUsd)} + srUSD: ${formatUsd(state.account.srUsd)}`;
  $("marginUsage").textContent = `${state.account.marginUsage.toFixed(2)}%`;
  $("marginBar").style.width = `${state.account.marginUsage}%`;
  $("unrealizedPnl").textContent = formatUsd(unrealized);
  $("unrealizedPnl").className = `metric-value ${unrealized >= 0 ? "positive" : "pnl-negative"}`;
  $("pnlDetails").textContent = `Main · ${state.positions.length} open positions`;
  $("stakedValue").textContent = formatUsd(state.account.srUsd);
  $("stakedAmount").textContent = `${formatNum(state.account.srUsd / Math.max(0.0001, state.account.srUsdPrice), 2)} srUSD @ ${formatUsd(state.account.srUsdPrice)}`;

  $("positionsTable").innerHTML = state.positions.map((p) => `<tr><td>${p.market} <span class="muted">${p.leverage}x</span></td><td>${formatNum(p.size, 4)}</td><td>${p.accountName}</td><td class="positive">${formatUsd(p.value)}</td><td class="${p.pnl >= 0 ? "positive" : "pnl-negative"}">${formatUsd(p.pnl)}</td><td>${formatNum(p.markPrice)}</td><td>${formatNum(p.entry)}</td></tr>`).join("");

  const realizedTotal = state.trades.reduce((s, t) => s + t.realized, 0);
  const wins = state.trades.filter((t) => t.realized > 0).length;
  $("tradeHistoryTable").innerHTML = state.trades.map((t) => `<tr><td>${t.time}</td><td>${t.market}</td><td>${t.side}</td><td>${t.size}</td><td>${t.price}</td><td class="${t.realized >= 0 ? "positive" : "pnl-negative"}">${formatUsd(t.realized)}</td></tr>`).join("");
  $("realizedPnl").textContent = formatUsd(realizedTotal);
  $("realizedPnl").className = `metric-value ${realizedTotal >= 0 ? "positive" : "pnl-negative"}`;
  $("winRate").textContent = `${((wins / Math.max(1, state.trades.length)) * 100).toFixed(1)}%`;

  $("marketIntelList").innerHTML = state.intel.map((item) => `<li>${item}</li>`).join("");
  $("spotTable").innerHTML = state.spot.map(([a, p, c, v]) => `<tr><td>${a}</td><td>${formatUsd(p)}</td><td class="${c >= 0 ? "positive" : "pnl-negative"}">${Number(c).toFixed(2)}%</td><td>${Math.round(v).toLocaleString("en-US")}</td></tr>`).join("");

  const risk = Math.min(100, state.account.marginUsage + Math.abs(unrealized) / 10_000);
  $("riskBar").style.width = `${risk}%`;
  $("riskText").textContent = risk > 80 ? "Critical" : risk > 60 ? "High" : risk > 35 ? "Elevated" : "Calm";
  $("riskText").className = `metric-value ${risk > 60 ? "pnl-negative" : "positive"}`;
}

function startLiveUpdates() {
  clearInterval(state.timer);
  state.timer = setInterval(() => {
    state.positions = state.positions.map((p) => {
      const drift = (Math.random() - 0.5) * (p.markPrice * 0.0018);
      const markPrice = p.markPrice + drift;
      return { ...p, markPrice, pnl: (markPrice - p.entry) * p.size, value: markPrice * p.size };
    });
    render();
  }, 4000);
}

$("walletForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const wallet = $("walletInput").value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) return void ($("status").textContent = "Please enter a valid EVM wallet address.");
  state.wallet = wallet;
  await loadData(wallet);
  startLiveUpdates();
});
$("saveSettings").addEventListener("click", saveSettings);

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  tab.classList.add("active");
  $(`panel-${tab.dataset.tab}`).classList.add("active");
}));

loadSettings();
const exampleWallet = "0x72f96f57d82e8f157ab17e80f9fc1a3f4198f8d8";
$("walletInput").value = exampleWallet;
loadData(exampleWallet).then(startLiveUpdates);
