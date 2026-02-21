const $ = (id) => document.getElementById(id);

const state = {
  wallet: "",
  positionsBySymbol: new Map(),
  trades: [],
  orders: [],
  pricesBySymbol: new Map(),
  marketSummaryBySymbol: new Map(),
  ws: null,
  reconnectTimer: null,
  reconnectAttempt: 0,
  connectedEndpoint: "",
  lastMessageAt: 0,
};

const WS_ENDPOINTS = ["wss://ws.reya.xyz", "wss://websocket-testnet.reya.xyz"];
const MAX_TRADES = 50;

const formatUsd = (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(v || 0));
const formatNum = (v, d = 3) => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const short = (x) => (x ? `${x.slice(0, 6)}...${x.slice(-4)}` : "-");

function setConnectionStatus(main, details, positive = true) {
  $("connectionValue").textContent = main;
  $("connectionValue").className = `metric-value ${positive ? "positive" : "pnl-negative"}`;
  $("connectionDetails").textContent = details;
}

function parseSide(side) {
  return side === "B" ? "Long" : side === "S" ? "Short" : side || "N/A";
}

function connectWebSocket(wallet) {
  clearTimeout(state.reconnectTimer);
  if (state.ws) {
    state.ws.onclose = null;
    state.ws.close();
  }

  const endpoint = WS_ENDPOINTS[state.reconnectAttempt % WS_ENDPOINTS.length];
  const ws = new WebSocket(endpoint);
  state.ws = ws;
  state.connectedEndpoint = endpoint;
  setConnectionStatus("Connecting...", endpoint);

  ws.onopen = () => {
    state.reconnectAttempt = 0;
    setConnectionStatus("Connected", `${endpoint} · ${short(wallet)}`);
    $("status").textContent = "Live mode active. Streaming directly from Reya WebSocket V2.";
    subscribeAll(wallet);
  };

  ws.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(event.data));
    } catch {
      // ignore malformed messages
    }
  };

  ws.onerror = () => {
    setConnectionStatus("Socket Error", "Will retry with fallback endpoint", false);
  };

  ws.onclose = () => {
    setConnectionStatus("Disconnected", "Reconnecting...", false);
    scheduleReconnect(wallet);
  };
}

function scheduleReconnect(wallet) {
  clearTimeout(state.reconnectTimer);
  state.reconnectAttempt += 1;
  const delay = Math.min(15_000, 1_500 * state.reconnectAttempt);
  state.reconnectTimer = setTimeout(() => connectWebSocket(wallet), delay);
}

function send(message) {
  if (state.ws?.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify(message));
}

function subscribeAll(wallet) {
  [
    "/v2/markets/summary",
    "/v2/prices",
    `/v2/wallet/${wallet}/positions`,
    `/v2/wallet/${wallet}/perpExecutions`,
    `/v2/wallet/${wallet}/orderChanges`,
  ].forEach((channel) => send({ type: "subscribe", channel }));
}

function asArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") return [data];
  return [];
}

function handleMessage(msg) {
  if (msg.type === "ping") {
    send({ type: "pong", timestamp: msg.timestamp || Date.now() });
    return;
  }
  if (msg.type !== "channel_data" || !msg.channel) return;

  state.lastMessageAt = Number(msg.timestamp || Date.now());

  if (msg.channel === "/v2/prices" || msg.channel.startsWith("/v2/prices/")) {
    for (const row of asArray(msg.data)) state.pricesBySymbol.set(row.symbol, row);
  } else if (msg.channel === "/v2/markets/summary" || msg.channel.endsWith("/summary")) {
    for (const row of asArray(msg.data)) state.marketSummaryBySymbol.set(row.symbol, row);
  } else if (msg.channel.endsWith("/positions")) {
    state.positionsBySymbol.clear();
    for (const row of asArray(msg.data)) state.positionsBySymbol.set(row.symbol, row);
  } else if (msg.channel.endsWith("/perpExecutions")) {
    for (const row of asArray(msg.data)) {
      state.trades.unshift({
        time: Number(row.timestamp || Date.now()),
        market: row.symbol,
        side: parseSide(row.side),
        size: Number(row.qty || 0),
        price: Number(row.price || 0),
        fee: Number(row.fee || 0),
      });
    }
    state.trades = state.trades.slice(0, MAX_TRADES);
  } else if (msg.channel.endsWith("/orderChanges")) {
    state.orders = asArray(msg.data).slice(0, 50);
  }

  render();
}

function derivePositions() {
  const out = [];
  for (const [symbol, pos] of state.positionsBySymbol.entries()) {
    const price = state.pricesBySymbol.get(symbol);
    const markPrice = Number(price?.poolPrice ?? price?.oraclePrice ?? 0);
    const qty = Number(pos.qty || 0);
    const signedQty = pos.side === "S" ? -Math.abs(qty) : Math.abs(qty);
    const entry = Number(pos.avgEntryPrice || 0);
    const value = Math.abs(signedQty) * markPrice;
    const pnl = signedQty * (markPrice - entry);

    out.push({
      market: symbol,
      size: signedQty,
      accountId: pos.accountId ?? "-",
      value,
      pnl,
      markPrice,
      entry,
    });
  }
  return out;
}

function render() {
  const positions = derivePositions();
  const unrealized = positions.reduce((sum, p) => sum + p.pnl, 0);
  const grossExposure = positions.reduce((sum, p) => sum + Math.abs(p.value), 0);
  const marginUsage = Math.min(99, grossExposure === 0 ? 0 : (grossExposure / Math.max(1, grossExposure + unrealized)) * 100);

  $("accountValue").textContent = formatUsd(grossExposure + unrealized);
  $("accountBreakdown").textContent = `Exposure ${formatUsd(grossExposure)} · Open Orders ${state.orders.length}`;
  $("marginUsage").textContent = `${marginUsage.toFixed(2)}%`;
  $("marginBar").style.width = `${marginUsage}%`;
  $("unrealizedPnl").textContent = formatUsd(unrealized);
  $("unrealizedPnl").className = `metric-value ${unrealized >= 0 ? "positive" : "pnl-negative"}`;
  $("pnlDetails").textContent = `${positions.length} positions · wallet ${short(state.wallet)}`;

  $("positionsTable").innerHTML = positions.length
    ? positions.map((p) => `<tr><td>${p.market}</td><td class="${p.size >= 0 ? "positive" : "pnl-negative"}">${formatNum(p.size, 4)}</td><td>${p.accountId}</td><td>${formatUsd(p.value)}</td><td class="${p.pnl >= 0 ? "positive" : "pnl-negative"}">${formatUsd(p.pnl)}</td><td>${formatNum(p.markPrice, 3)}</td><td>${formatNum(p.entry, 3)}</td></tr>`).join("")
    : '<tr><td colspan="7" class="muted">No live positions yet for this wallet.</td></tr>';

  const totalFees = state.trades.reduce((sum, t) => sum + t.fee, 0);
  const buyRatio = state.trades.length ? (state.trades.filter((t) => t.side === "Long").length / state.trades.length) * 100 : 0;

  $("tradeHistoryTable").innerHTML = state.trades.length
    ? state.trades.map((t) => `<tr><td>${new Date(t.time).toLocaleString()}</td><td>${t.market}</td><td>${t.side}</td><td>${formatNum(t.size, 4)}</td><td>${formatUsd(t.price)}</td><td class="pnl-negative">${formatUsd(t.fee)}</td></tr>`).join("")
    : '<tr><td colspan="6" class="muted">No executions streamed yet.</td></tr>';

  $("realizedPnl").textContent = formatUsd(totalFees * -1);
  $("realizedPnl").className = "metric-value pnl-negative";
  $("winRate").textContent = `${buyRatio.toFixed(1)}%`;

  const topSummaries = [...state.marketSummaryBySymbol.values()].slice(0, 6);
  const latestTime = state.lastMessageAt ? new Date(state.lastMessageAt).toLocaleTimeString() : "-";
  $("marketIntelList").innerHTML = topSummaries.length
    ? topSummaries.map((s) => `<li>${s.symbol}: funding ${formatNum(s.fundingRate, 6)} · vol24h ${formatNum(s.volume24h, 2)} · updated ${latestTime}</li>`).join("")
    : "<li class='muted'>Waiting for market summaries...</li>";

  const livePrices = [...state.pricesBySymbol.values()].slice(0, 15);
  $("spotTable").innerHTML = livePrices.length
    ? livePrices.map((p) => `<tr><td>${p.symbol}</td><td>${formatUsd(p.oraclePrice)}</td><td>${formatUsd(p.poolPrice)}</td><td>${new Date(Number(p.updatedAt || Date.now())).toLocaleTimeString()}</td></tr>`).join("")
    : '<tr><td colspan="4" class="muted">Waiting for price stream...</td></tr>';

  const risk = Math.min(100, marginUsage + Math.abs(unrealized) / 10_000);
  $("riskBar").style.width = `${risk}%`;
  $("riskText").textContent = risk > 80 ? "Critical" : risk > 60 ? "High" : risk > 35 ? "Elevated" : "Calm";
  $("riskText").className = `metric-value ${risk > 60 ? "pnl-negative" : "positive"}`;
}

function startForWallet(wallet) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    $("status").textContent = "Please enter a valid EVM wallet address.";
    return;
  }
  state.wallet = wallet;
  state.positionsBySymbol.clear();
  state.trades = [];
  state.orders = [];
  render();
  connectWebSocket(wallet);
}

$("walletForm").addEventListener("submit", (event) => {
  event.preventDefault();
  startForWallet($("walletInput").value.trim());
});

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  tab.classList.add("active");
  $(`panel-${tab.dataset.tab}`).classList.add("active");
}));

const urlWallet = new URLSearchParams(window.location.search).get("wallet");
const defaultWallet = urlWallet || "0x6c51275fd01d5dbd2da194e92f920f8598306df2";
$("walletInput").value = defaultWallet;
setConnectionStatus("Connecting...", "Starting live stream", true);
startForWallet(defaultWallet);
