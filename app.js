const $ = (id) => document.getElementById(id);

const state = {
  wallet: "",
  positionsBySymbol: new Map(),
  trades: [],
  pricesBySymbol: new Map(),
  marketSummaryBySymbol: new Map(),
  ws: null,
  wsUrl: "",
  reconnectTimer: null,
  reconnectAttempt: 0,
};

const WS_ENDPOINTS = ["wss://ws.reya.xyz", "wss://websocket-testnet.reya.xyz"];

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

function subscribe(channel) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify({ type: "subscribe", channel }));
}

function subscribeAll(wallet) {
  subscribe("/v2/markets/summary");
  subscribe("/v2/prices");
  subscribe(`/v2/wallet/${wallet}/positions`);
  subscribe(`/v2/wallet/${wallet}/perpExecutions`);
}

function connectWebSocket(wallet) {
  clearTimeout(state.reconnectTimer);
  if (state.ws) {
    state.ws.onclose = null;
    state.ws.close();
    state.ws = null;
  }

  const endpoint = WS_ENDPOINTS[state.reconnectAttempt % WS_ENDPOINTS.length];
  state.wsUrl = endpoint;
  const ws = new WebSocket(endpoint);
  state.ws = ws;
  setConnectionStatus("Connecting...", endpoint, true);

  ws.onopen = () => {
    state.reconnectAttempt = 0;
    setConnectionStatus("Connected", `${endpoint} · ${short(wallet)}`, true);
    $("status").textContent = "Connected to Reya WebSocket V2. Streaming live data.";
    subscribeAll(wallet);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch {
      // ignore malformed payloads
    }
  };

  ws.onerror = () => {
    setConnectionStatus("Socket Error", "Attempting fallback/reconnect", false);
  };

  ws.onclose = () => {
    setConnectionStatus("Disconnected", "Retrying in background", false);
    scheduleReconnect(wallet);
  };
}

function scheduleReconnect(wallet) {
  clearTimeout(state.reconnectTimer);
  state.reconnectAttempt += 1;
  const delay = Math.min(15000, 1500 * state.reconnectAttempt);
  state.reconnectTimer = setTimeout(() => connectWebSocket(wallet), delay);
}

function handleMessage(msg) {
  if (msg.type === "ping") {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: "pong", timestamp: msg.timestamp || Date.now() }));
    }
    return;
  }

  if (msg.type !== "channel_data" || !msg.channel) return;

  if (msg.channel === "/v2/prices" && Array.isArray(msg.data)) {
    for (const row of msg.data) state.pricesBySymbol.set(row.symbol, row);
  } else if (msg.channel === "/v2/markets/summary" && Array.isArray(msg.data)) {
    for (const row of msg.data) state.marketSummaryBySymbol.set(row.symbol, row);
  } else if (msg.channel.endsWith("/positions") && Array.isArray(msg.data)) {
    state.positionsBySymbol.clear();
    for (const row of msg.data) state.positionsBySymbol.set(row.symbol, row);
  } else if (msg.channel.endsWith("/perpExecutions") && Array.isArray(msg.data)) {
    for (const row of msg.data) {
      state.trades.unshift({
        time: row.timestamp,
        market: row.symbol,
        side: parseSide(row.side),
        size: Number(row.qty || 0),
        price: Number(row.price || 0),
        fee: Number(row.fee || 0),
      });
    }
    state.trades = state.trades.slice(0, 20);
  }

  render();
}

function derivePositionView() {
  const positions = [];
  for (const [symbol, pos] of state.positionsBySymbol.entries()) {
    const price = state.pricesBySymbol.get(symbol);
    const markPrice = Number(price?.poolPrice ?? price?.oraclePrice ?? 0);
    const qty = Number(pos.qty || 0);
    const signedQty = pos.side === "S" ? -Math.abs(qty) : Math.abs(qty);
    const entry = Number(pos.avgEntryPrice || 0);
    const value = Math.abs(signedQty) * markPrice;
    const pnl = signedQty * (markPrice - entry);

    positions.push({
      market: symbol,
      size: signedQty,
      accountId: pos.accountId ?? "-",
      value,
      pnl,
      markPrice,
      entry,
    });
  }
  return positions;
}

function render() {
  const positions = derivePositionView();
  const unrealized = positions.reduce((s, p) => s + p.pnl, 0);
  const grossExposure = positions.reduce((s, p) => s + Math.abs(p.value), 0);
  const estAccountValue = grossExposure + unrealized;
  const marginUsage = Math.min(99, grossExposure === 0 ? 0 : (grossExposure / Math.max(1, estAccountValue)) * 100);

  $("accountValue").textContent = formatUsd(estAccountValue);
  $("accountBreakdown").textContent = `Gross exposure ${formatUsd(grossExposure)} · Unrealized ${formatUsd(unrealized)}`;
  $("marginUsage").textContent = `${marginUsage.toFixed(2)}%`;
  $("marginBar").style.width = `${marginUsage}%`;

  $("unrealizedPnl").textContent = formatUsd(unrealized);
  $("unrealizedPnl").className = `metric-value ${unrealized >= 0 ? "positive" : "pnl-negative"}`;
  $("pnlDetails").textContent = `${positions.length} open positions · wallet ${short(state.wallet)}`;

  $("positionsTable").innerHTML = positions.length
    ? positions.map((p) => `<tr><td>${p.market}</td><td class="${p.size >= 0 ? "positive" : "pnl-negative"}">${formatNum(p.size, 4)}</td><td>${p.accountId}</td><td>${formatUsd(p.value)}</td><td class="${p.pnl >= 0 ? "positive" : "pnl-negative"}">${formatUsd(p.pnl)}</td><td>${formatNum(p.markPrice, 3)}</td><td>${formatNum(p.entry, 3)}</td></tr>`).join("")
    : `<tr><td colspan="7" class="muted">No live positions yet for this wallet.</td></tr>`;

  const totalFees = state.trades.reduce((s, t) => s + t.fee, 0);
  const buyCount = state.trades.filter((t) => t.side === "Long").length;

  $("tradeHistoryTable").innerHTML = state.trades.length
    ? state.trades.map((t) => `<tr><td>${new Date(Number(t.time || Date.now())).toLocaleString()}</td><td>${t.market}</td><td>${t.side}</td><td>${formatNum(t.size, 4)}</td><td>${formatUsd(t.price)}</td><td class="pnl-negative">${formatUsd(t.fee)}</td></tr>`).join("")
    : `<tr><td colspan="6" class="muted">No executions streamed yet.</td></tr>`;

  $("realizedPnl").textContent = formatUsd(totalFees * -1);
  $("realizedPnl").className = "metric-value pnl-negative";
  $("winRate").textContent = `${((buyCount / Math.max(1, state.trades.length)) * 100).toFixed(1)}%`;

  const summaries = [...state.marketSummaryBySymbol.values()].slice(0, 6);
  $("marketIntelList").innerHTML = summaries.length
    ? summaries.map((s) => `<li>${s.symbol}: 24h vol ${formatNum(s.volume24h, 2)} · funding ${formatNum(s.fundingRate, 6)} · Δ24h ${formatNum(s.pxChange24h, 2)}</li>`).join("")
    : `<li class="muted">Waiting for /v2/markets/summary stream...</li>`;

  const prices = [...state.pricesBySymbol.values()].slice(0, 12);
  $("spotTable").innerHTML = prices.length
    ? prices.map((p) => `<tr><td>${p.symbol}</td><td>${formatUsd(p.oraclePrice)}</td><td>${formatUsd(p.poolPrice)}</td><td>${new Date(Number(p.updatedAt || Date.now())).toLocaleTimeString()}</td></tr>`).join("")
    : `<tr><td colspan="4" class="muted">Waiting for /v2/prices stream...</td></tr>`;

  const risk = Math.min(100, marginUsage + Math.abs(unrealized) / 10000);
  $("riskBar").style.width = `${risk}%`;
  $("riskText").textContent = risk > 80 ? "Critical" : risk > 60 ? "High" : risk > 35 ? "Elevated" : "Calm";
  $("riskText").className = `metric-value ${risk > 60 ? "pnl-negative" : "positive"}`;
}

$("walletForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const wallet = $("walletInput").value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    $("status").textContent = "Please enter a valid EVM wallet address.";
    return;
  }

  state.wallet = wallet;
  state.positionsBySymbol.clear();
  state.trades = [];
  render();
  connectWebSocket(wallet);
});

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  tab.classList.add("active");
  $(`panel-${tab.dataset.tab}`).classList.add("active");
}));

const exampleWallet = "0x6c51275fd01d5dbd2da194e92f920f8598306df2";
$("walletInput").value = exampleWallet;
$("status").textContent = "Press Load Wallet to start live Reya WebSocket streams.";
setConnectionStatus("Disconnected", "Waiting for wallet", false);
render();
