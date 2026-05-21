// ===================================================
// BACKTEST ENGINE — EMA 20/50 + ATR SL + Portfolio
// ===================================================

const BT = { trades: [], loading: false, mode: 'single' };

const C = {
  green:'#00d4a0', red:'#ff4d6a',
  grid:'rgba(255,255,255,0.04)',
  text:'#e8ecf4', textDim:'#8a90a4', textMuted:'#4a5068',
};

const PATTERN_NAMES = {
  bullHammer:'Hammer ↑', bullEngulfing:'Engulfing ↑',
  pinBarBull:'Pin Bar ↑', dojiStar:'Doji',
  bearEngulfing:'Engulfing ↓', shootingStar:'Shooting Star',
  hangingMan:'Hanging Man',
};

const INTERVAL_MS = {
  '1m':60_000,'3m':180_000,'5m':300_000,'15m':900_000,'30m':1_800_000,
  '1h':3_600_000,'2h':7_200_000,'4h':14_400_000,'6h':21_600_000,
  '8h':28_800_000,'12h':43_200_000,'1d':86_400_000,'3d':259_200_000,
  '1w':604_800_000,
};

const LOCAL_API = `http://localhost:${location.port || 8765}/api`;

// ============================================
// SYMBOL SEARCH
// ============================================
const SS = { symbols: [], dbSet: new Set(), loaded: false, active: -1 };
let _ssTimeout = null;

async function initSymbolSearch() {
  const input = document.getElementById('btSymbol');
  const drop  = document.getElementById('symbolDropdown');
  if (!input || !drop) return;

  fetchMeta().then(list => {
    list.forEach(r => SS.dbSet.add(r.symbol));
  }).catch(() => {});

  loadBinanceSymbols().catch(() => {});

  input.addEventListener('focus', () => {
    const v = input.value.trim();
    if (v.length >= 1 || SS.symbols.length > 0) showDropdown(v);
  });
  input.addEventListener('input', () => {
    clearTimeout(_ssTimeout);
    _ssTimeout = setTimeout(() => showDropdown(input.value.trim()), 150);
  });
  input.addEventListener('keydown', e => {
    const items = drop.querySelectorAll('.sym-item');
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      SS.active = Math.min(SS.active + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('active', i === SS.active));
      items[SS.active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      SS.active = Math.max(SS.active - 1, 0);
      items.forEach((el, i) => el.classList.toggle('active', i === SS.active));
      items[SS.active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = drop.querySelector('.sym-item.active') || drop.querySelector('.sym-item');
      if (active) selectSymbol(active.dataset.symbol);
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  });
  document.addEventListener('click', e => {
    if (!document.getElementById('symbolSearchWrap')?.contains(e.target)) closeDropdown();
  });
}

async function loadBinanceSymbols() {
  if (SS.loaded) return;
  const cached = localStorage.getItem('binance_symbols');
  if (cached) {
    try {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < 3_600_000) { SS.symbols = data; SS.loaded = true; return; }
    } catch(e) {}
  }
  try {
    const res = await fetch(`${LOCAL_API}/symbols`);
    if (!res.ok) return;
    SS.symbols = await res.json();
    SS.loaded = true;
    localStorage.setItem('binance_symbols', JSON.stringify({ data: SS.symbols, ts: Date.now() }));
  } catch(e) {}
}

function showDropdown(query) {
  const drop = document.getElementById('symbolDropdown');
  SS.active  = -1;
  const q    = query.toUpperCase().replace('/USDT','').replace('USDT','');

  let results = SS.symbols.length
    ? SS.symbols.filter(s => s.base.startsWith(q) || s.symbol.includes(q)).slice(0, 40)
    : [];

  if (!results.length && SS.dbSet.size > 0) {
    const dbList = [...SS.dbSet].filter(s => s.includes(q));
    results = dbList.map(sym => ({ symbol: sym, base: sym.replace('USDT',''), volume: 0, price: 0, change: 0 }));
  }

  if (!results.length && !SS.loaded) {
    drop.innerHTML = '<div class="sym-loading">⏳ Đang tải danh sách...</div>';
    drop.classList.add('open');
    loadBinanceSymbols().then(() => showDropdown(query));
    return;
  }
  if (!results.length) {
    drop.innerHTML = '<div class="sym-empty">Không tìm thấy coin</div>';
    drop.classList.add('open'); return;
  }

  drop.innerHTML = results.map(s => {
    const inDB   = SS.dbSet.has(s.symbol);
    const badge  = inDB ? '<span class="sym-badge in-db">● DB</span>' : '<span class="sym-badge not-db">↓ Tải</span>';
    const chg    = s.change >= 0 ? '+' : '';
    const chgCls = s.change >= 0 ? 'pos' : 'neg';
    const price  = s.price > 0 ? (s.price >= 1 ? '$'+s.price.toFixed(2) : '$'+s.price.toFixed(5)) : '';
    const vol    = s.volume > 1e9 ? (s.volume/1e9).toFixed(1)+'B' : s.volume > 1e6 ? (s.volume/1e6).toFixed(0)+'M' : '';
    return `
    <div class="sym-item" data-symbol="${s.symbol}" onclick="selectSymbol('${s.symbol}')">
      <div class="sym-left">
        <div>
          <div class="sym-name">${s.base}</div>
          <div class="sym-full">${vol ? 'Vol: '+vol : ''}</div>
        </div>
        ${badge}
      </div>
      <div class="sym-right">
        <div class="sym-price">${price}</div>
        ${s.change !== 0 ? `<div class="sym-change ${chgCls}">${chg}${s.change.toFixed(2)}%</div>` : ''}
      </div>
    </div>`;
  }).join('');
  drop.classList.add('open');
}

function selectSymbol(symbol) {
  document.getElementById('btSymbol').value = symbol;
  closeDropdown();
}
function closeDropdown() {
  document.getElementById('symbolDropdown')?.classList.remove('open');
  SS.active = -1;
}

// ============================================
// AUTO-DOWNLOAD (SSE)
// ============================================
let _dlController = null;

async function autoDownloadSymbol(symbol, interval) {
  return new Promise((resolve, reject) => {
    const overlay  = document.getElementById('dlOverlay');
    const titleEl  = document.getElementById('dlTitle');
    const subEl    = document.getElementById('dlSub');
    const barEl    = document.getElementById('dlProgressBar');
    const statsEl  = document.getElementById('dlStats');

    titleEl.textContent = `Tải dữ liệu ${symbol.replace('USDT','/USDT')}`;
    subEl.textContent   = `Kết nối Binance API...`;
    barEl.style.width   = '2%';
    statsEl.textContent = '0 nến';
    overlay.classList.add('active');

    const url = `${LOCAL_API}/download?symbol=${symbol}&interval=${interval}`;
    const es  = new EventSource(url);
    _dlController = es;

    es.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.type === 'start') {
        subEl.textContent = `${d.mode} · ước tính ${d.estBatches} batch`;
        barEl.style.width = '5%';
      } else if (d.type === 'progress') {
        barEl.style.width = d.pct + '%';
        subEl.textContent = `Batch ${d.batch}/${d.total} · ${d.pct}%`;
        statsEl.textContent = `${d.candles.toLocaleString()} nến`;
      } else if (d.type === 'done') {
        barEl.style.width = '100%';
        statsEl.textContent = d.msg;
        subEl.textContent = '';
        SS.dbSet.add(symbol);
        setTimeout(() => {
          overlay.classList.remove('active');
          es.close(); _dlController = null;
          resolve(d.candles);
        }, 800);
      } else if (d.type === 'error') {
        overlay.classList.remove('active');
        es.close(); _dlController = null;
        reject(new Error(d.msg));
      }
    };
    es.onerror = () => {
      overlay.classList.remove('active');
      es.close(); _dlController = null;
      reject(new Error('Mất kết nối server'));
    };
  });
}

function cancelDownload() {
  if (_dlController) { _dlController.close(); _dlController = null; }
  document.getElementById('dlOverlay').classList.remove('active');
  BT.loading = false;
  document.getElementById('btnRun').disabled = false;
  document.getElementById('btnRunText').textContent = '▶ Chạy Backtest';
}

// ============================================
// LOCAL API
// ============================================
async function fetchFromLocalDB(symbol, interval, startTimeMs, endTimeMs, onProgress) {
  onProgress?.(-1, 0, `⬇ Đọc dữ liệu từ DB local...`);
  const params = new URLSearchParams({ symbol, interval });
  if (startTimeMs) params.set('startTime', startTimeMs);
  if (endTimeMs)   params.set('endTime',   endTimeMs);

  const res = await fetch(`${LOCAL_API}/klines?${params}`);
  if (res.status === 404) {
    const err = await res.json().catch(() => ({ error: 'NO_DATA' }));
    if (err.error?.startsWith('NO_DATA')) throw { code: 'NO_DATA', symbol, interval };
    throw new Error(err.error || 'Không có dữ liệu');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  onProgress?.(100, data.length, `✅ ${data.length.toLocaleString()} nến từ DB`);
  return data;
}

async function fetchMeta() {
  const res = await fetch(`${LOCAL_API}/meta`);
  if (!res.ok) return [];
  return await res.json();
}

function rangeToMs(range) {
  const n = parseInt(range), u = range.slice(-1), D = 86_400_000;
  return u === 'm' ? n * 30 * D : n * 365 * D;
}

async function loadCandles(symbol, interval, startTimeMs, onProgress) {
  const endTimeMs = Date.now();
  try {
    return await fetchFromLocalDB(symbol, interval, startTimeMs, endTimeMs, onProgress);
  } catch(e) {
    if (e.code === 'NO_DATA') {
      onProgress?.(-1, 0, `⬇ Chưa có dữ liệu — đang tải từ Binance...`);
      await autoDownloadSymbol(symbol, interval);
      return await fetchFromLocalDB(symbol, interval, startTimeMs, endTimeMs, onProgress);
    }
    throw e;
  }
}

// ============================================
// EMA
// ============================================
function calcEMA(candles, period) {
  const k = 2 / (period + 1);
  const ema = []; let prev = null;
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { ema.push(null); continue; }
    if (i === period - 1) {
      prev = candles.slice(0, period).reduce((a, c) => a + c.close, 0) / period;
      ema.push(prev); continue;
    }
    prev = candles[i].close * k + prev * (1 - k);
    ema.push(prev);
  }
  return ema;
}

// ============================================
// ATR (Wilder's RMA)
// ============================================
function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return candles.map(() => null);
  const atr = new Array(candles.length).fill(null);

  let sumTR = 0;
  for (let i = 1; i <= period; i++) {
    const c = candles[i], p = candles[i-1];
    sumTR += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  atr[period] = sumTR / period;

  for (let i = period + 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i-1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    atr[i] = (atr[i-1] * (period - 1) + tr) / period;
  }
  return atr;
}

// ============================================
// SCAN CROSSOVERS
// ============================================
function scanCrossovers(ema20, ema50) {
  const cx = [];
  for (let i = 51; i < ema20.length - 1; i++) {
    if (!ema20[i] || !ema50[i] || !ema20[i-1] || !ema50[i-1]) continue;
    const bull = ema20[i-1] <= ema50[i-1] && ema20[i] > ema50[i];
    const bear = ema20[i-1] >= ema50[i-1] && ema20[i] < ema50[i];
    if (bull || bear) cx.push({ index: i, type: bull ? 'bull' : 'bear' });
  }
  return cx;
}

// ============================================
// RETEST
// ============================================
function findRetest(candles, ema20, ema50, crossIdx, crossType, nextCrossIdx) {
  const end = Math.min(nextCrossIdx ?? candles.length, crossIdx + 60);
  for (let i = crossIdx + 2; i < end; i++) {
    const c = candles[i]; const e20 = ema20[i], e50 = ema50[i];
    if (!e20 || !e50) continue;
    const tol = c.close * 0.004;
    if ((c.low <= e20 + tol && c.high >= e20 - tol) ||
        (c.low <= e50 + tol && c.high >= e50 - tol))
      return { index: i };
  }
  return null;
}

// ============================================
// PATTERN DETECTION
// ============================================
function detectPattern(candles, idx, crossType) {
  const c = candles[idx]; if (!c) return null;
  const body  = Math.abs(c.close - c.open);
  const total = c.high - c.low;
  const lower = Math.min(c.open, c.close) - c.low;
  const upper = c.high - Math.max(c.open, c.close);
  if (total < 1e-10) return null;
  if (lower / total > 0.6 && crossType === 'bull') return 'pinBarBull';
  if (body > 0 && lower >= body * 2 && upper < body * 0.5) return crossType === 'bull' ? 'bullHammer' : 'hangingMan';
  if (body > 0 && upper >= body * 2 && lower < body * 0.5 && crossType === 'bear') return 'shootingStar';
  if (body / total < 0.08) return 'dojiStar';
  if (idx > 0) {
    const p = candles[idx-1], pb = Math.abs(p.close - p.open);
    if (crossType === 'bull' && p.close < p.open && c.close > c.open && body > pb * 1.1) return 'bullEngulfing';
    if (crossType === 'bear' && p.close > p.open && c.close < c.open && body > pb * 1.1) return 'bearEngulfing';
  }
  return crossType === 'bull' ? 'bullHammer' : 'shootingStar';
}

// ============================================
// SIMULATE TRADE (Fixed % hoặc ATR SL)
// ============================================
function simulateTrade(candles, sigIdx, crossType, slMode, slValue, atrArr, rrRatio, capital) {
  const entry = candles[sigIdx]?.close; if (!entry) return null;
  const isBuy = crossType === 'bull';

  let slDist;
  if (slMode === 'atr') {
    const atrVal = atrArr?.[sigIdx] || entry * 0.02;
    slDist = atrVal * slValue; // slValue = ATR multiplier
  } else {
    slDist = entry * slValue;  // slValue = SL percentage (e.g. 0.02)
  }
  if (slDist <= 0) return null;

  const sl       = isBuy ? entry - slDist : entry + slDist;
  const tp       = isBuy ? entry + slDist * rrRatio : entry - slDist * rrRatio;
  const posSize  = (capital * 0.02) / slDist;
  const posValue = posSize * entry;

  for (let i = sigIdx + 1; i < Math.min(sigIdx + 80, candles.length); i++) {
    const c = candles[i];
    const hitSL = isBuy ? c.low <= sl  : c.high >= sl;
    const hitTP = isBuy ? c.high >= tp : c.low  <= tp;
    if (hitSL || hitTP) {
      const result  = hitTP && !hitSL ? 'WIN' : 'LOSS';
      const exitPx  = result === 'WIN' ? tp : sl;
      const pnl     = isBuy ? (exitPx - entry) * posSize : (entry - exitPx) * posSize;
      const holdBars = i - sigIdx;
      return {
        entryTime: candles[sigIdx].time, exitTime: c.time,
        type: isBuy ? 'BUY' : 'SELL', entry, sl, tp, exitPrice: exitPx,
        result, pnl: +pnl.toFixed(2), pnlPct: +((pnl/posValue)*100).toFixed(2),
        holdBars, slDist, slMode,
      };
    }
  }
  const last      = candles[Math.min(sigIdx + 80, candles.length - 1)];
  const pnl       = isBuy ? (last.close - entry) * posSize : (entry - last.close) * posSize;
  const holdBars  = Math.min(sigIdx + 80, candles.length - 1) - sigIdx;
  return {
    entryTime: candles[sigIdx].time, exitTime: last.time,
    type: isBuy ? 'BUY' : 'SELL', entry, sl, tp, exitPrice: last.close,
    result: pnl >= 0 ? 'WIN' : 'LOSS', pnl: +pnl.toFixed(2), pnlPct: +((pnl/posValue)*100).toFixed(2),
    holdBars, slDist, slMode,
  };
}

// ============================================
// RUN SINGLE SYMBOL
// ============================================
function runSymbolBacktest(candles, params) {
  const { slMode, slValue, atrPeriod, rrRatio, capital } = params;
  const ema20  = calcEMA(candles, 20);
  const ema50  = calcEMA(candles, 50);
  const atrArr = slMode === 'atr' ? calcATR(candles, atrPeriod) : null;
  const cxs    = scanCrossovers(ema20, ema50);

  const trades = []; let cap = capital;
  cxs.forEach((cx, ci) => {
    const nextCx  = cxs[ci + 1];
    const rt      = findRetest(candles, ema20, ema50, cx.index, cx.type, nextCx?.index);
    if (!rt) return;
    const pattern = detectPattern(candles, rt.index, cx.type);
    if (!pattern) return;
    const sigIdx  = Math.min(rt.index + 1, candles.length - 1);
    const trade   = simulateTrade(candles, sigIdx, cx.type, slMode, slValue, atrArr, rrRatio, cap);
    if (!trade) return;
    trade.pattern = pattern;
    trades.push(trade);
    cap += trade.pnl;
  });
  return trades;
}

// ============================================
// METRICS (extended)
// ============================================
function calcMetrics(trades, capital) {
  if (!trades.length) return null;
  const wins    = trades.filter(t => t.result === 'WIN');
  const losses  = trades.filter(t => t.result === 'LOSS');
  const tW      = wins.reduce((s,t) => s + t.pnl, 0);
  const tL      = Math.abs(losses.reduce((s,t) => s + t.pnl, 0));
  let equity = capital, peak = capital, maxDD = 0;
  const curve = [capital];
  let winStreak = 0, lossStreak = 0, maxWin = 0, maxLoss = 0;
  trades.forEach(t => {
    equity += t.pnl; curve.push(equity);
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak * 100 : 0;
    if (dd > maxDD) maxDD = dd;
    if (t.result === 'WIN') { winStreak++; lossStreak = 0; maxWin = Math.max(maxWin, winStreak); }
    else { lossStreak++; winStreak = 0; maxLoss = Math.max(maxLoss, lossStreak); }
  });

  const avgHold = trades.reduce((s, t) => s + (t.holdBars || 0), 0) / trades.length;
  const totalPnL = trades.reduce((s,t) => s + t.pnl, 0);
  const pf = tL > 0 ? tW / tL : tW > 0 ? 999 : 0;
  const expectancy = (wins.length/trades.length * (tW/(wins.length||1))) - (losses.length/trades.length * (tL/(losses.length||1)));

  // Monthly returns for Sharpe
  const monthly = calcMonthlyBreakdown(trades);
  const mReturns = monthly.map(m => m.pnl / capital * 100);
  let sharpe = 0, sortino = 0;
  if (mReturns.length >= 2) {
    const avg = mReturns.reduce((a,b) => a+b, 0) / mReturns.length;
    const std = Math.sqrt(mReturns.reduce((a,b) => a+(b-avg)**2, 0) / mReturns.length);
    sharpe = std > 0 ? +(avg / std * Math.sqrt(12)).toFixed(2) : 0;
    const negR = mReturns.filter(r => r < 0);
    const downStd = negR.length > 0 ? Math.sqrt(negR.reduce((a,b) => a+b**2, 0) / negR.length) : 0;
    sortino = downStd > 0 ? +(avg / downStd * Math.sqrt(12)).toFixed(2) : 0;
  }

  const recoveryFactor = maxDD > 0 ? +(totalPnL / (capital * maxDD / 100)).toFixed(2) : '∞';

  return {
    total: trades.length, wins: wins.length, losses: losses.length,
    winRate: wins.length / trades.length * 100,
    profitFactor: pf, totalPnL,
    finalCapital: equity, maxDrawdown: maxDD,
    avgWin: wins.length ? tW / wins.length : 0,
    avgLoss: losses.length ? tL / losses.length : 0,
    maxWinStreak: maxWin, maxLossStreak: maxLoss,
    equityCurve: curve, avgHold: +avgHold.toFixed(1),
    sharpe, sortino, recoveryFactor,
    expectancy: +expectancy.toFixed(2), monthly,
  };
}

// ============================================
// MONTHLY BREAKDOWN
// ============================================
function calcMonthlyBreakdown(trades) {
  const byMonth = {};
  trades.forEach(t => {
    const d   = new Date(t.entryTime);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (!byMonth[key]) byMonth[key] = { pnl: 0, wins: 0, losses: 0, total: 0 };
    byMonth[key].pnl += t.pnl;
    byMonth[key][t.result === 'WIN' ? 'wins' : 'losses']++;
    byMonth[key].total++;
  });
  return Object.entries(byMonth).sort(([a],[b]) => a.localeCompare(b))
    .map(([k, v]) => ({ month: k, ...v, wr: v.total > 0 ? v.wins/v.total*100 : 0 }));
}

// ============================================
// PATTERN PERFORMANCE
// ============================================
function calcPatternStats(trades) {
  const byPattern = {};
  trades.forEach(t => {
    if (!t.pattern) return;
    const key = t.pattern;
    if (!byPattern[key]) byPattern[key] = { wins: 0, losses: 0, pnl: 0 };
    byPattern[key][t.result === 'WIN' ? 'wins' : 'losses']++;
    byPattern[key].pnl += t.pnl;
  });
  return Object.entries(byPattern).map(([k, v]) => ({
    pattern: k, name: PATTERN_NAMES[k] || k,
    total: v.wins + v.losses, wins: v.wins, losses: v.losses,
    wr: (v.wins / (v.wins + v.losses)) * 100,
    pnl: v.pnl,
    avgPnl: v.pnl / (v.wins + v.losses),
  })).sort((a, b) => b.pnl - a.pnl);
}

// ============================================
// RENDER EQUITY CURVE
// ============================================
function renderEquityCurve(curve, trades) {
  const canvas = document.getElementById('equityCanvas');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.parentElement.offsetWidth - 32, H = 240;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const PAD = { top:24, right:24, bottom:40, left:82 };
  const cW = W - PAD.left - PAD.right, cH = H - PAD.top - PAD.bottom;
  const minE = Math.min(...curve) * 0.997, maxE = Math.max(...curve) * 1.003;
  const range = maxE - minE || 1;
  const toX = i => PAD.left + (i / (curve.length - 1)) * cW;
  const toY = v => PAD.top + cH - ((v - minE) / range) * cH;

  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = PAD.top + (g / 4) * cH;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
    const val = maxE - (g / 4) * range;
    ctx.fillStyle = C.textMuted; ctx.font = '10px JetBrains Mono,monospace'; ctx.textAlign = 'right';
    ctx.fillText('$' + Math.round(val).toLocaleString(), PAD.left - 5, y + 4);
  }

  ctx.beginPath(); ctx.moveTo(toX(0), toY(curve[0]));
  curve.forEach((v,i) => ctx.lineTo(toX(i), toY(v)));
  ctx.lineTo(toX(curve.length - 1), PAD.top + cH);
  ctx.lineTo(PAD.left, PAD.top + cH); ctx.closePath();
  const isPos = curve[curve.length - 1] >= curve[0];
  const grd = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
  grd.addColorStop(0, isPos ? 'rgba(0,212,160,0.18)' : 'rgba(255,77,106,0.18)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd; ctx.fill();

  trades.forEach((t,i) => {
    ctx.strokeStyle = t.result === 'WIN' ? C.green : C.red; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(toX(i), toY(curve[i])); ctx.lineTo(toX(i+1), toY(curve[i+1])); ctx.stroke();
  });

  if (trades.length <= 400) {
    trades.forEach((t,i) => {
      const col = t.result === 'WIN' ? C.green : C.red;
      ctx.fillStyle = col; ctx.shadowBlur = 4; ctx.shadowColor = col;
      ctx.beginPath(); ctx.arc(toX(i+1), toY(curve[i+1]), trades.length > 150 ? 1.5 : 3, 0, Math.PI * 2);
      ctx.fill(); ctx.shadowBlur = 0;
    });
  }

  ctx.fillStyle = C.textDim; ctx.beginPath(); ctx.arc(toX(0), toY(curve[0]), 4, 0, Math.PI*2); ctx.fill();

  ctx.fillStyle = C.textMuted; ctx.font = '10px JetBrains Mono,monospace'; ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(trades.length / 8));
  trades.forEach((t,i) => {
    if (i % step !== 0) return;
    const d = new Date(t.entryTime);
    ctx.fillText(`${d.getMonth()+1}/${d.getFullYear().toString().slice(2)}`, toX(i+1), H - PAD.bottom + 16);
  });
}

// ============================================
// RENDER MONTHLY HEATMAP
// ============================================
function renderMonthlyHeatmap(monthly) {
  const wrap = document.getElementById('monthlyHeatmap');
  if (!wrap) return;
  if (!monthly.length) { wrap.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-family:var(--font-mono);font-size:12px">Không đủ dữ liệu</div>'; return; }

  // Group by year
  const years = {};
  monthly.forEach(m => {
    const [y, mo] = m.month.split('-');
    if (!years[y]) years[y] = {};
    years[y][parseInt(mo)] = m;
  });

  const maxAbs = Math.max(...monthly.map(m => Math.abs(m.pnl)));
  const MONTHS  = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'];

  let html = `<div class="heatmap-wrap">
    <div class="heatmap-header">
      <div class="hm-year-col"></div>
      ${MONTHS.map(m => `<div class="hm-month-label">${m}</div>`).join('')}
      <div class="hm-year-label">Năm</div>
    </div>`;

  Object.keys(years).sort().forEach(yr => {
    const data = years[yr];
    let yearPnl = 0, yearTrades = 0;
    const cells = MONTHS.map((_, i) => {
      const mo  = i + 1;
      const d   = data[mo];
      if (!d) return '<div class="hm-cell hm-empty">—</div>';
      yearPnl    += d.pnl;
      yearTrades += d.total;
      const alpha  = maxAbs > 0 ? Math.min(0.85, Math.abs(d.pnl) / maxAbs * 0.85 + 0.05) : 0.1;
      const bg     = d.pnl >= 0 ? `rgba(0,212,160,${alpha})` : `rgba(255,77,106,${alpha})`;
      const sgn    = d.pnl >= 0 ? '+' : '';
      const tip    = `${d.total} lệnh · WR ${d.wr.toFixed(0)}% · ${sgn}$${Math.abs(d.pnl).toFixed(0)}`;
      return `<div class="hm-cell" style="background:${bg}" title="${tip}">
        <span class="hm-pnl">${sgn}$${Math.abs(d.pnl) < 1000 ? Math.abs(d.pnl).toFixed(0) : (Math.abs(d.pnl)/1000).toFixed(1)+'k'}</span>
        <span class="hm-wr">${d.wr.toFixed(0)}%</span>
      </div>`;
    });

    const ysgn   = yearPnl >= 0 ? '+' : '';
    const ybg    = yearPnl >= 0 ? 'rgba(0,212,160,0.15)' : 'rgba(255,77,106,0.15)';
    const ycol   = yearPnl >= 0 ? 'var(--green)' : 'var(--red)';
    html += `<div class="heatmap-row">
      <div class="hm-year-col">${yr}</div>
      ${cells.join('')}
      <div class="hm-year-total" style="background:${ybg};color:${ycol}">${ysgn}$${Math.abs(yearPnl).toFixed(0)}</div>
    </div>`;
  });
  html += '</div>';
  wrap.innerHTML = html;
}

// ============================================
// RENDER DISTRIBUTION
// ============================================
function renderDistribution(trades, metrics) {
  const grid = document.getElementById('distGrid');
  grid.innerHTML = '';
  const pCnt = {};
  trades.forEach(t => { if (t.pattern) pCnt[t.pattern] = (pCnt[t.pattern] || 0) + 1; });
  const top   = Object.entries(pCnt).sort((a,b) => b[1]-a[1]).slice(0,5);
  const buys  = trades.filter(t => t.type === 'BUY');
  const sells = trades.filter(t => t.type === 'SELL');

  const cards = [
    { title:'Thắng / Thua', rows:[
      { label:'Thắng', pct:metrics.winRate, val:`${metrics.wins}`, cls:'win-fill' },
      { label:'Thua',  pct:100-metrics.winRate, val:`${metrics.losses}`, cls:'loss-fill' },
    ]},
    { title:'BUY vs SELL', rows:[
      { label:'BUY',  pct:buys.length/trades.length*100, val:`${buys.length} (${buys.filter(t=>t.result==='WIN').length}W)`, cls:'win-fill' },
      { label:'SELL', pct:sells.length/trades.length*100, val:`${sells.length} (${sells.filter(t=>t.result==='WIN').length}W)`, cls:'loss-fill' },
    ]},
    { title:'Pattern', rows: top.map(([k,v]) => ({
      label:(PATTERN_NAMES[k]||k).slice(0,14), pct:(v/trades.length)*100, val:`${v}`, cls:'win-fill',
    }))},
  ];

  cards.forEach(card => {
    const d = document.createElement('div'); d.className = 'dist-card';
    d.innerHTML = `<div class="dist-card-title">${card.title}</div><div class="dist-bar-wrap">${card.rows.map(r=>`
      <div class="dist-bar-row">
        <div class="dist-bar-label">${r.label}</div>
        <div class="dist-bar-track"><div class="dist-bar-fill ${r.cls}" style="width:${Math.max(2,r.pct)}%"></div></div>
        <div class="dist-bar-val">${r.val}</div>
      </div>`).join('')}</div>`;
    grid.appendChild(d);
  });
}

// ============================================
// RENDER PATTERN TABLE
// ============================================
function renderPatternTable(patternStats) {
  const tbody = document.getElementById('patternTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  patternStats.forEach(p => {
    const tr = document.createElement('tr');
    const wrc = p.wr >= 50 ? 'pnl-pos' : 'pnl-neg';
    const pc  = p.pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
    tr.innerHTML = `
      <td style="color:var(--text)">${p.name}</td>
      <td style="color:var(--text-muted)">${p.total}</td>
      <td style="color:var(--green)">${p.wins}</td>
      <td style="color:var(--red)">${p.losses}</td>
      <td class="${wrc}" style="font-weight:600">${p.wr.toFixed(1)}%</td>
      <td class="${p.avgPnl>=0?'pnl-pos':'pnl-neg'}">${p.avgPnl>=0?'+':'-'}$${Math.abs(p.avgPnl).toFixed(2)}</td>
      <td class="${pc}" style="font-weight:700">${p.pnl>=0?'+':'-'}$${Math.abs(p.pnl).toFixed(2)}</td>`;
    tbody.appendChild(tr);
  });
}

// ============================================
// RENDER SYMBOL BREAKDOWN (portfolio)
// ============================================
function renderSymbolBreakdown(perSymbol) {
  const section = document.getElementById('symbolBreakdownSection');
  const tbody   = document.getElementById('symbolTableBody');
  if (!section || !tbody) return;

  const symbols = Object.keys(perSymbol);
  if (symbols.length <= 1) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  tbody.innerHTML = '';

  symbols.forEach(sym => {
    const d = perSymbol[sym];
    if (!d || !d.trades || !d.trades.length) return;
    const m   = d.metrics;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="color:var(--text);font-weight:700">${sym.replace('USDT','/USDT')}</td>
      <td style="color:var(--text-muted)">${d.trades.length}</td>
      <td class="${m.winRate>=50?'pnl-pos':'pnl-neg'}">${m.winRate.toFixed(1)}%</td>
      <td class="${m.profitFactor>=1?'pnl-pos':'pnl-neg'}">${m.profitFactor===999?'∞':m.profitFactor.toFixed(2)}</td>
      <td class="${m.totalPnL>=0?'pnl-pos':'pnl-neg'}" style="font-weight:700">${m.totalPnL>=0?'+':'-'}$${Math.abs(m.totalPnL).toFixed(2)}</td>
      <td style="color:var(--red)">-${m.maxDrawdown.toFixed(1)}%</td>
      <td style="color:var(--text-muted)">${m.avgHold}b</td>
      <td class="${m.sharpe>=1?'pnl-pos':m.sharpe<0?'pnl-neg':''}"">${m.sharpe}</td>`;
    tbody.appendChild(row);
  });
}

// ============================================
// RENDER TRADE TABLE
// ============================================
function renderTradeTable(trades) {
  const tbody = document.getElementById('tradeTableBody'); tbody.innerHTML = '';
  trades.forEach((t,i) => {
    const row = document.createElement('tr');
    row.className = `trade-row ${t.result==='WIN'?'row-win':'row-loss'}`;
    row.dataset.result = t.result.toLowerCase();
    const d  = new Date(t.entryTime);
    const ds = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const isBuy = t.type === 'BUY';
    const pc    = t.pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
    const sg    = t.pnl >= 0 ? '+' : '';
    const slTag = t.slMode === 'atr' ? `ATR×${(t.slDist/1).toFixed?.(0)}` : `${(t.slDist/t.entry*100).toFixed(1)}%`;
    row.innerHTML = `
      <td style="color:var(--text-muted)">${i+1}</td>
      ${t.symbol ? `<td style="color:var(--accent);font-weight:600">${t.symbol.replace('USDT','')}</td>` : ''}
      <td>${ds}</td>
      <td><span class="badge ${isBuy?'badge-buy':'badge-sell'}">${t.type}</span></td>
      <td style="color:var(--text-dim)">${PATTERN_NAMES[t.pattern]||'—'}</td>
      <td>${fmtP(t.entry)}</td><td style="color:var(--red)">${fmtP(t.sl)}</td>
      <td style="color:var(--green)">${fmtP(t.tp)}</td><td>${fmtP(t.exitPrice)}</td>
      <td style="color:var(--text-muted);font-size:10px">${slTag}</td>
      <td>${t.holdBars||'—'}b</td>
      <td><span class="badge ${t.result==='WIN'?'badge-win':'badge-loss'}">${t.result}</span></td>
      <td class="${pc}">${sg}$${Math.abs(t.pnl).toFixed(2)}</td>
      <td class="${pc}">${sg}${t.pnlPct}%</td>`;
    tbody.appendChild(row);
  });
}

// ============================================
// FILTER TRADES
// ============================================
function filterTrades(type, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.trade-row').forEach(row => {
    if (type === 'all') row.classList.remove('row-hidden');
    else row.classList.toggle('row-hidden', row.dataset.result !== type);
  });
}

// ============================================
// FORMAT HELPERS
// ============================================
function fmtP(p) {
  if (!p) return '—';
  return p >= 1000 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p.toFixed(6);
}
function fmtMoney(n) {
  const s = n >= 0 ? '+' : '-';
  return `${s}$${Math.abs(n).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}
function fmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ============================================
// DATA MANAGER UI
// ============================================
async function refreshDataManager() {
  const container = document.getElementById('cacheList');
  const emptyEl   = document.getElementById('cacheEmpty');
  const totalEl   = document.getElementById('cacheTotalSize');
  try {
    const list = await fetchMeta();
    if (!list.length) {
      container.innerHTML = '';
      emptyEl.style.display = 'block';
      totalEl.textContent   = '';
      return;
    }
    emptyEl.style.display = 'none';
    const totalCount = list.reduce((s, r) => s + (r.count || 0), 0);
    totalEl.textContent = `${list.length} dataset · ${totalCount.toLocaleString()} nến tổng cộng`;
    container.innerHTML = list.map(r => {
      const iMs     = INTERVAL_MS[r.interval] || INTERVAL_MS['4h'];
      const isFresh = r.lastTime && (Date.now() - r.lastTime) < iMs * 2;
      const updAt   = r.updatedAt ? r.updatedAt.slice(0, 16).replace('T', ' ') : '—';
      return `
      <div class="cache-row">
        <div class="cache-info">
          <div class="cache-symbol">${r.symbol.replace('USDT','')} <span class="cache-interval">${r.interval}</span></div>
          <div class="cache-meta">${(r.count||0).toLocaleString()} nến &nbsp;·&nbsp; cập nhật: ${updAt}</div>
        </div>
        <div class="cache-status ${isFresh ? 'fresh' : 'stale'}">${isFresh ? '● Mới' : '○ Cũ'}</div>
        <div class="cache-actions"><span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono)">DB local</span></div>
      </div>`;
    }).join('');
  } catch(e) {
    container.innerHTML = `<div class="cache-empty">⚠️ Server chưa sẵn sàng. Chạy: <code>python3 server.py</code></div>`;
    emptyEl.style.display = 'none';
  }
}

// ============================================
// PORTFOLIO MODE — toggle UI
// ============================================
const PORTFOLIO_COINS = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT','LINKUSDT','DOTUSDT'];

function toggleMode(mode) {
  BT.mode = mode;
  document.getElementById('modeSingle').classList.toggle('active', mode === 'single');
  document.getElementById('modePortfolio').classList.toggle('active', mode === 'portfolio');
  document.getElementById('singleSymbolWrap').style.display    = mode === 'single' ? 'flex' : 'none';
  document.getElementById('portfolioCoinsWrap').style.display  = mode === 'portfolio' ? 'flex' : 'none';
}

function initPortfolioChips() {
  const wrap = document.getElementById('portfolioChips');
  if (!wrap) return;
  wrap.innerHTML = PORTFOLIO_COINS.map(sym => {
    const base = sym.replace('USDT', '');
    const checked = ['BTCUSDT','ETHUSDT','BNBUSDT'].includes(sym);
    return `<label class="chip-label ${checked ? 'selected' : ''}" id="chip-${sym}">
      <input type="checkbox" value="${sym}" ${checked ? 'checked' : ''} onchange="toggleChip('${sym}', this)">
      ${base}
    </label>`;
  }).join('');
}

function toggleChip(sym, input) {
  const chip = document.getElementById(`chip-${sym}`);
  if (chip) chip.classList.toggle('selected', input.checked);
}

function getSelectedPortfolioSymbols() {
  const inputs = document.querySelectorAll('#portfolioChips input[type=checkbox]:checked');
  return Array.from(inputs).map(el => el.value);
}

function toggleSLMode(mode) {
  document.getElementById('slModeFixed').classList.toggle('active', mode === 'fixed');
  document.getElementById('slModeATR').classList.toggle('active', mode === 'atr');
  document.getElementById('slFixedWrap').style.display    = mode === 'fixed' ? 'flex' : 'none';
  document.getElementById('slATRWrap').style.display      = mode === 'atr'   ? 'flex' : 'none';
  document.getElementById('slATRMultWrap').style.display  = mode === 'atr'   ? 'flex' : 'none';
}

// ============================================
// RENDER EXTENDED STATS
// ============================================
function renderStats(m, capital) {
  const set = (id, val, colorFn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    if (colorFn) el.style.color = colorFn(val);
  };

  set('statTotal', m.total);
  set('statWinRate', `${m.winRate.toFixed(1)}%`, v => parseFloat(v) >= 50 ? 'var(--green)' : 'var(--red)');
  set('statPF', m.profitFactor === 999 ? '∞' : m.profitFactor.toFixed(2), v => parseFloat(v) >= 1 ? 'var(--green)' : 'var(--red)');
  set('statPnL', fmtMoney(m.totalPnL));
  document.getElementById('statPnL').className = 'stat-value ' + (m.totalPnL >= 0 ? 'green' : 'red');
  set('statFinal', '$' + Math.round(m.finalCapital).toLocaleString());
  document.getElementById('statFinal').style.color = m.finalCapital >= capital ? 'var(--green)' : 'var(--red)';
  set('statDD', `-${m.maxDrawdown.toFixed(1)}%`);
  set('statAvgWin', `+$${m.avgWin.toFixed(2)}`);
  set('statAvgLoss', `-$${m.avgLoss.toFixed(2)}`);
  // Extended
  set('statSharpe', m.sharpe, v => parseFloat(v) >= 1 ? 'var(--green)' : parseFloat(v) < 0 ? 'var(--red)' : 'var(--text)');
  set('statSortino', m.sortino, v => parseFloat(v) >= 1.5 ? 'var(--green)' : parseFloat(v) < 0 ? 'var(--red)' : 'var(--text)');
  set('statRecovery', m.recoveryFactor);
  set('statExpectancy', `${m.expectancy >= 0 ? '+' : ''}$${m.expectancy}`);
  set('statAvgHold', `${m.avgHold}b`);
  set('statMaxLoss', m.maxLossStreak);
  set('statMaxWin', m.maxWinStreak);
}

// ============================================
// MAIN: RUN BACKTEST
// ============================================
async function runBacktest() {
  if (BT.loading) return;
  BT.loading = true;

  const interval = document.getElementById('btInterval').value;
  const range    = document.getElementById('btRange').value;
  const rrRatio  = parseFloat(document.getElementById('btRR').value);
  const capital  = parseFloat(document.getElementById('btCapital').value);
  const startTimeMs = Date.now() - rangeToMs(range);

  // SL params
  const slMode  = document.getElementById('slModeATR').classList.contains('active') ? 'atr' : 'fixed';
  const slValue = slMode === 'atr'
    ? parseFloat(document.getElementById('atrMult').value || 1.5)
    : parseFloat(document.getElementById('btSL').value);
  const atrPeriod = parseInt(document.getElementById('atrPeriod')?.value || 14);

  const params = { slMode, slValue, atrPeriod, rrRatio, capital };

  setLoading(true);

  try {
    let allTrades  = [];
    let perSymbol  = {};

    if (BT.mode === 'portfolio') {
      // ── PORTFOLIO MODE ──────────────────────────────
      const symbols = getSelectedPortfolioSymbols();
      if (symbols.length < 1) {
        showToast('⚠️ Chọn ít nhất 1 coin trong danh mục'); setLoading(false); BT.loading = false; return;
      }
      const perCap = capital / symbols.length;

      for (let i = 0; i < symbols.length; i++) {
        const sym = symbols[i];
        setProgress(Math.round(i / symbols.length * 80), `⏳ ${sym.replace('USDT','/USDT')} (${i+1}/${symbols.length})`);

        const candles = await loadCandles(sym, interval, startTimeMs,
          (pct, cnt, label) => {
            if (pct === -1) setProgress(Math.round(i/symbols.length*80), label);
          });

        const trades = runSymbolBacktest(candles, { ...params, capital: perCap });
        trades.forEach(t => t.symbol = sym);
        const symMetrics = calcMetrics(trades, perCap);
        perSymbol[sym]   = { trades, candles: candles.length, metrics: symMetrics };
        allTrades.push(...trades);
      }

      allTrades.sort((a, b) => a.entryTime - b.entryTime);
      showToast(`⏳ Tính toán metrics...`);
      setProgress(90, 'Tính metrics...');

    } else {
      // ── SINGLE MODE ─────────────────────────────────
      const symbol = document.getElementById('btSymbol').value.toUpperCase().trim();
      showToast(`⏳ Chuẩn bị ${symbol.replace('USDT','/USDT')} ${interval}...`);

      const candles = await loadCandles(symbol, interval, startTimeMs,
        (pct, count, label) => {
          if (pct === -1) { setProgress(0, label); return; }
          setProgress(pct, label || `${count.toLocaleString()} nến`);
        });

      if (candles.length < 100) {
        showToast(`⚠️ Chỉ có ${candles.length} nến — không đủ dữ liệu`);
        setLoading(false); BT.loading = false; return;
      }

      allTrades = runSymbolBacktest(candles, params);
      perSymbol[symbol] = { trades: allTrades, candles: candles.length, metrics: calcMetrics(allTrades, capital) };
      setProgress(80, `✅ ${allTrades.length} tín hiệu`);
    }

    BT.trades = allTrades;
    await refreshDataManager();

    if (!allTrades.length) {
      showToast(`⚠️ Không tìm thấy tín hiệu nào`);
      setLoading(false); BT.loading = false; hideProgress(); return;
    }

    // ── COMPUTE METRICS ─────────────────────────────
    const m = calcMetrics(allTrades, capital);
    const patternStats = calcPatternStats(allTrades);

    // ── UPDATE UI ───────────────────────────────────
    const hasSymbol = Object.keys(perSymbol).length > 0;
    document.getElementById('btCandleCount').textContent =
      `${allTrades.length} lệnh · ${BT.mode === 'portfolio' ? Object.keys(perSymbol).length + ' coin' : Object.keys(perSymbol)[0]?.replace('USDT','/USDT')} · ${interval} · ${range}`;

    document.getElementById('statsBar').style.display = 'block';
    document.getElementById('btMain').style.display   = 'flex';
    document.getElementById('btEmpty').style.display  = 'none';

    renderStats(m, capital);

    setTimeout(() => {
      renderEquityCurve(m.equityCurve, allTrades);
      renderMonthlyHeatmap(m.monthly);
      renderDistribution(allTrades, m);
      renderPatternTable(patternStats);
      renderSymbolBreakdown(perSymbol);
      renderTradeTable(allTrades);
      hideProgress();
    }, 50);

    const pnlStr = m.totalPnL >= 0 ? `+$${m.totalPnL.toFixed(2)}` : `-$${Math.abs(m.totalPnL).toFixed(2)}`;
    showToast(`✅ ${allTrades.length} lệnh · WR ${m.winRate.toFixed(1)}% · PF ${m.profitFactor.toFixed(2)} · ${pnlStr}`);

  } catch(err) {
    console.error(err);
    showToast(`❌ ${err.message || err}`);
    hideProgress();
  } finally {
    setLoading(false);
    BT.loading = false;
  }
}

// ============================================
// UI HELPERS
// ============================================
function setLoading(on) {
  document.getElementById('loadingDot').classList.toggle('active', on);
  document.getElementById('btnRun').disabled = on;
  document.getElementById('btnRunText').textContent = on ? '⏳ Đang chạy...' : '▶ Chạy Backtest';
  if (!on) hideProgress();
}
function setProgress(pct, label) {
  document.getElementById('progressWrap').style.display = 'flex';
  document.getElementById('progressBar').style.width = Math.max(2, pct) + '%';
  document.getElementById('progressLabel').textContent = label || `${pct}%`;
}
function hideProgress() {
  setTimeout(() => { document.getElementById('progressWrap').style.display = 'none'; }, 600);
}
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 6000);
}

let _rt;
window.addEventListener('resize', () => {
  clearTimeout(_rt); _rt = setTimeout(() => {
    if (!BT.trades.length) return;
    const m = calcMetrics(BT.trades, parseFloat(document.getElementById('btCapital').value));
    if (m) renderEquityCurve(m.equityCurve, BT.trades);
  }, 200);
});

window.addEventListener('DOMContentLoaded', () => {
  initSymbolSearch();
  initPortfolioChips();
  refreshDataManager();
  // Default SL mode = fixed
  toggleSLMode('fixed');
  toggleMode('single');
});
