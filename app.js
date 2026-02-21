const $ = (id) => document.getElementById(id);

const state = {
  wallet: "",
  positionsBySymbol: new Map(),
  trades: [],
  orders: [],
  pricesBySymbol: new Map(),
  marketSummaryBySymbol: new Map(),
  transfers: [],
  transferSource: "",
  spotTrades: [],
  spotTransfers: [],
  spotTransferSource: "",
  ws: null,
  reconnectTimer: null,
  reconnectAttempt: 0,
  connectedEndpoint: "",
  lastMessageAt: 0,
};

const WS_ENDPOINTS = ["wss://ws.reya.xyz", "wss://websocket-testnet.reya.xyz"];
const REST_CANDIDATES = ["https://api.reya.xyz", "https://reya.xyz/api"];
const MAX_TRADES = 50;
const MAX_SPOT_TRADES = 80;

function sideClass(side) {
  if (side === "Long") return "long-text";
  if (side === "Short") return "short-text";
  return "muted";
}

const formatUsd = (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(v || 0));
const formatNum = (v, d = 3) => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const short = (x) => (x ? `${x.slice(0, 6)}...${x.slice(-4)}` : "-");
function normalizeSideLabel(value) {
  if (!value) return null;
  const upper = String(value).trim().toUpperCase();
  if (["B", "BUY", "LONG", "L"].includes(upper)) return "Long";
  if (["S", "SELL", "SHORT"].includes(upper)) return "Short";
  return null;
}

function inferSide(sideValue, qtyValue) {
  const normalizedSide = normalizeSideLabel(sideValue);
  if (normalizedSide) return normalizedSide;

  const qty = Number(qtyValue || 0);
  if (qty < 0) return "Short";
  if (qty > 0) return "Long";
  return "N/A";
}

const parseSide = (side) => normalizeSideLabel(side) || side || "N/A";

function firstDefined(obj, keys) {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null && obj?.[key] !== "") return obj[key];
  }
  return undefined;
}

function positionQty(pos) {
  const raw = firstDefined(pos, ["signedQty", "netQty", "positionQty", "qty", "size", "amount"]);
  return Number(raw || 0);
}

function positionSide(pos, qty) {
  const boolSide = firstDefined(pos, ["isLong", "long", "isBuy"]);
  if (boolSide === true || boolSide === "true") return "Long";
  if (boolSide === false || boolSide === "false") return "Short";

  const boolShort = firstDefined(pos, ["isShort", "short", "isSell"]);
  if (boolShort === true || boolShort === "true") return "Short";
  if (boolShort === false || boolShort === "false") return "Long";

  const rawSide = firstDefined(pos, ["side", "positionSide", "direction", "tradeSide", "positionDirection"]);
  return inferSide(rawSide, qty);
}

function positionEntryPrice(pos) {
  return Number(firstDefined(pos, ["avgEntryPrice", "entryPrice", "avgOpenPrice", "openPrice", "averageEntryPrice"]) || 0);
}

function positionPnl(pos, signedQty, markPrice, entry) {
  const direct = Number(firstDefined(pos, ["unrealizedPnl", "unrealizedPNL", "uPnl", "openPnl", "pnl", "profitLoss"]));
  if (Number.isFinite(direct)) return direct;

  if (!Number.isFinite(markPrice) || !Number.isFinite(entry)) return 0;
  return signedQty * (markPrice - entry);
}

function normalizeSpotTrade(row, source = "REST") {
  const buyFlag = firstDefined(row, ["isBuy", "buy"]);
  const side = firstDefined(row, ["side", "tradeSide", "direction", "action"])
    || ((buyFlag === true || buyFlag === "true") ? "BUY" : (buyFlag === false || buyFlag === "false") ? "SELL" : "N/A");
  const normalizedSide = parseSide(side);
  const size = Number(firstDefined(row, ["qty", "size", "amount", "baseQty", "quantity"]) || 0);
  const price = Number(firstDefined(row, ["price", "px", "avgPrice", "fillPrice"]) || 0);
  const market = firstDefined(row, ["symbol", "market", "pair", "asset"]) || "-";
  const time = Number(firstDefined(row, ["timestamp", "createdAt", "updatedAt", "time", "executedAt"]) || Date.now());
  return {
    time,
    market,
    side: normalizedSide,
    size: Math.abs(size),
    price,
    value: Math.abs(size) * price,
    source,
  };
}

async function loadSpotTrades(wallet) {
  const pathOptions = [
    `/v2/wallet/${wallet}/spotExecutions`,
    `/v2/wallet/${wallet}/spotTrades`,
    `/v2/wallet/${wallet}/spotFills`,
    `/v2/wallet/${wallet}/executions?marketType=spot`,
  ];

  for (const base of REST_CANDIDATES) {
    for (const path of pathOptions) {
      try {
        const payload = await fetchJson(`${base}${path}`);
        const rows = extractRows(payload).map((r) => normalizeSpotTrade(r, `REST ${path}`)).filter((t) => t.market !== "-" || t.price > 0 || t.size > 0);
        if (rows.length) {
          state.spotTrades = rows.sort((a, b) => b.time - a.time).slice(0, MAX_SPOT_TRADES);
          return true;
        }
      } catch {
        // continue
      }
    }
  }
  state.spotTrades = [];
  state.spotTransfers = [];
  state.spotTransferSource = "";
  return false;
}

function normalizeTransferType(value) {
  const raw = String(value || "").toLowerCase();
  if (["deposit", "deposited", "in", "credit", "add", "added"].some((x) => raw.includes(x))) return "Deposit";
  if (["withdraw", "withdrawal", "out", "debit", "remove", "removed"].some((x) => raw.includes(x))) return "Withdrawal";
  return "Transfer";
}

function normalizeTransfer(row) {
  const amount = Number(firstDefined(row, ["amountUsd", "usdAmount", "amount", "value", "delta", "change", "quantity"]) || 0);
  const timestamp = Number(firstDefined(row, ["timestamp", "createdAt", "updatedAt", "time", "executedAt"]) || Date.now());
  const directType = firstDefined(row, ["type", "eventType", "action", "txType", "kind"]);
  const type = normalizeTransferType(directType || (amount < 0 ? "withdrawal" : amount > 0 ? "deposit" : "transfer"));
  return {
    time: timestamp,
    type,
    amount: Math.abs(amount),
    signedAmount: type === "Withdrawal" ? -Math.abs(amount) : Math.abs(amount),
    token: firstDefined(row, ["asset", "token", "symbol", "currency"]) || "USD",
    txHash: firstDefined(row, ["txHash", "transactionHash", "hash", "id"]) || "-",
  };
}

async function loadSpotTransferHistory(wallet) {
  const pathOptions = [
    `/v2/wallet/${wallet}/spotTransfers`,
    `/v2/wallet/${wallet}/spotDeposits`,
    `/v2/wallet/${wallet}/spotWithdrawals`,
    `/v2/wallet/${wallet}/spotBalanceChanges`,
  ];

  for (const base of REST_CANDIDATES) {
    for (const path of pathOptions) {
      try {
        const payload = await fetchJson(`${base}${path}`);
        const rows = extractRows(payload).map(normalizeTransfer).filter((t) => Number.isFinite(t.amount) && t.amount > 0);
        if (rows.length) {
          state.spotTransfers = rows.sort((a, b) => b.time - a.time).slice(0, 200);
          state.spotTransferSource = `${base}${path}`;
          return true;
        }
      } catch {
        // continue lookup
      }
    }
  }

  state.spotTransfers = [];
  state.spotTransferSource = "No spot transfer endpoint discovered yet";
  return false;
}

async function loadTransfers(wallet) {
  const pathOptions = [
    `/v2/wallet/${wallet}/transfers`,
    `/v2/wallet/${wallet}/balanceChanges`,
    `/v2/wallet/${wallet}/deposits`,
    `/v2/wallet/${wallet}/withdrawals`,
    `/v2/wallet/${wallet}/cashflow`,
  ];

  for (const base of REST_CANDIDATES) {
    for (const path of pathOptions) {
      try {
        const payload = await fetchJson(`${base}${path}`);
        const rows = extractRows(payload).map(normalizeTransfer).filter((t) => Number.isFinite(t.amount) && t.amount > 0);
        if (rows.length) {
          state.transfers = rows.sort((a, b) => b.time - a.time).slice(0, 200);
          state.transferSource = `${base}${path}`;
          return true;
        }
      } catch {
        // continue lookup
      }
    }
  }
  state.transferSource = "No transfer endpoint discovered yet";
  state.transfers = [];
  return false;
}

function setConnectionStatus(main, details, positive = true) {
  $("connectionValue").textContent = main;
  $("connectionValue").className = `metric-value ${positive ? "positive" : "pnl-negative"}`;
  $("connectionDetails").textContent = details;
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
    try { handleMessage(JSON.parse(event.data)); } catch { /* ignore malformed */ }
  };

  ws.onerror = () => setConnectionStatus("Socket Error", "Will retry with fallback endpoint", false);
  ws.onclose = () => {
    setConnectionStatus("Disconnected", "Reconnecting...", false);
    scheduleReconnect(wallet);
  };
}

function scheduleReconnect(wallet) {
  clearTimeout(state.reconnectTimer);
  state.reconnectAttempt += 1;
  state.reconnectTimer = setTimeout(() => connectWebSocket(wallet), Math.min(15000, 1500 * state.reconnectAttempt));
}

function send(message) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(message));
}

function subscribeAll(wallet) {
  [
    "/v2/markets/summary",
    "/v2/prices",
    `/v2/wallet/${wallet}/positions`,
    `/v2/wallet/${wallet}/perpExecutions`,
    `/v2/wallet/${wallet}/orderChanges`,
    `/v2/wallet/${wallet}/transfers`,
    `/v2/wallet/${wallet}/balanceChanges`,
  ].forEach((channel) => send({ type: "subscribe", channel }));
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["items", "data", "rows", "positions", "executions", "perpExecutions", "orderChanges", "spotTrades", "spotExecutions"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [payload];
}

function handleMessage(msg) {
  if (msg.type === "ping") return send({ type: "pong", timestamp: msg.timestamp || Date.now() });
  if (msg.type !== "channel_data" || !msg.channel) return;

  state.lastMessageAt = Number(msg.timestamp || Date.now());

  if (msg.channel === "/v2/prices" || msg.channel.startsWith("/v2/prices/")) {
    for (const row of extractRows(msg.data)) state.pricesBySymbol.set(row.symbol, row);
  } else if (msg.channel === "/v2/markets/summary" || msg.channel.endsWith("/summary")) {
    for (const row of extractRows(msg.data)) state.marketSummaryBySymbol.set(row.symbol, row);
  } else if (msg.channel.endsWith("/positions")) {
    state.positionsBySymbol.clear();
    for (const row of extractRows(msg.data)) state.positionsBySymbol.set(row.symbol, row);
  } else if (msg.channel.endsWith("/perpExecutions")) {
    for (const row of extractRows(msg.data)) {
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
    state.orders = extractRows(msg.data).slice(0, 50);
  } else if (msg.channel.endsWith("/transfers") || msg.channel.endsWith("/balanceChanges")) {
    const incoming = extractRows(msg.data).map(normalizeTransfer).filter((t) => Number.isFinite(t.amount) && t.amount > 0);
    state.transfers = [...incoming, ...state.transfers].sort((a, b) => b.time - a.time).slice(0, 200);
  }

  render();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function backfillFromRest(wallet) {
  for (const base of REST_CANDIDATES) {
    try {
      const [positions, trades, prices, summary] = await Promise.all([
        fetchJson(`${base}/v2/wallet/${wallet}/positions`),
        fetchJson(`${base}/v2/wallet/${wallet}/perpExecutions`),
        fetchJson(`${base}/v2/prices`),
        fetchJson(`${base}/v2/markets/summary`),
      ]);

      for (const row of extractRows(positions)) state.positionsBySymbol.set(row.symbol, row);
      for (const row of extractRows(trades)) {
        state.trades.push({
          time: Number(row.timestamp || Date.now()),
          market: row.symbol,
          side: parseSide(row.side),
          size: Number(row.qty || 0),
          price: Number(row.price || 0),
          fee: Number(row.fee || 0),
        });
      }
      state.trades = state.trades.slice(0, MAX_TRADES);
      for (const row of extractRows(prices)) state.pricesBySymbol.set(row.symbol, row);
      for (const row of extractRows(summary)) state.marketSummaryBySymbol.set(row.symbol, row);

      await Promise.all([loadTransfers(wallet), loadSpotTrades(wallet), loadSpotTransferHistory(wallet)]);
      $("status").textContent = `Live mode active. Loaded history from ${base}; websocket keeps perp/price data live.`;
      render();
      return;
    } catch {
      // try next candidate
    }
  }
}

function derivePositions() {
  const out = [];
  for (const [symbol, pos] of state.positionsBySymbol.entries()) {
    const price = state.pricesBySymbol.get(symbol);
    const markPrice = Number(price?.poolPrice ?? price?.oraclePrice ?? 0);
    const qty = positionQty(pos);
    const side = positionSide(pos, qty);
    const signedQty = side === "Short" ? -Math.abs(qty) : Math.abs(qty);
    const entry = positionEntryPrice(pos);
    const pnl = positionPnl(pos, signedQty, markPrice, entry);
    out.push({ market: symbol, side, size: signedQty, accountId: pos.accountId ?? "-", value: Math.abs(signedQty) * markPrice, pnl, markPrice, entry });
  }
  return out;
}

function computeTradePnlEst(t) {
  const livePrice = Number(state.pricesBySymbol.get(t.market)?.poolPrice ?? state.pricesBySymbol.get(t.market)?.oraclePrice ?? t.price);
  const direction = t.side === "Long" ? 1 : -1;
  return direction * (livePrice - t.price) * Math.abs(t.size) - t.fee;
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
  $("unrealizedPnl").className = `metric-value ${unrealized >= 0 ? "pnl-positive" : "pnl-loss"}`;
  $("pnlDetails").textContent = `${positions.length} positions · wallet ${short(state.wallet)}`;

  const totalDeposits = state.transfers.filter((t) => t.type === "Deposit").reduce((sum, t) => sum + t.amount, 0);
  const totalWithdrawals = state.transfers.filter((t) => t.type === "Withdrawal").reduce((sum, t) => sum + t.amount, 0);
  const netFlow = totalDeposits - totalWithdrawals;
  $("cashflowValue").textContent = formatUsd(netFlow);
  $("cashflowValue").className = `metric-value ${netFlow >= 0 ? "pnl-positive" : "pnl-loss"}`;
  $("cashflowDetails").textContent = `Deposited ${formatUsd(totalDeposits)} · Withdrawn ${formatUsd(totalWithdrawals)}`;

  $("positionsTable").innerHTML = positions.length
    ? positions.map((p) => `<tr><td>${p.market}</td><td class="${sideClass(p.side)}">${p.side}</td><td class="${sideClass(p.side)}">${formatNum(p.size, 4)}</td><td>${p.accountId}</td><td>${formatUsd(p.value)}</td><td class="${p.pnl >= 0 ? "pnl-positive" : "pnl-loss"}">${formatUsd(p.pnl)}</td><td>${formatNum(p.markPrice, 3)}</td><td>${formatNum(p.entry, 3)}</td></tr>`).join("")
    : '<tr><td colspan="8" class="muted">No positions found for this wallet yet.</td></tr>';

  const totalFees = state.trades.reduce((sum, t) => sum + t.fee, 0);
  const buyRatio = state.trades.length ? (state.trades.filter((t) => t.side === "Long").length / state.trades.length) * 100 : 0;
  $("tradeHistoryTable").innerHTML = state.trades.length
    ? state.trades.map((t) => {
      const pnlEst = computeTradePnlEst(t);
      return `<tr><td>${new Date(t.time).toLocaleString()}</td><td>${t.market}</td><td class="${sideClass(t.side)}">${t.side === "Long" ? "Buy" : t.side === "Short" ? "Sell" : t.side}</td><td>${formatNum(t.size, 4)}</td><td>${formatUsd(t.price)}</td><td class="pnl-loss">${formatUsd(t.fee)}</td><td class="${pnlEst >= 0 ? "pnl-positive" : "pnl-loss"}">${formatUsd(pnlEst)}</td></tr>`;
    }).join("")
    : '<tr><td colspan="7" class="muted">No wallet executions found yet.</td></tr>';

  $("realizedPnl").textContent = formatUsd(totalFees * -1);
  $("realizedPnl").className = "metric-value pnl-loss";
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

  $("spotTradesTable").innerHTML = state.spotTrades.length
    ? state.spotTrades.map((t) => `<tr><td>${new Date(t.time).toLocaleString()}</td><td>${t.market}</td><td class="${sideClass(t.side)}">${t.side === "Long" ? "Buy" : t.side === "Short" ? "Sell" : t.side}</td><td>${formatNum(t.size, 4)}</td><td>${formatUsd(t.price)}</td><td>${formatUsd(t.value)}</td><td class="muted">Historical</td></tr>`).join("")
    : `<tr><td colspan="7" class="muted">No spot buys/sells found yet for this wallet.</td></tr>`;

  $("spotTransfersTable").innerHTML = state.spotTransfers.length
    ? state.spotTransfers.slice(0, 80).map((t) => `<tr><td>${new Date(t.time).toLocaleString()}</td><td class="${t.type === "Deposit" ? "pnl-positive" : "pnl-loss"}">${t.type}</td><td>${t.token}</td><td class="${t.type === "Deposit" ? "pnl-positive" : "pnl-loss"}">${formatUsd(t.signedAmount)}</td><td>${short(String(t.txHash))}</td></tr>`).join("")
    : `<tr><td colspan="5" class="muted">No spot deposit/withdraw history found yet. Source: ${state.spotTransferSource || "searching..."}.</td></tr>`;

  $("transfersTable").innerHTML = state.transfers.length
    ? state.transfers.slice(0, 80).map((t) => `<tr><td>${new Date(t.time).toLocaleString()}</td><td class="${t.type === "Deposit" ? "pnl-positive" : "pnl-loss"}">${t.type}</td><td>${t.token}</td><td class="${t.type === "Deposit" ? "pnl-positive" : "pnl-loss"}">${formatUsd(t.signedAmount)}</td><td>${short(String(t.txHash))}</td></tr>`).join("")
    : `<tr><td colspan="5" class="muted">No deposit/withdrawal history found yet. Source: ${state.transferSource || "searching..."}.</td></tr>`;

  const risk = Math.min(100, marginUsage + Math.abs(unrealized) / 10000);
  $("riskBar").style.width = `${risk}%`;
  $("riskText").textContent = risk > 80 ? "Critical" : risk > 60 ? "High" : risk > 35 ? "Elevated" : "Calm";
  $("riskText").className = `metric-value ${risk > 60 ? "pnl-loss" : "pnl-positive"}`;
}

function startForWallet(walletInput) {
  const wallet = walletInput.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    $("status").textContent = "Please enter a valid EVM wallet address.";
    return;
  }

  state.wallet = wallet;
  state.positionsBySymbol.clear();
  state.trades = [];
  state.orders = [];
  state.transfers = [];
  state.transferSource = "";
  state.spotTrades = [];
  state.spotTransfers = [];
  state.spotTransferSource = "";
  render();
  backfillFromRest(wallet);
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
