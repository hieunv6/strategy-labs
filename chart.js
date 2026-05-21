// ===================================================
// EMA STRATEGY VISUALIZER — BINANCE LIVE DATA ENGINE
// Nguồn: Binance Public API (không cần API key)
// Endpoint: https://api.binance.com/api/v3/klines
// ===================================================

const ctx = {
  symbol: 'BTCUSDT',
  interval: '4h',
  limit: 200,
  data: null,
  loading: false,
};

// Color palette
const C = {
  bg: '#10121a',
  bg3: '#161924',
  border: 'rgba(255,255,255,0.07)',
  text: '#e8ecf4',
  textDim: '#8a90a4',
  textMuted: '#4a5068',
  ema20: '#f5c842',
  ema50: '#4a9eff',
  bull: '#00d4a0',
  bear: '#ff4d6a',
  green: '#00d4a0',
  red: '#ff4d6a',
  grid: 'rgba(255,255,255,0.04)',
};

// ============================================
// CANDLE PATTERNS DEFINITIONS
// ============================================
const CANDLE_PATTERNS = {
  bullHammer: {
    name: 'Hammer (Bullish)',
    type: 'bull',
    desc: 'Bóng dưới dài gấp 2-3 lần thân nến. Xuất hiện cuối downtrend tại vùng hỗ trợ EMA.',
    draw: (c, x, y, w, h) => {
      const bw = w * 0.4, bh = h * 0.2;
      const bx = x - bw / 2, by = y + h * 0.1;
      c.strokeStyle = C.green; c.fillStyle = C.green + '44'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x, y + h * 0.1); c.lineTo(x, by); c.stroke();
      c.fillRect(bx, by, bw, bh); c.strokeRect(bx, by, bw, bh);
      c.beginPath(); c.moveTo(x, by + bh); c.lineTo(x, y + h * 0.9); c.stroke();
    }
  },
  bullEngulfing: {
    name: 'Bullish Engulfing',
    type: 'bull',
    desc: 'Nến xanh to nuốt hoàn toàn nến đỏ trước. Tín hiệu đảo chiều tăng rất mạnh.',
    draw: (c, x, y, w, h) => {
      const cx1 = x - w * 0.18, cx2 = x + w * 0.15;
      c.fillStyle = C.red + '66'; c.strokeStyle = C.red; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(cx1, y + h * 0.3); c.lineTo(cx1, y + h * 0.35); c.stroke();
      c.fillRect(cx1 - w * 0.1, y + h * 0.35, w * 0.2, h * 0.3);
      c.strokeRect(cx1 - w * 0.1, y + h * 0.35, w * 0.2, h * 0.3);
      c.beginPath(); c.moveTo(cx1, y + h * 0.65); c.lineTo(cx1, y + h * 0.7); c.stroke();
      c.fillStyle = C.green + '66'; c.strokeStyle = C.green;
      c.beginPath(); c.moveTo(cx2, y + h * 0.22); c.lineTo(cx2, y + h * 0.28); c.stroke();
      c.fillRect(cx2 - w * 0.12, y + h * 0.28, w * 0.24, h * 0.5);
      c.strokeRect(cx2 - w * 0.12, y + h * 0.28, w * 0.24, h * 0.5);
      c.beginPath(); c.moveTo(cx2, y + h * 0.78); c.lineTo(cx2, y + h * 0.82); c.stroke();
    }
  },
  pinBarBull: {
    name: 'Pin Bar (Bullish)',
    type: 'bull',
    desc: 'Bóng dưới rất dài, thân nến nhỏ ở trên. Rejection mạnh tại vùng EMA.',
    draw: (c, x, y, w, h) => {
      const bw = w * 0.35, bh = h * 0.12;
      const bx = x - bw / 2, by = y + h * 0.1;
      c.strokeStyle = C.green; c.fillStyle = C.green + '55'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x, y + h * 0.1); c.lineTo(x, by + bh * 0.5); c.stroke();
      c.fillRect(bx, by, bw, bh); c.strokeRect(bx, by, bw, bh);
      c.beginPath(); c.moveTo(x, by + bh); c.lineTo(x, y + h * 0.92); c.stroke();
    }
  },
  dojiStar: {
    name: 'Doji Star',
    type: 'neutral',
    desc: 'Giá mở và đóng gần như bằng nhau. Thể hiện sự do dự và khả năng đảo chiều cao.',
    draw: (c, x, y, w, h) => {
      const by = y + h * 0.48, bh = h * 0.04, bw = w * 0.4;
      c.strokeStyle = C.textDim; c.fillStyle = C.textDim + '44'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x, y + h * 0.15); c.lineTo(x, by); c.stroke();
      c.fillRect(x - bw / 2, by, bw, bh); c.strokeRect(x - bw / 2, by, bw, bh);
      c.beginPath(); c.moveTo(x, by + bh); c.lineTo(x, y + h * 0.85); c.stroke();
    }
  },
  bearEngulfing: {
    name: 'Bearish Engulfing',
    type: 'bear',
    desc: 'Nến đỏ to nuốt hoàn toàn nến xanh trước. Tín hiệu đảo chiều giảm rất mạnh.',
    draw: (c, x, y, w, h) => {
      const cx1 = x - w * 0.18, cx2 = x + w * 0.15;
      c.fillStyle = C.green + '66'; c.strokeStyle = C.green; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(cx1, y + h * 0.3); c.lineTo(cx1, y + h * 0.35); c.stroke();
      c.fillRect(cx1 - w * 0.1, y + h * 0.35, w * 0.2, h * 0.3);
      c.strokeRect(cx1 - w * 0.1, y + h * 0.35, w * 0.2, h * 0.3);
      c.beginPath(); c.moveTo(cx1, y + h * 0.65); c.lineTo(cx1, y + h * 0.7); c.stroke();
      c.fillStyle = C.red + '66'; c.strokeStyle = C.red;
      c.beginPath(); c.moveTo(cx2, y + h * 0.22); c.lineTo(cx2, y + h * 0.28); c.stroke();
      c.fillRect(cx2 - w * 0.12, y + h * 0.28, w * 0.24, h * 0.5);
      c.strokeRect(cx2 - w * 0.12, y + h * 0.28, w * 0.24, h * 0.5);
      c.beginPath(); c.moveTo(cx2, y + h * 0.78); c.lineTo(cx2, y + h * 0.82); c.stroke();
    }
  },
  shootingStar: {
    name: 'Shooting Star',
    type: 'bear',
    desc: 'Bóng trên rất dài, thân nhỏ ở dưới. Tín hiệu rejection mạnh và đảo chiều giảm.',
    draw: (c, x, y, w, h) => {
      const bw = w * 0.35, bh = h * 0.12;
      const bx = x - bw / 2, by = y + h * 0.78;
      c.strokeStyle = C.red; c.fillStyle = C.red + '55'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x, y + h * 0.1); c.lineTo(x, by); c.stroke();
      c.fillRect(bx, by, bw, bh); c.strokeRect(bx, by, bw, bh);
      c.beginPath(); c.moveTo(x, by + bh); c.lineTo(x, y + h * 0.92); c.stroke();
    }
  },
  hangingMan: {
    name: 'Hanging Man',
    type: 'bear',
    desc: 'Giống Hammer nhưng xuất hiện trong uptrend. Cảnh báo đảo chiều giảm.',
    draw: (c, x, y, w, h) => {
      const bw = w * 0.4, bh = h * 0.2;
      const bx = x - bw / 2, by = y + h * 0.1;
      c.strokeStyle = C.red; c.fillStyle = C.red + '44'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x, y + h * 0.1); c.lineTo(x, by); c.stroke();
      c.fillRect(bx, by, bw, bh); c.strokeRect(bx, by, bw, bh);
      c.beginPath(); c.moveTo(x, by + bh); c.lineTo(x, y + h * 0.9); c.stroke();
    }
  },
  morningStar: {
    name: 'Morning Star',
    type: 'bull',
    desc: '3 nến: nến đỏ lớn → doji nhỏ → nến xanh lớn. Đảo chiều tăng mạnh.',
    draw: (c, x, y, w, h) => {
      const positions = [x - w * 0.28, x, x + w * 0.28];
      const colors = [C.red, C.textDim, C.green];
      const heights = [h * 0.4, h * 0.1, h * 0.4];
      const tops = [y + h * 0.1, y + h * 0.43, y + h * 0.1];
      positions.forEach((px, i) => {
        c.fillStyle = colors[i] + '55'; c.strokeStyle = colors[i]; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(px, tops[i] - h * 0.05); c.lineTo(px, tops[i]); c.stroke();
        c.fillRect(px - w * 0.1, tops[i], w * 0.2, heights[i]);
        c.strokeRect(px - w * 0.1, tops[i], w * 0.2, heights[i]);
        c.beginPath(); c.moveTo(px, tops[i] + heights[i]); c.lineTo(px, tops[i] + heights[i] + h * 0.05); c.stroke();
      });
    }
  },
};

// ============================================
// BINANCE API — LẤY DỮ LIỆU THẬT
// ============================================
// Binance Public API: https://api.binance.com/api/v3/klines
// Mỗi kline trả về: [openTime, open, high, low, close, volume, closeTime, ...]

async function fetchBinanceKlines(symbol, interval, limit) {
  // Thử Binance trực tiếp trước
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API lỗi: ${res.status}`);
  const raw = await res.json();

  return raw.map(k => ({
    time: k[0],           // Open time (ms)
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

// Format thời gian từ timestamp
function formatTime(ms, interval) {
  const d = new Date(ms);
  if (interval === '1d' || interval === '1w') {
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }
  return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Format giá (tự động chọn decimal)
function fmtPrice(p) {
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

// ============================================
// EMA CALCULATION
// ============================================
function calcEMA(candles, period) {
  const k = 2 / (period + 1);
  const ema = [];
  let prev = null;
  for (let i = 0; i < candles.length; i++) {
    const price = candles[i].close;
    if (i < period - 1) {
      ema.push(null);
    } else if (i === period - 1) {
      const sum = candles.slice(0, period).reduce((a, c) => a + c.close, 0);
      prev = sum / period;
      ema.push(prev);
    } else {
      prev = price * k + prev * (1 - k);
      ema.push(prev);
    }
  }
  return ema;
}

// ============================================
// STRATEGY LOGIC
// ============================================
function findCrossover(ema20, ema50) {
  // Tìm giao cắt gần nhất (từ cuối về đầu)
  for (let i = ema20.length - 2; i >= 50; i--) {
    if (!ema20[i] || !ema50[i] || !ema20[i - 1] || !ema50[i - 1]) continue;
    const crossBull = ema20[i - 1] <= ema50[i - 1] && ema20[i] > ema50[i];
    const crossBear = ema20[i - 1] >= ema50[i - 1] && ema20[i] < ema50[i];
    if (crossBull || crossBear) {
      return { index: i, type: crossBull ? 'bull' : 'bear' };
    }
  }
  return null;
}

function findRetest(candles, ema20, ema50, crossover) {
  if (!crossover) return null;
  const retests = [];
  for (let i = crossover.index + 2; i < candles.length; i++) {
    const c = candles[i];
    const e20 = ema20[i], e50 = ema50[i];
    if (!e20 || !e50) continue;

    // Tolerance: 0.3% của giá
    const tol = c.close * 0.003;
    const touchEma20 = c.low <= e20 + tol && c.high >= e20 - tol;
    const touchEma50 = c.low <= e50 + tol && c.high >= e50 - tol;

    if (touchEma20 || touchEma50) {
      retests.push({ index: i, ema: touchEma50 ? 50 : 20 });
    }
  }
  // Trả về retest cuối cùng (gần nhất)
  return retests.length > 0 ? retests[retests.length - 1] : null;
}

function detectPattern(candles, idx, crossType) {
  const c = candles[idx];
  if (!c) return null;

  const body = Math.abs(c.close - c.open);
  const total = c.high - c.low;
  const lower = Math.min(c.open, c.close) - c.low;
  const upper = c.high - Math.max(c.open, c.close);

  if (total < 0.0001) return null;

  // Pin Bar bullish: bóng dưới > 60% tổng
  if (lower / total > 0.6 && crossType === 'bull') return 'pinBarBull';

  // Hammer/Hanging Man: bóng dưới dài gấp 2x thân, bóng trên ngắn
  if (body > 0 && lower >= body * 2 && upper < body * 0.5) {
    return crossType === 'bull' ? 'bullHammer' : 'hangingMan';
  }

  // Shooting Star: bóng trên dài gấp 2x thân
  if (body > 0 && upper >= body * 2 && lower < body * 0.5 && crossType === 'bear') {
    return 'shootingStar';
  }

  // Doji: thân rất nhỏ so với tổng range
  if (body / total < 0.1) return 'dojiStar';

  // Engulfing
  if (idx > 0) {
    const prev = candles[idx - 1];
    const prevBody = Math.abs(prev.close - prev.open);
    if (crossType === 'bull' && prev.close < prev.open && c.close > c.open && body > prevBody * 1.2) {
      return 'bullEngulfing';
    }
    if (crossType === 'bear' && prev.close > prev.open && c.close < c.open && body > prevBody * 1.2) {
      return 'bearEngulfing';
    }
  }

  // Fallback: pattern dựa theo trend
  return crossType === 'bull' ? 'bullHammer' : 'shootingStar';
}

// ============================================
// CHART RENDERING
// ============================================
function renderChart(candles, ema20, ema50, crossover, retest, signal) {
  const canvas = document.getElementById('chartCanvas');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.parentElement.offsetWidth;
  const H = Math.max(340, Math.min(520, window.innerHeight * 0.48));
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';

  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  c.clearRect(0, 0, W, H);

  const PAD = { top: 30, right: 80, bottom: 44, left: 80 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  // Visible window: hiện cuối 120 nến để đủ không gian
  const VISIBLE = Math.min(candles.length, 120);
  const startIdx = candles.length - VISIBLE;
  const visibleCandles = candles.slice(startIdx);
  const visibleEma20 = ema20.slice(startIdx);
  const visibleEma50 = ema50.slice(startIdx);

  // Price range từ dữ liệu visible
  const prices = visibleCandles.flatMap(c => [c.high, c.low]);
  const emaPrices = [...visibleEma20, ...visibleEma50].filter(v => v !== null);
  const allPrices = [...prices, ...emaPrices];
  const rawMin = Math.min(...allPrices), rawMax = Math.max(...allPrices);
  const pad = (rawMax - rawMin) * 0.05;
  const minP = rawMin - pad, maxP = rawMax + pad;
  const priceRange = maxP - minP;

  // Helpers
  const toY = (p) => PAD.top + chartH - ((p - minP) / priceRange) * chartH;
  const toX = (visIdx) => PAD.left + (visIdx / (VISIBLE - 1)) * chartW;
  const candleW = Math.max(2, (chartW / VISIBLE) * 0.72);

  // --- Grid ---
  c.strokeStyle = C.grid;
  c.lineWidth = 1;
  const gridLevels = 6;
  for (let g = 0; g <= gridLevels; g++) {
    const y = PAD.top + (g / gridLevels) * chartH;
    c.beginPath(); c.moveTo(PAD.left, y); c.lineTo(W - PAD.right, y); c.stroke();
    const price = maxP - (g / gridLevels) * priceRange;
    c.fillStyle = C.textMuted;
    c.font = `10px JetBrains Mono, monospace`;
    c.textAlign = 'right';
    c.fillText(fmtPrice(price), PAD.left - 6, y + 4);
  }

  // --- Crossover zone highlight ---
  if (crossover && crossover.index >= startIdx) {
    const visIdx = crossover.index - startIdx;
    const cx = toX(visIdx);
    const color = crossover.type === 'bull'
      ? 'rgba(0,212,160,0.04)' : 'rgba(255,77,106,0.04)';
    c.fillStyle = color;
    c.fillRect(cx, PAD.top, W - PAD.right - cx, chartH);

    c.fillStyle = crossover.type === 'bull' ? C.green : C.red;
    c.font = '10px JetBrains Mono, monospace';
    c.textAlign = 'center';
    c.fillText(
      crossover.type === 'bull' ? '▲ Golden Cross' : '▼ Death Cross',
      cx + 55, PAD.top + 16
    );
  }

  // --- Candles ---
  visibleCandles.forEach((candle, vi) => {
    const x = toX(vi);
    const globalIdx = startIdx + vi;
    const open = toY(candle.open), close = toY(candle.close);
    const high = toY(candle.high), low = toY(candle.low);
    const isBull = candle.close >= candle.open;
    const color = isBull ? C.bull : C.bear;

    // Highlight retest candle
    if (retest && globalIdx === retest.index) {
      c.fillStyle = 'rgba(255,230,50,0.07)';
      c.fillRect(x - candleW / 2 - 5, PAD.top, candleW + 10, chartH);
    }

    // Wick
    c.strokeStyle = color + 'cc';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x, high); c.lineTo(x, Math.min(open, close));
    c.moveTo(x, Math.max(open, close)); c.lineTo(x, low);
    c.stroke();

    // Body
    const bodyTop = Math.min(open, close);
    const bodyH = Math.max(1, Math.abs(open - close));
    c.fillStyle = isBull ? color + '99' : color + '88';
    c.strokeStyle = color;
    c.lineWidth = 1;
    c.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
    c.strokeRect(x - candleW / 2, bodyTop, candleW, bodyH);
  });

  // --- EMA 50 ---
  c.beginPath();
  c.strokeStyle = C.ema50;
  c.lineWidth = 1.8;
  c.setLineDash([5, 3]);
  visibleEma50.forEach((val, vi) => {
    if (val === null) return;
    const x = toX(vi), y = toY(val);
    if (vi === 0 || visibleEma50[vi - 1] === null) c.moveTo(x, y);
    else c.lineTo(x, y);
  });
  c.stroke();
  c.setLineDash([]);

  // --- EMA 20 ---
  c.beginPath();
  c.strokeStyle = C.ema20;
  c.lineWidth = 2;
  visibleEma20.forEach((val, vi) => {
    if (val === null) return;
    const x = toX(vi), y = toY(val);
    if (vi === 0 || visibleEma20[vi - 1] === null) c.moveTo(x, y);
    else c.lineTo(x, y);
  });
  c.stroke();

  // EMA labels bên phải
  const lastE20 = visibleEma20[visibleEma20.length - 1];
  const lastE50 = visibleEma50[visibleEma50.length - 1];
  if (lastE20) {
    const y = toY(lastE20);
    c.fillStyle = C.bg3;
    c.fillRect(W - PAD.right + 2, y - 9, PAD.right - 4, 16);
    c.fillStyle = C.ema20;
    c.font = 'bold 10px JetBrains Mono, monospace';
    c.textAlign = 'left';
    c.fillText(`EMA20: ${fmtPrice(lastE20)}`, W - PAD.right + 4, y + 4);
  }
  if (lastE50) {
    const y = toY(lastE50);
    c.fillStyle = C.bg3;
    c.fillRect(W - PAD.right + 2, y - 9, PAD.right - 4, 16);
    c.fillStyle = C.ema50;
    c.font = 'bold 10px JetBrains Mono, monospace';
    c.textAlign = 'left';
    c.fillText(`EMA50: ${fmtPrice(lastE50)}`, W - PAD.right + 4, y + 4);
  }

  // --- Crossover marker ---
  if (crossover && crossover.index >= startIdx) {
    const visIdx = crossover.index - startIdx;
    const cx = toX(visIdx);
    const ey = toY((ema20[crossover.index] + ema50[crossover.index]) / 2);
    c.fillStyle = crossover.type === 'bull' ? C.green : C.red;
    c.shadowBlur = 12;
    c.shadowColor = crossover.type === 'bull' ? C.green : C.red;
    c.beginPath(); c.arc(cx, ey, 6, 0, Math.PI * 2); c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = C.bg; c.lineWidth = 2;
    c.stroke();
  }

  // --- Retest zone ---
  if (retest && retest.index >= startIdx) {
    const visIdx = retest.index - startIdx;
    const rx = toX(visIdx);
    const emaVal = retest.ema === 20 ? ema20[retest.index] : ema50[retest.index];
    if (emaVal) {
      const ry = toY(emaVal);
      c.strokeStyle = '#ffeb3b';
      c.lineWidth = 2;
      c.setLineDash([3, 2]);
      c.beginPath(); c.arc(rx, ry, 18, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
      c.fillStyle = '#ffeb3b';
      c.font = '10px JetBrains Mono, monospace';
      c.textAlign = 'center';
      c.fillText(`Retest EMA${retest.ema}`, rx, ry - 26);
    }
  }

  // --- Signal arrow ---
  if (signal && signal.index >= startIdx) {
    const visIdx = signal.index - startIdx;
    const sx = toX(visIdx);
    const isBuy = signal.type === 'buy';
    const color = isBuy ? C.green : C.red;

    c.shadowBlur = 20;
    c.shadowColor = color;
    c.fillStyle = color;

    if (isBuy) {
      const sy = toY(candles[signal.index].low) + 22;
      c.beginPath();
      c.moveTo(sx, sy + 14); c.lineTo(sx - 10, sy); c.lineTo(sx + 10, sy);
      c.closePath(); c.fill();
      c.shadowBlur = 0;
      c.font = 'bold 11px JetBrains Mono, monospace';
      c.fillStyle = color; c.textAlign = 'center';
      c.fillText('▲ BUY', sx, sy + 28);
    } else {
      const sy = toY(candles[signal.index].high) - 22;
      c.beginPath();
      c.moveTo(sx, sy); c.lineTo(sx - 10, sy - 14); c.lineTo(sx + 10, sy - 14);
      c.closePath(); c.fill();
      c.shadowBlur = 0;
      c.font = 'bold 11px JetBrains Mono, monospace';
      c.fillStyle = color; c.textAlign = 'center';
      c.fillText('▼ SELL', sx, sy - 20);
    }
  }

  // --- X-axis time labels ---
  c.fillStyle = C.textMuted;
  c.font = '10px JetBrains Mono, monospace';
  c.textAlign = 'center';
  const step = Math.max(1, Math.floor(VISIBLE / 8));
  for (let vi = 0; vi < VISIBLE; vi += step) {
    const x = toX(vi);
    const timeStr = formatTime(candles[startIdx + vi].time, ctx.interval);
    c.fillText(timeStr, x, H - PAD.bottom + 16);
  }
}

// ============================================
// DRAW CANDLE PATTERN PREVIEW
// ============================================
function drawPatternPreview(patternKey) {
  const canvas = document.getElementById('candlePatternCanvas');
  const c = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#161924';
  c.fillRect(0, 0, W, H);
  const pattern = CANDLE_PATTERNS[patternKey];
  if (pattern) pattern.draw(c, W / 2, 8, W, H - 16);
}

// ============================================
// UPDATE UI
// ============================================
function updateUI(data) {
  const { candles, ema20, ema50, crossover, retest, signal, pattern } = data;
  const lastIdx = candles.length - 1;
  const lastClose = candles[lastIdx].close;

  // EMA values
  document.getElementById('ema20val').textContent = ema20[lastIdx] ? fmtPrice(ema20[lastIdx]) : '—';
  document.getElementById('ema50val').textContent = ema50[lastIdx] ? fmtPrice(ema50[lastIdx]) : '—';

  // Crossover
  const crossEl = document.getElementById('crossType');
  if (crossover) {
    crossEl.textContent = crossover.type === 'bull' ? '↗ Golden Cross' : '↘ Death Cross';
    crossEl.style.color = crossover.type === 'bull' ? C.green : C.red;
  } else {
    crossEl.textContent = 'Không có'; crossEl.style.color = '';
  }

  // Retest
  const retestEl = document.getElementById('retestStatus');
  if (retest) {
    retestEl.textContent = `EMA ${retest.ema} ✓`;
    retestEl.style.color = '#ffeb3b';
  } else {
    retestEl.textContent = 'Chưa có'; retestEl.style.color = '';
  }

  // Signal box
  const signalBox = document.getElementById('signalBox');
  const signalVal = document.getElementById('signalValue');
  const signalDetail = document.getElementById('signalDetail');
  signalBox.className = 'signal-box';
  if (signal) {
    const isBuy = signal.type === 'buy';
    signalBox.classList.add(signal.type);
    signalVal.textContent = isBuy ? '▲ BUY' : '▼ SELL';
    signalDetail.textContent = pattern ? `Pattern: ${CANDLE_PATTERNS[pattern]?.name}` : '';
  } else {
    signalVal.textContent = '—';
    signalDetail.textContent = 'Chưa đủ điều kiện';
  }

  // Candle pattern
  if (pattern && CANDLE_PATTERNS[pattern]) {
    const p = CANDLE_PATTERNS[pattern];
    document.getElementById('patternName').textContent = p.name;
    document.getElementById('patternDesc').textContent = p.desc;
    drawPatternPreview(pattern);
  } else {
    document.getElementById('patternName').textContent = '—';
    document.getElementById('patternDesc').textContent = 'Chưa phát hiện mô hình';
  }

  // Rules checklist
  setRule(document.getElementById('rule1'), !!crossover);
  setRule(document.getElementById('rule2'), !!retest);
  setRule(document.getElementById('rule3'), !!pattern);
  setRule(document.getElementById('rule4'), !!signal);

  // Trade setup
  if (signal) {
    const entry = candles[signal.index].close;
    const isBuy = signal.type === 'buy';
    const slPct = 0.015;
    const sl = isBuy ? entry * (1 - slPct) : entry * (1 + slPct);
    const tp1 = isBuy ? entry * (1 + slPct * 1.5) : entry * (1 - slPct * 1.5);
    const tp2 = isBuy ? entry * (1 + slPct * 3) : entry * (1 - slPct * 3);
    const rr = ((Math.abs(tp1 - entry)) / Math.abs(entry - sl)).toFixed(1);
    document.getElementById('tradeEntry').textContent = fmtPrice(entry);
    document.getElementById('tradeSL').textContent = fmtPrice(sl);
    document.getElementById('tradeTP1').textContent = fmtPrice(tp1);
    document.getElementById('tradeTP2').textContent = fmtPrice(tp2);
    document.getElementById('tradeRR').textContent = `1 : ${rr}`;
  } else {
    ['tradeEntry', 'tradeSL', 'tradeTP1', 'tradeTP2', 'tradeRR']
      .forEach(id => { document.getElementById(id).textContent = '—'; });
  }

  // Steps highlight
  document.getElementById('step1').classList.toggle('active', !!crossover);
  document.getElementById('step2').classList.toggle('active', !!retest);
  document.getElementById('step3').classList.toggle('active', !!pattern);
  document.getElementById('step4').classList.toggle('active', !!signal);
}

function setRule(el, checked) {
  el.classList.toggle('checked', checked);
  el.querySelector('.rule-check').textContent = checked ? '✓' : '◯';
}

// ============================================
// MAIN: LOAD REAL DATA FROM BINANCE
// ============================================
async function loadRealData() {
  if (ctx.loading) return;
  ctx.loading = true;

  const symbol = document.getElementById('symbolSelect').value;
  const interval = document.getElementById('intervalSelect').value;
  const limit = parseInt(document.getElementById('limitSelect').value);

  // Update UI state
  ctx.symbol = symbol; ctx.interval = interval; ctx.limit = limit;
  const symLabel = symbol.replace('USDT', '/USDT');
  const intervalLabel = { '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1D', '1w': '1W' }[interval] || interval;
  document.getElementById('pair-badge').textContent = `${symLabel} · ${intervalLabel}`;

  setLoading(true);
  showToast(`⏳ Đang tải dữ liệu ${symLabel} ${intervalLabel} từ Binance...`);

  try {
    const candles = await fetchBinanceKlines(symbol, interval, limit);
    const ema20 = calcEMA(candles, 20);
    const ema50 = calcEMA(candles, 50);
    const crossover = findCrossover(ema20, ema50);
    const retest = findRetest(candles, ema20, ema50, crossover);

    let signal = null, pattern = null;
    if (retest && crossover) {
      pattern = detectPattern(candles, retest.index, crossover.type);
      if (pattern) {
        signal = {
          index: Math.min(retest.index + 1, candles.length - 1),
          type: crossover.type === 'bull' ? 'buy' : 'sell',
        };
      }
    }

    ctx.data = { candles, ema20, ema50, crossover, retest, signal, pattern };
    renderChart(candles, ema20, ema50, crossover, retest, signal);
    updateUI(ctx.data);

    // Thông báo kết quả
    if (signal) {
      showToast(`✅ ${symLabel} — Tín hiệu ${signal.type.toUpperCase()} sau ${CANDLE_PATTERNS[pattern]?.name || pattern}`);
    } else if (crossover) {
      showToast(`📊 ${symLabel} — ${crossover.type === 'bull' ? 'Golden Cross' : 'Death Cross'} tìm thấy, chờ retest...`);
    } else {
      showToast(`📊 ${symLabel} — Chưa có giao cắt EMA trong ${limit} nến gần nhất`);
    }
  } catch (err) {
    console.error('Binance API error:', err);
    showToast(`❌ Lỗi tải dữ liệu: ${err.message}`);
  } finally {
    setLoading(false);
    ctx.loading = false;
  }
}

// ============================================
// PATTERN CARDS SETUP
// ============================================
function setupPatternCards() {
  const grid = document.getElementById('patternsGrid');
  grid.innerHTML = '';
  Object.entries(CANDLE_PATTERNS).forEach(([key, pattern]) => {
    const card = document.createElement('div');
    card.className = 'pattern-card';
    card.innerHTML = `
      <canvas id="pc-${key}" width="100" height="90"></canvas>
      <div class="pattern-card-name">${pattern.name}</div>
      <div class="pattern-card-type ${pattern.type}">${
        pattern.type === 'bull' ? '↑ Tăng' : pattern.type === 'bear' ? '↓ Giảm' : '◎ Trung tính'
      }</div>
    `;
    card.onclick = () => showToast(`${pattern.name}: ${pattern.desc}`);
    grid.appendChild(card);
    setTimeout(() => {
      const canvas = document.getElementById(`pc-${key}`);
      if (!canvas) return;
      const c = canvas.getContext('2d');
      c.fillStyle = '#161924'; c.fillRect(0, 0, 100, 90);
      pattern.draw(c, 50, 5, 100, 80);
    }, 60);
  });
}

// ============================================
// HELPERS
// ============================================
function setLoading(on) {
  const dot = document.getElementById('loadingDot');
  const btn = document.getElementById('btnRefresh');
  dot.classList.toggle('active', on);
  btn.disabled = on;
  btn.textContent = on ? '⏳ Loading...' : '↻ Làm mới';
}

function onParamChange() {
  // Auto-load khi đổi tham số
  loadRealData();
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 4000);
}

// ============================================
// INIT
// ============================================
window.addEventListener('DOMContentLoaded', () => {
  setupPatternCards();
  loadRealData(); // Load BTC/USDT 4h ngay khi mở

  // Redraw on resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (ctx.data) {
        const { candles, ema20, ema50, crossover, retest, signal } = ctx.data;
        renderChart(candles, ema20, ema50, crossover, retest, signal);
      }
    }, 200);
  });

  // Auto-refresh mỗi 60 giây
  setInterval(() => {
    if (!ctx.loading) loadRealData();
  }, 60000);
});
