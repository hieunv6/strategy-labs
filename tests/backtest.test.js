/**
 * StrategyLab — Unit Tests (Sprint 3)
 * Run: node tests/backtest.test.js
 *
 * Tests: calcEMA, calcATR, simulateTrade, fmtHoldBars
 */

// ─── Inline implementations (mirrors backtest.js exactly) ─────────────────────

function getIntervalMs(interval) {
  const map = {
    '1m':60000,'3m':180000,'5m':300000,'15m':900000,'30m':1800000,
    '1h':3600000,'2h':7200000,'4h':14400000,'6h':21600000,'8h':28800000,
    '12h':43200000,'1d':86400000,'3d':259200000,'1w':604800000,'1M':2592000000
  };
  return map[interval] || 14400000;
}

function fmtHoldBars(bars, interval) {
  if (!bars) return '—';
  const ms    = bars * getIntervalMs(interval || '4h');
  const hours = ms / 3600000;
  if (hours < 24) return `${bars}b (~${Math.round(hours)}h)`;
  const days  = Math.round(hours / 24);
  if (days  < 30) return `${bars}b (~${days}d)`;
  return `${bars}b (~${Math.round(days/30)}mo)`;
}

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

function simulateTrade(candles, sigIdx, crossType, slMode, slValue, atrArr, rrRatio, capital, sizeType, sizeValue, feeRate, maxHoldBars) {
  const entry = candles[sigIdx]?.close; if (!entry) return null;
  const isBuy = crossType === 'bull';
  const maxBars = maxHoldBars || 80;
  const fee = feeRate || 0;

  let slDist;
  if (slMode === 'atr') {
    const atrVal = atrArr?.[sigIdx] || entry * 0.02;
    slDist = atrVal * slValue;
  } else {
    slDist = entry * slValue;
  }
  if (slDist <= 0) return null;

  const sl     = isBuy ? entry - slDist : entry + slDist;
  const tp     = isBuy ? entry + slDist * rrRatio : entry - slDist * rrRatio;

  let posSize = 0;
  if (sizeType === 'percent') {
    posSize = (capital * (sizeValue / 100)) / entry;
  } else if (sizeType === 'fixed') {
    posSize = sizeValue / entry;
  } else {
    posSize = (capital * (sizeValue / 100)) / slDist;
  }
  let posValue = posSize * entry;
  if (posValue > capital && capital > 0) { posValue = capital; posSize = capital / entry; }

  for (let i = sigIdx + 1; i < Math.min(sigIdx + maxBars, candles.length); i++) {
    const c = candles[i];
    const hitSL = isBuy ? c.low <= sl  : c.high >= sl;
    const hitTP = isBuy ? c.high >= tp : c.low  <= tp;
    if (hitSL || hitTP) {
      const exitPx  = hitTP && !hitSL ? tp : sl;
      const gross   = isBuy ? (exitPx - entry) * posSize : (entry - exitPx) * posSize;
      const feeCost = posValue * fee;
      const pnl     = gross - feeCost;
      return {
        result: pnl >= 0 ? 'WIN' : 'LOSS', pnl: +pnl.toFixed(2),
        pnlPct: +((pnl/posValue)*100).toFixed(2),
        holdBars: i - sigIdx, entry, sl, tp, exitPrice: exitPx,
        posValue, feeCost: +feeCost.toFixed(2),
      };
    }
  }
  const last    = candles[Math.min(sigIdx + maxBars, candles.length - 1)];
  const gross   = isBuy ? (last.close - entry) * posSize : (entry - last.close) * posSize;
  const feeCost = posValue * fee;
  const pnl     = gross - feeCost;
  return {
    result: pnl >= 0 ? 'WIN' : 'LOSS', pnl: +pnl.toFixed(2),
    pnlPct: +((pnl/posValue)*100).toFixed(2),
    holdBars: Math.min(sigIdx + maxBars, candles.length - 1) - sigIdx,
    entry, sl, tp, exitPrice: last.close, posValue, feeCost: +feeCost.toFixed(2),
  };
}

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push(`  ✅ ${name}`);
  } catch(e) {
    failed++;
    results.push(`  ❌ ${name}\n     → ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertClose(a, b, tol=0.001, msg='') {
  if (Math.abs(a - b) > tol) throw new Error(
    `${msg || ''}Expected ~${b}, got ${a} (diff: ${Math.abs(a-b).toFixed(6)})`
  );
}

// ─── Make test candles ────────────────────────────────────────────────────────
function makeCandles(closes, hiMult=1.01, loMult=0.99) {
  return closes.map((c, i) => ({
    time: i * 14400000,
    open: closes[i > 0 ? i-1 : 0],
    high: c * hiMult,
    low:  c * loMult,
    close: c,
    volume: 1000
  }));
}

function makeFlatCandles(n, price=100) {
  return Array.from({length:n}, (_,i) => ({
    time: i*14400000, open:price, high:price*1.01, low:price*0.99, close:price, volume:1000
  }));
}

// ─── EMA Tests ────────────────────────────────────────────────────────────────
console.log('\n📐 calcEMA');

test('Returns array same length as input', () => {
  const c = makeFlatCandles(50);
  const ema = calcEMA(c, 20);
  assert(ema.length === 50, `Expected 50, got ${ema.length}`);
});

test('First (period-1) values are null', () => {
  const c = makeFlatCandles(30, 100);
  const ema = calcEMA(c, 20);
  for (let i = 0; i < 19; i++) assert(ema[i] === null, `Index ${i} should be null`);
  assert(ema[19] !== null, 'Index 19 should not be null');
});

test('EMA of constant price equals that price', () => {
  const c = makeFlatCandles(50, 100);
  const ema = calcEMA(c, 20);
  ema.forEach((v, i) => { if (v !== null) assertClose(v, 100, 1e-9, `@${i} `); });
});

test('EMA converges toward rising price', () => {
  const closes = Array.from({length:60}, (_,i) => 100 + i); // rising
  const ema = calcEMA(makeCandles(closes), 20);
  const last = ema[ema.length - 1];
  assert(last > 100 && last < 159, `EMA should be between 100 and 159, got ${last}`);
});

test('EMA(20) is slower than EMA(5) to react', () => {
  const closes = [...Array(30).fill(100), ...Array(30).fill(200)];
  const c  = makeCandles(closes);
  const e5  = calcEMA(c, 5);
  const e20 = calcEMA(c, 20);
  // EMA5 should be closer to 200 at the end
  const last = closes.length - 1;
  assert(e5[last] > e20[last], `EMA5 (${e5[last].toFixed(2)}) should be > EMA20 (${e20[last].toFixed(2)})`);
});

test('EMA with period > candles length handles gracefully', () => {
  const c = makeFlatCandles(5, 100);
  const ema = calcEMA(c, 20);
  assert(ema.every(v => v === null), 'All should be null when period > length');
});

// ─── ATR Tests ────────────────────────────────────────────────────────────────
console.log('\n📐 calcATR');

test('Returns array same length as input', () => {
  const c = makeFlatCandles(50, 100);
  const atr = calcATR(c, 14);
  assert(atr.length === 50, `Expected 50, got ${atr.length}`);
});

test('First period values are null', () => {
  const c = makeFlatCandles(50, 100);
  const atr = calcATR(c, 14);
  for (let i = 0; i < 14; i++) assert(atr[i] === null, `@${i} should be null`);
  assert(atr[14] !== null, 'Index 14 should not be null');
});

test('ATR of flat candles ≈ (high - low) = price * 0.02', () => {
  // makeCandles uses hi=*1.01, lo=*0.99 → range = 0.02 * price
  const c = makeFlatCandles(50, 100);
  const atr = calcATR(c, 14);
  const lastATR = atr[atr.length - 1];
  assertClose(lastATR, 2.0, 0.1, 'Flat candles ATR ');
});

test('ATR is always positive', () => {
  const c = makeFlatCandles(50, 100);
  calcATR(c, 14).forEach((v, i) => {
    if (v !== null) assert(v > 0, `ATR at ${i} should be positive, got ${v}`);
  });
});

test('Returns all null if candles.length < period + 1', () => {
  const c = makeFlatCandles(10, 100);
  const atr = calcATR(c, 14);
  assert(atr.every(v => v === null), 'All null expected');
});

test('12h interval = 43,200,000ms (not 57,600,000)', () => {
  assert(getIntervalMs('12h') === 43200000,
    `12h should be 43,200,000 but got ${getIntervalMs('12h')}`);
});

// ─── simulateTrade Tests ──────────────────────────────────────────────────────
console.log('\n📐 simulateTrade');

// Craft candles where bar 1 goes to TP
function makeTPCandles(entry=100, sl=0.02, rr=2) {
  const slDist = entry * sl;
  const tp     = entry + slDist * rr;
  return [
    { time:0, open:entry-0.5, high:entry+0.5, low:entry-0.5, close:entry, volume:1000 }, // signal bar
    { time:1, open:entry,     high:tp + 1,    low:entry - 1,  close:tp,   volume:1000 }, // hits TP
  ];
}
function makeSLCandles(entry=100, sl=0.02) {
  const slPrice = entry * (1 - sl);
  return [
    { time:0, open:entry-0.5, high:entry+0.5, low:entry-0.5, close:entry,    volume:1000 },
    { time:1, open:entry,     high:entry+0.5, low:slPrice-1,  close:slPrice,  volume:1000 },
  ];
}

test('Returns WIN when TP hit within maxHold', () => {
  const candles = makeTPCandles(100, 0.02, 2);
  const t = simulateTrade(candles, 0, 'bull', 'fixed', 0.02, null, 2, 10000, 'risk', 2);
  assert(t !== null, 'Should return trade');
  assert(t.result === 'WIN', `Expected WIN, got ${t.result}`);
  assert(t.pnl > 0, `PnL should be positive, got ${t.pnl}`);
});

test('Returns LOSS when SL hit', () => {
  const candles = makeSLCandles(100, 0.02);
  const t = simulateTrade(candles, 0, 'bull', 'fixed', 0.02, null, 2, 10000, 'risk', 2);
  assert(t !== null, 'Should return trade');
  assert(t.result === 'LOSS', `Expected LOSS, got ${t.result}`);
  assert(t.pnl < 0, `PnL should be negative, got ${t.pnl}`);
});

test('Fee reduces PnL correctly (0.1% fee)', () => {
  const candles = makeTPCandles(100, 0.02, 2);
  const noFee  = simulateTrade(candles, 0, 'bull', 'fixed', 0.02, null, 2, 10000, 'risk', 2, 0);
  const withFee= simulateTrade(candles, 0, 'bull', 'fixed', 0.02, null, 2, 10000, 'risk', 2, 0.001);
  assert(withFee.pnl < noFee.pnl, 'Fee should reduce PnL');
  assertClose(withFee.feeCost, withFee.posValue * 0.001, 0.01, 'Fee cost ');
});

test('PnL WIN ≈ R:R × PnL LOSS magnitude (no fee)', () => {
  const entry = 100, sl = 0.02, rr = 2;
  const cTP  = makeTPCandles(entry, sl, rr);
  const cSL  = makeSLCandles(entry, sl);
  const tWin = simulateTrade(cTP, 0, 'bull', 'fixed', sl, null, rr, 10000, 'risk', 2, 0);
  const tLoss= simulateTrade(cSL, 0, 'bull', 'fixed', sl, null, rr, 10000, 'risk', 2, 0);
  const ratio = Math.abs(tWin.pnl / tLoss.pnl);
  assertClose(ratio, rr, 0.05, `R:R ratio expected ${rr}, got ${ratio.toFixed(3)} `);
});

test('maxHoldBars timeout returns LOSS/WIN based on close', () => {
  // After maxHold=2 bars, close is still at entry → tiny fee loss or 0
  const entry = 100;
  const candles = [
    { time:0, open:entry, high:entry+0.5, low:entry-0.5, close:entry, volume:1 },
    { time:1, open:entry, high:entry+0.5, low:entry-0.5, close:entry, volume:1 },
    { time:2, open:entry, high:entry+0.5, low:entry-0.5, close:entry, volume:1 },
  ];
  const t = simulateTrade(candles, 0, 'bull', 'fixed', 0.02, null, 2, 10000, 'risk', 2, 0, 2);
  assert(t !== null, 'Should return timed-out trade');
  assert(t.holdBars <= 2, `holdBars should be ≤ 2, got ${t.holdBars}`);
});

test('SELL (bear) trade: TP = price - slDist×RR', () => {
  const entry = 100, sl = 0.02, rr = 2;
  const slDist = entry * sl;
  const tp = entry - slDist * rr;  // = 96
  const candles = [
    { time:0, open:entry, high:entry+1, low:entry-1,   close:entry, volume:1 },
    { time:1, open:entry, high:entry+1, low: tp - 1,   close:tp,    volume:1 },
  ];
  const t = simulateTrade(candles, 0, 'bear', 'fixed', sl, null, rr, 10000, 'risk', 2, 0);
  assert(t !== null, 'Should return trade');
  assert(t.result === 'WIN', `Expected WIN for SELL hitting TP, got ${t.result}`);
  assert(t.pnl > 0, `SELL WIN pnl should be positive, got ${t.pnl}`);
});

test('ATR-based SL: slDist = ATR × multiplier', () => {
  const entry  = 100;
  const atrVal = 3.0;
  const mult   = 1.5;
  const candles = [
    { time:0, open:entry, high:entry+1, low:entry-1, close:entry, volume:1 },
    { time:1, open:entry, high:entry + atrVal*mult*2 + 1, low:entry-1, close:entry + atrVal*mult*2, volume:1 },
  ];
  const atrArr = [null, atrVal, atrVal];
  // SL dist = 3.0 × 1.5 = 4.5, TP = entry + 4.5 × 2 = 109
  const t = simulateTrade(candles, 0, 'bull', 'atr', mult, [atrVal, atrVal], 2, 10000, 'risk', 2, 0);
  assert(t !== null, 'Should return ATR trade');
  assertClose(Math.abs(t.sl - entry), atrVal * mult, 0.01, 'SL distance ');
});

// ─── fmtHoldBars Tests ────────────────────────────────────────────────────────
console.log('\n📐 fmtHoldBars');

test('0 bars returns —', () => {
  assert(fmtHoldBars(0, '4h') === '—');
});

test('1 bar 4h → ~4h', () => {
  const s = fmtHoldBars(1, '4h');
  assert(s.includes('~4h'), `Expected ~4h in "${s}"`);
});

test('6 bars 4h → ~1d', () => {
  const s = fmtHoldBars(6, '4h');
  assert(s.includes('~1d'), `Expected ~1d in "${s}"`);
});

test('30 bars 1d → ~1mo', () => {
  const s = fmtHoldBars(30, '1d');
  assert(s.includes('~1mo'), `Expected ~1mo in "${s}"`);
});

test('24 bars 1h → ~1d', () => {
  const s = fmtHoldBars(24, '1h');
  assert(s.includes('~1d'), `Expected ~1d in "${s}"`);
});

// ─── calcSwingLevels Tests ────────────────────────────────────────────────────
// Inline implementation (mirrors backtest.js exactly)
function calcSwingLevels(candles, lookback = 20) {
  const swingHigh = new Array(candles.length).fill(null);
  const swingLow  = new Array(candles.length).fill(null);
  for (let i = lookback; i < candles.length; i++) {
    let maxH = -Infinity, minL = Infinity;
    for (let j = i - lookback; j < i; j++) {
      if (candles[j].high > maxH) maxH = candles[j].high;
      if (candles[j].low  < minL) minL = candles[j].low;
    }
    swingHigh[i] = maxH;
    swingLow[i]  = minL;
  }
  return { swingHigh, swingLow };
}

function scanFalseBreakouts(candles, swings, breakoutPct = 0.002) {
  const { swingHigh, swingLow } = swings;
  const signals = [];
  let lastSigIdx = -10;
  for (let i = 1; i < candles.length - 1; i++) {
    if (!swingHigh[i] || !swingLow[i]) continue;
    if (i - lastSigIdx < 5) continue;
    const c = candles[i];
    if (c.high > swingHigh[i] * (1 + breakoutPct) && c.close < swingHigh[i]) {
      signals.push({ index: i, type: 'bear', fakeDir: 'up',
        levelRef: swingHigh[i], breakPct: +((c.high / swingHigh[i] - 1) * 100).toFixed(3) });
      lastSigIdx = i;
    } else if (c.low < swingLow[i] * (1 - breakoutPct) && c.close > swingLow[i]) {
      signals.push({ index: i, type: 'bull', fakeDir: 'down',
        levelRef: swingLow[i], breakPct: +((1 - c.low / swingLow[i]) * 100).toFixed(3) });
      lastSigIdx = i;
    }
  }
  return signals;
}

console.log('\n📐 calcSwingLevels');

test('Returns arrays with same length as candles', () => {
  const c = makeFlatCandles(50, 100);
  const { swingHigh, swingLow } = calcSwingLevels(c, 10);
  assert(swingHigh.length === 50, `Expected 50, got ${swingHigh.length}`);
  assert(swingLow.length  === 50, `Expected 50, got ${swingLow.length}`);
});

test('First lookback values are null (no look-ahead)', () => {
  const c = makeFlatCandles(50, 100);
  const { swingHigh, swingLow } = calcSwingLevels(c, 20);
  for (let i = 0; i < 20; i++) {
    assert(swingHigh[i] === null, `swingHigh[${i}] should be null`);
    assert(swingLow[i]  === null, `swingLow[${i}] should be null`);
  }
  assert(swingHigh[20] !== null, 'swingHigh[20] should have a value');
});

test('swingHigh equals max high in lookback window', () => {
  // Build candles where only bar 3 has a spike
  const candles = Array.from({ length: 30 }, (_, i) => ({
    time: i * 14400000,
    open: 100, high: i === 3 ? 200 : 101, low: 99, close: 100, volume: 1000
  }));
  const { swingHigh } = calcSwingLevels(candles, 10);
  // At index 13, window is [3..12] — bar 3's high of 200 included
  assertClose(swingHigh[13], 200, 0.01, 'swingHigh[13] ');
  // At index 20, window is [10..19] — bar 3 excluded → max is 101
  assertClose(swingHigh[20], 101, 0.01, 'swingHigh[20] ');
});

test('swingLow equals min low in lookback window', () => {
  const candles = Array.from({ length: 30 }, (_, i) => ({
    time: i * 14400000,
    open: 100, high: 101, low: i === 5 ? 50 : 99, close: 100, volume: 1000
  }));
  const { swingLow } = calcSwingLevels(candles, 10);
  // At index 15, window [5..14] includes the spike down → min should be 50
  assertClose(swingLow[15], 50, 0.01, 'swingLow[15] ');
  // At index 20, window [10..19] — bar 5 excluded → min is 99
  assertClose(swingLow[20], 99, 0.01, 'swingLow[20] ');
});

console.log('\n📐 scanFalseBreakouts');

test('Detects bull fakeout (fake break down → BUY signal)', () => {
  // 25 bars at 100, then 1 bar that pokes below the 20-bar low (swingLow ≈ 99)
  // but closes back above it
  const candles = Array.from({ length: 27 }, (_, i) => {
    if (i === 25) return { time: i*14400000, open: 100, high: 101, low: 98.0, close: 100.5, volume: 1000 };
    return { time: i*14400000, open: 100, high: 101, low: 99, close: 100, volume: 1000 };
  });
  const swings  = calcSwingLevels(candles, 20);
  const signals = scanFalseBreakouts(candles, swings, 0.002);
  const bullSigs = signals.filter(s => s.type === 'bull');
  assert(bullSigs.length >= 1, `Expected ≥1 bull signal, got ${bullSigs.length}`);
  assert(bullSigs[0].fakeDir === 'down', 'Bull fakeout fakeDir should be "down"');
});

test('Detects bear fakeout (fake break up → SELL signal)', () => {
  // 25 bars at 100 (high=101), then 1 bar that pokes above 20-bar high (101)
  // but closes back below
  const candles = Array.from({ length: 27 }, (_, i) => {
    if (i === 25) return { time: i*14400000, open: 100, high: 102.5, low: 99, close: 100.0, volume: 1000 };
    return { time: i*14400000, open: 100, high: 101, low: 99, close: 100, volume: 1000 };
  });
  const swings  = calcSwingLevels(candles, 20);
  const signals = scanFalseBreakouts(candles, swings, 0.002);
  const bearSigs = signals.filter(s => s.type === 'bear');
  assert(bearSigs.length >= 1, `Expected ≥1 bear signal, got ${bearSigs.length}`);
  assert(bearSigs[0].fakeDir === 'up', 'Bear fakeout fakeDir should be "up"');
});

test('No signal when breakout is below minimum pct threshold', () => {
  // Breakout pct = 2%, but price only barely pierces the level (0.05%)
  const candles = Array.from({ length: 27 }, (_, i) => {
    if (i === 25) return { time: i*14400000, open: 100, high: 101.05, low: 99, close: 100.0, volume: 1000 };
    return { time: i*14400000, open: 100, high: 101, low: 99, close: 100, volume: 1000 };
  });
  const swings  = calcSwingLevels(candles, 20);
  const signals = scanFalseBreakouts(candles, swings, 0.02); // 2% threshold
  const bearSigs = signals.filter(s => s.type === 'bear');
  assert(bearSigs.length === 0, `Expected 0 signals below threshold, got ${bearSigs.length}`);
});

test('No signal when price closes ABOVE resistance (real breakout)', () => {
  // Price breaks above swingHigh AND closes above → real breakout, not fakeout
  const candles = Array.from({ length: 27 }, (_, i) => {
    if (i === 25) return { time: i*14400000, open: 100, high: 104, low: 99, close: 103, volume: 1000 };
    return { time: i*14400000, open: 100, high: 101, low: 99, close: 100, volume: 1000 };
  });
  const swings  = calcSwingLevels(candles, 20);
  const signals = scanFalseBreakouts(candles, swings, 0.002);
  const bearSigs = signals.filter(s => s.type === 'bear');
  assert(bearSigs.length === 0, `Real breakout should NOT trigger fakeout signal, got ${bearSigs.length}`);
});

test('Cooldown: no two signals within 5 bars', () => {
  // Craft two adjacent fakeouts at bars 25 and 28
  const candles = Array.from({ length: 40 }, (_, i) => {
    if (i === 25 || i === 28)
      return { time: i*14400000, open: 100, high: 102.5, low: 99, close: 100.0, volume: 1000 };
    return { time: i*14400000, open: 100, high: 101, low: 99, close: 100, volume: 1000 };
  });
  const swings  = calcSwingLevels(candles, 20);
  const signals = scanFalseBreakouts(candles, swings, 0.002);
  // Bar 25 and 28 are only 3 apart → cooldown should suppress bar 28
  const at25 = signals.filter(s => s.index === 25);
  const at28 = signals.filter(s => s.index === 28);
  assert(at25.length === 1, 'Signal at bar 25 expected');
  assert(at28.length === 0, 'Signal at bar 28 should be suppressed by cooldown');
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + results.join('\n'));
console.log(`\n${'─'.repeat(44)}`);
const emoji = failed === 0 ? '🎉' : '💥';
console.log(`${emoji}  ${passed} passed · ${failed} failed`);
console.log(`${'─'.repeat(44)}\n`);
if (failed > 0) process.exit(1);
