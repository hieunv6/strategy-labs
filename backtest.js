// ===================================================
// BACKTEST ENGINE — EMA 20/50 + ATR SL + Portfolio
// ===================================================

const BT = {
  trades: [],      // Legacy compat (current run)
  runs:   [],      // Multi-run: [{ id, strategyId, strategyName, color, trades, metrics, params, symbol, interval }]
  activeRunId: null,
  loading: false,
  mode: 'single',
  bhData: null,
};

// Get currently active strategy from tab bar
function getActiveStrategy() {
  const active = document.querySelector('.strat-tab.active');
  return active?.dataset?.strategyId || 'ema_crossover';
}

// Get strategy-specific params from DOM
function getStrategyParams(strategyId) {
  const extra = {};
  if (strategyId === 'ema_crossover') {
    extra.fastEMA = parseInt(document.getElementById('s_fastEMA')?.value || 20);
    extra.slowEMA = parseInt(document.getElementById('s_slowEMA')?.value || 50);
  } else if (strategyId === 'rsi_reversal') {
    extra.rsiPeriod  = parseInt(document.getElementById('s_rsiPeriod')?.value  || 14);
    extra.oversold   = parseFloat(document.getElementById('s_oversold')?.value  || 30);
    extra.overbought = parseFloat(document.getElementById('s_overbought')?.value || 70);
  } else if (strategyId === 'bb_bounce') {
    extra.bbPeriod = parseInt(document.getElementById('s_bbPeriod')?.value   || 20);
    extra.bbStdDev = parseFloat(document.getElementById('s_bbStdDev')?.value || 2);
  } else if (strategyId === 'false_breakout') {
    extra.fbLookback       = parseInt(document.getElementById('s_fbLookback')?.value      || 20);
    extra.fbBreakoutPct    = parseFloat(document.getElementById('s_fbBreakoutPct')?.value || 0.2);
    extra.fbRequirePattern = document.getElementById('s_fbRequirePattern')?.checked || false;
  } else if (strategyId === 'macd_crossover') {
    extra.macdFast = parseInt(document.getElementById('s_macdFast')?.value || 12);
    extra.macdSlow = parseInt(document.getElementById('s_macdSlow')?.value || 26);
    extra.macdSig  = parseInt(document.getElementById('s_macdSig')?.value  || 9);
  } else if (strategyId === 'supertrend') {
    extra.stAtrPeriod  = parseInt(document.getElementById('s_stAtrPeriod')?.value  || 10);
    extra.stMultiplier = parseFloat(document.getElementById('s_stMultiplier')?.value || 3);
  } else if (strategyId === 'donchian_breakout') {
    extra.dcLookback = parseInt(document.getElementById('s_dcLookback')?.value    || 20);
    extra.dcClosePct = parseFloat(document.getElementById('s_dcClosePct')?.value  || 0.1);
  } else if (strategyId === 'turtle_trading') {
    extra.ttSystem    = document.getElementById('s_ttSystem')?.value      || 'S1';
    extra.ttEntry     = parseInt(document.getElementById('s_ttEntry')?.value      || 20);
    extra.ttExit      = parseInt(document.getElementById('s_ttExit')?.value       || 10);
    extra.ttAtrPeriod = parseInt(document.getElementById('s_ttAtrPeriod')?.value  || 20);
    extra.ttNStop     = parseFloat(document.getElementById('s_ttNStop')?.value    || 2);
    extra.ttWinFilter = document.getElementById('s_ttWinFilter')?.checked ?? true;
  }
  return extra;
}

const C = {
  green:'#00f5a0', red:'#ff3f60',
  grid:'rgba(255,255,255,0.04)',
  text:'#ffffff', textDim:'#a4a9be', textMuted:'#62677b',
};

const PATTERN_NAMES = {
  // ─ Single-candle ───────────────────────────────
  bullHammer:     'Hammer ↑',
  invertedHammer: 'Inv. Hammer ↑',
  pinBarBull:     'Pin Bar ↑',
  dojiStar:       'Doji —',
  dragonflyDoji:  'Dragonfly Doji ↑',
  gravestoneDoji: 'Gravestone Doji ↓',
  marubozuBull:   'Marubozu ↑',
  marubozuBear:   'Marubozu ↓',
  spintop:        'Spinning Top —',
  // ─ Single-candle bear ──────────────────────────
  hangingMan:     'Hanging Man ↓',
  shootingStar:   'Shooting Star ↓',
  // ─ 2-candle ────────────────────────────────
  bullEngulfing:  'Engulfing ↑',
  bearEngulfing:  'Engulfing ↓',
  bullHarami:     'Harami ↑',
  bearHarami:     'Harami ↓',
  tweezersBot:    'Tweezer Bot ↑',
  tweezersTop:    'Tweezer Top ↓',
  piercingLine:   'Piercing Line ↑',
  darkCloud:      'Dark Cloud ↓',
  onNeck:         'On-Neck ↓',
  // ─ 3-candle ────────────────────────────────
  morningStar:    'Morning Star ↑',
  eveningStar:    'Evening Star ↓',
  threeWhite:     '3 White Soldiers ↑',
  threeBlack:     '3 Black Crows ↓',
};

const PATTERN_DESC = {
  bullHammer:     'Nến Hammer: bóng dưới dài ≥2× than, bóng trên ngắn. Tín hiệu đảo chiều tăng.',
  invertedHammer: 'Inverted Hammer: bóng trên dài, bóng dưới ngắn, xuất hiện đáy. Cần xác nhận nến sau.',
  pinBarBull:     'Pin Bar tăng: bóng dưới chiếm >60% toàn nến. Từ chối giá thấp mạnh.',
  dojiStar:       'Doji: mở và đóng xấp xỉ nhau. Thị trường lưỡng lự, cần xác nhận chiều.',
  dragonflyDoji:  'Dragonfly Doji: bóng dưới rất dài, không có bóng trên. Mạnh khi đầu xuống.',
  gravestoneDoji: 'Gravestone Doji: bóng trên rất dài, không có bóng dưới. Mạnh khi đầu lên.',
  marubozuBull:   'Marubozu Tăng: không có bóng (hoặc rất ngắn). Lực mua áp đảo hoàn toàn.',
  marubozuBear:   'Marubozu Giảm: không có bóng (hoặc rất ngắn). Lực bán áp đảo hoàn toàn.',
  spintop:        'Spinning Top: than nhỏ, bóng 2 bên dài. Không có chiều rõ ràng.',
  hangingMan:     'Hanging Man: giống Hammer nhưng đứng đầu xu, cảnh báo đảo chiều giảm.',
  shootingStar:   'Shooting Star: bóng trên dài, xuất hiện đầu lên. Từ chối giá cao mạnh.',
  bullEngulfing:  'Bull Engulfing: nến xanh bao trùm nến đỏ trước. Đảo chiều tăng mạnh.',
  bearEngulfing:  'Bear Engulfing: nến đỏ bao trùm nến xanh trước. Đảo chiều giảm mạnh.',
  bullHarami:     'Bull Harami: nến nhỏ xanh nằm trong than nến đỏ lớn. Cần xác nhận.',
  bearHarami:     'Bear Harami: nến nhỏ đỏ nằm trong than nến xanh lớn. Cần xác nhận.',
  tweezersBot:    'Tweezer Bottom: 2 nến có đáy rất gần nhau. Vrùng hỗ trợ mạnh.',
  tweezersTop:    'Tweezer Top: 2 nến có đỉnh rất gần nhau. Vùng káng cự mạnh.',
  piercingLine:   'Piercing Line: nến xanh đóng trên 50% than nến đỏ. Đảo chiều tăng.',
  darkCloud:      'Dark Cloud: nến đỏ mở trên cao, đóng dưới 50% nến xanh. Đảo chiều giảm.',
  onNeck:         'On-Neck: nến đỏ đóng gần đáy nến xanh trước. Giảm tiếp tục.',
  morningStar:    'Morning Star: đỏ lớn → Doji → xanh lớn. Đảo chiều tăng rất mạnh.',
  eveningStar:    'Evening Star: xanh lớn → Doji → đỏ lớn. Đảo chiều giảm rất mạnh.',
  threeWhite:     '3 White Soldiers: 3 nến xanh tăng liên tiếp, mỗi nến mở cao hơn. Đà tăng mạnh.',
  threeBlack:     '3 Black Crows: 3 nến đỏ giảm liên tiếp, mỗi nến mở thấp hơn. Đà giảm mạnh.',
};

// ============================================
// STRATEGY REGISTRY — Plugin Architecture
// Each strategy: { id, name, icon, desc, defaultParams, color, run(candles, params)→trades[] }
// ============================================
const STRATEGY_REGISTRY = {
  ema_crossover: {
    id: 'ema_crossover',
    name: 'EMA 20/50',
    icon: '📈',
    color: '#00f5a0',
    desc: 'EMA 20 cắt EMA 50 + Retest + Mô hình nến đảo chiều',
    defaultParams: { fastEMA: 20, slowEMA: 50 },
    run(candles, params) {
      const { slMode, slValue, atrPeriod, rrRatio, capital, sizeType, sizeValue,
              pattern: filterPattern, feeRate, maxHoldBars,
              fastEMA = 20, slowEMA = 50 } = params;
      const ema20  = calcEMA(candles, fastEMA);
      const ema50  = calcEMA(candles, slowEMA);
      const atrArr = slMode === 'atr' ? calcATR(candles, atrPeriod) : null;
      const cxs    = scanCrossovers(ema20, ema50);
      const trades = []; let cap = capital;
      cxs.forEach((cx, ci) => {
        const nextCx  = cxs[ci + 1];
        const rt      = findRetest(candles, ema20, ema50, cx.index, cx.type, nextCx?.index);
        if (!rt) return;
        const pattern = detectPattern(candles, rt.index, cx.type);
        if (!pattern) return;
        if (filterPattern && filterPattern !== 'all' && pattern !== filterPattern) return;
        const sigIdx  = Math.min(rt.index + 1, candles.length - 1);
        const trade   = simulateTrade(candles, sigIdx, cx.type, slMode, slValue, atrArr, rrRatio, cap, sizeType, sizeValue, feeRate, maxHoldBars);
        if (!trade) return;
        trade.pattern = pattern;
        trades.push(trade);
        cap += trade.pnl;
      });
      return trades;
    }
  },

  rsi_reversal: {
    id: 'rsi_reversal',
    name: 'RSI Reversal',
    icon: '🔄',
    color: '#a855f7',
    desc: 'RSI oversold (<30) bounce hoặc overbought (>70) rejection với xác nhận nến',
    defaultParams: { rsiPeriod: 14, oversold: 30, overbought: 70 },
    run(candles, params) {
      const { slMode, slValue, atrPeriod, rrRatio, capital, sizeType, sizeValue,
              feeRate, maxHoldBars, pattern: filterPattern,
              rsiPeriod = 14, oversold = 30, overbought = 70 } = params;
      const rsi    = calcRSI(candles, rsiPeriod);
      const atrArr = slMode === 'atr' ? calcATR(candles, atrPeriod) : null;
      const sigs   = scanRSISignals(candles, rsi, oversold, overbought);
      const trades = []; let cap = capital;
      sigs.forEach(sig => {
        // Xác nhận nến đảo chiều tại điểm tín hiệu
        const pattern = detectPattern(candles, sig.index, sig.type);
        if (!pattern) return;
        if (filterPattern && filterPattern !== 'all' && pattern !== filterPattern) return;
        const sigIdx = Math.min(sig.index + 1, candles.length - 1);
        const trade  = simulateTrade(candles, sigIdx, sig.type, slMode, slValue, atrArr, rrRatio, cap, sizeType, sizeValue, feeRate, maxHoldBars);
        if (!trade) return;
        trade.pattern = pattern;
        trade.rsiAtEntry = rsi[sig.index];
        trades.push(trade);
        cap += trade.pnl;
      });
      return trades;
    }
  },

  bb_bounce: {
    id: 'bb_bounce',
    name: 'Bollinger Bands',
    icon: '📊',
    color: '#f97316',
    desc: 'Giá bounce từ BB lower/upper trở về trong band với xác nhận nến',
    defaultParams: { bbPeriod: 20, bbStdDev: 2 },
    run(candles, params) {
      const { slMode, slValue, atrPeriod, rrRatio, capital, sizeType, sizeValue,
              feeRate, maxHoldBars, pattern: filterPattern,
              bbPeriod = 20, bbStdDev = 2 } = params;
      const bb     = calcBB(candles, bbPeriod, bbStdDev);
      const atrArr = slMode === 'atr' ? calcATR(candles, atrPeriod) : null;
      const sigs   = scanBBSignals(candles, bb);
      const trades = []; let cap = capital;
      sigs.forEach(sig => {
        // Tùy chọn xác nhận nến (không bắt buộc để nhiều tín hiệu hơn)
        const pattern = detectPattern(candles, sig.index, sig.type) || (sig.type === 'bull' ? 'bullHammer' : 'shootingStar');
        if (filterPattern && filterPattern !== 'all' && pattern !== filterPattern) return;
        const sigIdx = Math.min(sig.index + 1, candles.length - 1);
        const trade  = simulateTrade(candles, sigIdx, sig.type, slMode, slValue, atrArr, rrRatio, cap, sizeType, sizeValue, feeRate, maxHoldBars);
        if (!trade) return;
        trade.pattern = pattern;
        trade.bbRef   = sig.bandRef;
        trades.push(trade);
        cap += trade.pnl;
      });
      return trades;
    }
  },

  false_breakout: {
    id: 'false_breakout',
    name: 'False Breakout',
    icon: '🪤',
    color: '#ec4899',
    desc: 'Giá phá vỡ N-bar high/low giả rồi đóng cửa trở lại trong range → fade the fakeout',
    defaultParams: { fbLookback: 20, fbBreakoutPct: 0.2, fbRequirePattern: false },
    run(candles, params) {
      const { slMode, slValue, atrPeriod, rrRatio, capital, sizeType, sizeValue,
              feeRate, maxHoldBars, pattern: filterPattern,
              fbLookback = 20, fbBreakoutPct = 0.2, fbRequirePattern = false } = params;

      const swings = calcSwingLevels(candles, fbLookback);
      const atrArr = slMode === 'atr' ? calcATR(candles, atrPeriod) : null;
      const sigs   = scanFalseBreakouts(candles, swings, fbBreakoutPct / 100);

      const trades = []; let cap = capital;
      sigs.forEach(sig => {
        // Phát hiện nến đảo chiều tại điểm fakeout
        const pattern = detectPattern(candles, sig.index, sig.type)
          || (sig.type === 'bull' ? 'bullHammer' : 'shootingStar');

        // Nếu bật "yêu cầu xác nhận nến" mà không có pattern → bỏ qua
        if (fbRequirePattern && !detectPattern(candles, sig.index, sig.type)) return;
        if (filterPattern && filterPattern !== 'all' && pattern !== filterPattern) return;

        const sigIdx = Math.min(sig.index + 1, candles.length - 1);
        const trade  = simulateTrade(candles, sigIdx, sig.type, slMode, slValue, atrArr, rrRatio, cap, sizeType, sizeValue, feeRate, maxHoldBars);
        if (!trade) return;
        trade.pattern   = pattern;
        trade.fakeDir   = sig.fakeDir;
        trade.levelRef  = sig.levelRef;
        trade.breakPct  = sig.breakPct;
        trades.push(trade);
        cap += trade.pnl;
      });
      return trades;
    }
  },

  // ── TREND-FOLLOWING STRATEGIES ─────────────────────────────────────────────

  macd_crossover: {
    id: 'macd_crossover',
    name: 'MACD Crossover',
    icon: '📉',
    color: '#06b6d4',
    desc: 'MACD line cắt Signal line → xác nhận xu hướng bằng histogram',
    defaultParams: { macdFast: 12, macdSlow: 26, macdSig: 9 },
    run(candles, params) {
      const { slMode, slValue, atrPeriod, rrRatio, capital, sizeType, sizeValue,
              feeRate, maxHoldBars, pattern: filterPattern,
              macdFast = 12, macdSlow = 26, macdSig = 9 } = params;
      const macdData = calcMACD(candles, macdFast, macdSlow, macdSig);
      const atrArr   = slMode === 'atr' ? calcATR(candles, atrPeriod) : null;
      const sigs     = scanMACDSignals(candles, macdData);
      const trades   = []; let cap = capital;
      sigs.forEach(sig => {
        const pattern = detectPattern(candles, sig.index, sig.type)
          || (sig.type === 'bull' ? 'bullHammer' : 'shootingStar');
        if (filterPattern && filterPattern !== 'all' && pattern !== filterPattern) return;
        const sigIdx = Math.min(sig.index + 1, candles.length - 1);
        const trade  = simulateTrade(candles, sigIdx, sig.type, slMode, slValue, atrArr, rrRatio, cap, sizeType, sizeValue, feeRate, maxHoldBars);
        if (!trade) return;
        trade.pattern  = pattern;
        trade.macdVal  = sig.macdVal;
        trade.histVal  = sig.histVal;
        trades.push(trade);
        cap += trade.pnl;
      });
      return trades;
    }
  },

  supertrend: {
    id: 'supertrend',
    name: 'Supertrend',
    icon: '🔱',
    color: '#22c55e',
    desc: 'ATR-based trailing band — flip direction khi giá phá vỡ band',
    defaultParams: { stAtrPeriod: 10, stMultiplier: 3 },
    run(candles, params) {
      const { slMode, slValue, atrPeriod, rrRatio, capital, sizeType, sizeValue,
              feeRate, maxHoldBars, pattern: filterPattern,
              stAtrPeriod = 10, stMultiplier = 3 } = params;
      const stData = calcSupertrend(candles, stAtrPeriod, stMultiplier);
      const atrArr = slMode === 'atr' ? calcATR(candles, atrPeriod) : null;
      const sigs   = scanSupertrendSignals(candles, stData);
      const trades = []; let cap = capital;
      sigs.forEach(sig => {
        const pattern = detectPattern(candles, sig.index, sig.type)
          || (sig.type === 'bull' ? 'bullHammer' : 'shootingStar');
        if (filterPattern && filterPattern !== 'all' && pattern !== filterPattern) return;
        const sigIdx = Math.min(sig.index + 1, candles.length - 1);
        const trade  = simulateTrade(candles, sigIdx, sig.type, slMode, slValue, atrArr, rrRatio, cap, sizeType, sizeValue, feeRate, maxHoldBars);
        if (!trade) return;
        trade.pattern = pattern;
        trade.stVal   = sig.stVal;
        trades.push(trade);
        cap += trade.pnl;
      });
      return trades;
    }
  },

  donchian_breakout: {
    id: 'donchian_breakout',
    name: 'Donchian Breakout',
    icon: '📦',
    color: '#f59e0b',
    desc: 'Giá đóng cửa phá vỡ N-bar high/low → follow the trend (ngược False Breakout)',
    defaultParams: { dcLookback: 20, dcClosePct: 0.1 },
    run(candles, params) {
      const { slMode, slValue, atrPeriod, rrRatio, capital, sizeType, sizeValue,
              feeRate, maxHoldBars, pattern: filterPattern,
              dcLookback = 20, dcClosePct = 0.1 } = params;
      const swings = calcSwingLevels(candles, dcLookback);
      const atrArr = slMode === 'atr' ? calcATR(candles, atrPeriod) : null;
      const sigs   = scanDonchianBreakouts(candles, swings, dcClosePct / 100);
      const trades = []; let cap = capital;
      sigs.forEach(sig => {
        const pattern = detectPattern(candles, sig.index, sig.type)
          || (sig.type === 'bull' ? 'marubozuBull' : 'marubozuBear');
        if (filterPattern && filterPattern !== 'all' && pattern !== filterPattern) return;
        const sigIdx = Math.min(sig.index + 1, candles.length - 1);
        const trade  = simulateTrade(candles, sigIdx, sig.type, slMode, slValue, atrArr, rrRatio, cap, sizeType, sizeValue, feeRate, maxHoldBars);
        if (!trade) return;
        trade.pattern  = pattern;
        trade.levelRef = sig.levelRef;
        trade.breakPct = sig.breakPct;
        trades.push(trade);
        cap += trade.pnl;
      });
      return trades;
    }
  },

  turtle_trading: {
    id: 'turtle_trading',
    name: 'Turtle Trading',
    icon: '🐢',
    color: '#6366f1',
    desc: 'Richard Dennis 1983 — Dual Donchian channel breakout + 2×ATR stop + Win Filter',
    defaultParams: {
      ttSystem: 'S1',   // 'S1' (20/10) hoặc 'S2' (55/20)
      ttEntry: 20,      // Entry channel period
      ttExit: 10,       // Exit channel period  
      ttAtrPeriod: 20,  // ATR period = "N" trong nguyên bản
      ttNStop: 2,       // SL = ttNStop × ATR(N)
      ttWinFilter: true,// Skip entry nếu lệnh trước là WIN (System 1 rule)
    },
    run(candles, params) {
      const {
        capital, sizeType, sizeValue, feeRate, maxHoldBars,
        ttSystem = 'S1',
        ttEntry:    rawEntry = 20,
        ttExit:     rawExit  = 10,
        ttAtrPeriod = 20,
        ttNStop     = 2,
        ttWinFilter = true,
      } = params;

      // System presets override manual periods when preset is used
      let entryPeriod = +rawEntry;
      let exitPeriod  = +rawExit;
      if (ttSystem === 'S1') { entryPeriod = 20; exitPeriod = 10; }
      if (ttSystem === 'S2') { entryPeriod = 55; exitPeriod = 20; }

      // Cần đủ dữ liệu
      if (candles.length < entryPeriod + 5) return [];

      const entryCh = calcSwingLevels(candles, entryPeriod);
      const exitCh  = calcSwingLevels(candles, exitPeriod);
      const atrArr  = calcATR(candles, ttAtrPeriod);

      const trades   = [];
      let cap        = capital;
      let lastResult = null;   // 'WIN' | 'LOSS' — cho Win Filter
      let i          = entryPeriod;

      while (i < candles.length - 1) {
        const entHigh = entryCh.swingHigh[i];
        const entLow  = entryCh.swingLow[i];
        const N       = atrArr[i];
        if (!entHigh || !entLow || !N) { i++; continue; }

        const c = candles[i];
        let sigType = null;

        // Entry: close breaks out of entry channel
        if      (c.close > entHigh) sigType = 'bull';
        else if (c.close < entLow)  sigType = 'bear';

        if (!sigType) { i++; continue; }

        // ── WIN FILTER (System 1 only) ──────────────────────────────────────
        // Nguyên tắc gốc: bỏ qua tín hiệu nếu lệnh TRƯỚC đó win
        // (để tránh nhiều lệnh liên tiếp trong cùng một xu hướng)
        if (ttWinFilter && ttSystem === 'S1' && lastResult === 'WIN') {
          lastResult = null; // reset — chỉ skip 1 lần
          i++; continue;
        }

        // ── ENTRY ──────────────────────────────────────────────────────────
        const sigIdx   = Math.min(i + 1, candles.length - 1);
        const stopDist = ttNStop * N;  // 2×ATR theo nguyên bản

        const trade = simulateTurtleTrade(
          candles, sigIdx, sigType, stopDist, exitCh,
          cap, sizeType, sizeValue, feeRate, maxHoldBars
        );
        if (!trade) { i++; continue; }

        trade.pattern    = sigType === 'bull' ? 'marubozuBull' : 'marubozuBear';
        trade.atrN       = +N.toFixed(4);
        trade.stopDist   = +stopDist.toFixed(4);
        trade.entryLevel = +(sigType === 'bull' ? entHigh : entLow).toFixed(4);
        trade.exitReason = trade.exitReason;

        trades.push(trade);
        cap        += trade.pnl;
        lastResult  = trade.result;

        // Skip tới thanh cuối của lệnh (không chồng lệnh)
        i = sigIdx + trade.holdBars + 1;
      }

      return trades;
    }
  },
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

function getIntervalMs(interval) {
  const map = {
    "1m": 60000,
    "3m": 180000,
    "5m": 300000,
    "15m": 900000,
    "30m": 1800000,
    "1h": 3600000,
    "2h": 7200000,
    "4h": 14400000,
    "6h": 21600000,
    "8h": 28800000,
    "12h": 43200000,  // Fix: 12h = 43,200,000ms (was incorrectly 57,600,000)
    "1d": 86400000,
    "3d": 259200000,
    "1w": 604800000,
    "1M": 2592000000
  };
  return map[interval] || 14400000;
}

// Helper: format bars as human-readable duration
function fmtHoldBars(bars, interval) {
  if (!bars) return '—';
  const ms = bars * getIntervalMs(interval || '4h');
  const hours = ms / 3600000;
  if (hours < 24) return `${bars}b (~${Math.round(hours)}h)`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${bars}b (~${days}d)`;
  return `${bars}b (~${Math.round(days/30)}mo)`;
}

// ============================================
// AUTO-DOWNLOAD (SSE)
// ============================================
let _dlController = null;
let _dlQueueCancelled = false;
let _dlActiveReject = null;

// Sprint 3: Estimate download time based on interval & date range
function estimateDownload(interval, startMs, endMs) {
  const intervalMs  = getIntervalMs(interval);
  const totalBars   = Math.ceil((endMs - startMs) / intervalMs);
  const batchSize   = 1000;
  const batches     = Math.ceil(totalBars / batchSize);
  // Empirically ~1.5s per batch (Binance API latency)
  const secsEst     = Math.round(batches * 1.5);
  const minsEst     = Math.floor(secsEst / 60);
  const timeStr     = secsEst < 60
    ? `~${secsEst}s`
    : `~${minsEst}ph${secsEst % 60 > 0 ? ` ${secsEst % 60}s` : ''}`;
  return { totalBars, batches, timeStr };
}

async function autoDownloadSymbols(symbols, interval, startMs, endMs) {
  _dlQueueCancelled = false;
  _dlActiveReject = null;
  const overlay  = document.getElementById('dlOverlay');
  const titleEl  = document.getElementById('dlTitle');
  const subEl    = document.getElementById('dlSub');
  const barEl    = document.getElementById('dlProgressBar');
  const statsEl  = document.getElementById('dlStats');

  overlay.classList.add('active');

  for (let i = 0; i < symbols.length; i++) {
    if (_dlQueueCancelled) break;
    const symbol = symbols[i];
    const displaySymbol = symbol.replace('USDT', '/USDT');

    // Sprint 3: Show time estimate before download starts
    const est = startMs && endMs ? estimateDownload(interval, startMs, endMs) : null;
    const estStr = est ? ` · ${est.totalBars.toLocaleString()} nến · ${est.timeStr}` : '';
    
    titleEl.textContent = `Tải dữ liệu ${displaySymbol} (${i + 1}/${symbols.length})`;
    subEl.textContent   = `Kết nối Binance API${estStr}`;
    barEl.style.width   = '0%';
    statsEl.textContent = est ? `Ước tính ${est.batches} batch${estStr}` : '0 nến';

    try {
      await new Promise((resolve, reject) => {
        _dlActiveReject = reject;
        const url = `${LOCAL_API}/download?symbol=${symbol}&interval=${interval}`;
        const es  = new EventSource(url);
        _dlController = es;

        es.onmessage = e => {
          if (_dlQueueCancelled) {
            es.close();
            _dlController = null;
            _dlActiveReject = null;
            reject(new Error('Cancelled'));
            return;
          }
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
            subEl.textContent = 'Hoàn thành!';
            SS.dbSet.add(symbol);
            es.close();
            _dlController = null;
            _dlActiveReject = null;
            resolve(d.candles);
          } else if (d.type === 'error') {
            es.close();
            _dlController = null;
            _dlActiveReject = null;
            reject(new Error(d.msg));
          }
        };
        
        es.onerror = () => {
          es.close();
          _dlController = null;
          _dlActiveReject = null;
          reject(new Error('Mất kết nối server'));
        };
      });
      
      // Subtle pause between downloads to let database breathe
      if (i < symbols.length - 1) {
        await new Promise(r => setTimeout(r, 450));
      }
    } catch (err) {
      if (err.message === 'Cancelled') {
        break;
      }
      console.error(`Lỗi tải dữ liệu cho ${symbol}:`, err);
      showToast(`⚠️ Không thể tải ${displaySymbol}: ${err.message || err}`);
      if (symbols.length === 1) {
        overlay.classList.remove('active');
        throw err;
      }
      // Portfolio mode: continue to the next coin
    }
  }

  overlay.classList.remove('active');
  _dlController = null;
  _dlActiveReject = null;
  if (_dlQueueCancelled) {
    throw new Error('Đã hủy tải dữ liệu');
  }
}

async function autoDownloadSymbol(symbol, interval) {
  return autoDownloadSymbols([symbol], interval);
}

function cancelDownload() {
  _dlQueueCancelled = true;
  if (_dlController) { _dlController.close(); _dlController = null; }
  document.getElementById('dlOverlay').classList.remove('active');
  BT.loading = false;
  document.getElementById('btnRun').disabled = false;
  document.getElementById('btnRunText').textContent = '▶ Chạy Backtest';
  
  if (_dlActiveReject) {
    _dlActiveReject(new Error('Cancelled'));
    _dlActiveReject = null;
  }
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



async function loadCandles(symbol, interval, startTimeMs, endTimeMs, onProgress) {
  const end = endTimeMs || Date.now();
  try {
    return await fetchFromLocalDB(symbol, interval, startTimeMs, end, onProgress);
  } catch(e) {
    if (e.code === 'NO_DATA') {
      onProgress?.(-1, 0, `⬇ Chưa có dữ liệu — đang tải từ Binance...`);
      // Pass startMs/endMs so estimate is shown in overlay
      await autoDownloadSymbols([symbol], interval, startTimeMs, end);
      return await fetchFromLocalDB(symbol, interval, startTimeMs, end, onProgress);
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
// RSI (Wilder's Smoothed MA)
// ============================================
function calcRSI(candles, period = 14) {
  const rsi = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return rsi;

  // Seed: first avgGain / avgLoss as SMA
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = candles[i].close - candles[i - 1].close;
    if (delta > 0) avgGain += delta;
    else avgLoss += Math.abs(delta);
  }
  avgGain /= period;
  avgLoss /= period;
  rsi[period] = avgLoss === 0 ? 100 : +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(4);

  // Wilder smoothing
  for (let i = period + 1; i < candles.length; i++) {
    const delta = candles[i].close - candles[i - 1].close;
    const gain  = delta > 0 ? delta : 0;
    const loss  = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i]  = avgLoss === 0 ? 100 : +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(4);
  }
  return rsi;
}

// ============================================
// Bollinger Bands (SMA ± k*σ)
// ============================================
function calcBB(candles, period = 20, stdDev = 2) {
  const upper = new Array(candles.length).fill(null);
  const middle = new Array(candles.length).fill(null);
  const lower  = new Array(candles.length).fill(null);

  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1).map(c => c.close);
    const sma   = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - sma) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    middle[i] = +sma.toFixed(8);
    upper[i]  = +(sma + stdDev * sd).toFixed(8);
    lower[i]  = +(sma - stdDev * sd).toFixed(8);
  }
  return { upper, middle, lower };
}

// ============================================
// SCAN CROSSOVERS (EMA)
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
// SCAN RSI SIGNALS
// ============================================
/**
 * Tìm tín hiệu RSI: cross oversold từ dưới lên (bull), cross overbought từ trên xuống (bear)
 * Min distance: 3 bars giữa 2 tín hiệu cùng chiều để tránh noise
 */
function scanRSISignals(candles, rsi, oversold = 30, overbought = 70) {
  const signals = [];
  let lastSigIdx = -10;
  for (let i = 1; i < rsi.length - 1; i++) {
    if (rsi[i] === null || rsi[i-1] === null) continue;
    if (i - lastSigIdx < 3) continue;
    // Bull: RSI vừa cross lên từ dưới oversold
    if (rsi[i-1] <= oversold && rsi[i] > oversold) {
      signals.push({ index: i, type: 'bull' });
      lastSigIdx = i;
    }
    // Bear: RSI vừa cross xuống từ trên overbought
    else if (rsi[i-1] >= overbought && rsi[i] < overbought) {
      signals.push({ index: i, type: 'bear' });
      lastSigIdx = i;
    }
  }
  return signals;
}

// ============================================
// SCAN BOLLINGER BAND SIGNALS
// ============================================
/**
 * Tín hiệu: Close chạm hoặc vượt band rồi nến kế tiếp close trở về trong band (bounce)
 * Bull: close < lower → nến sau close > lower (bounce up từ lower band)
 * Bear: close > upper → nến sau close < upper (rejection từ upper band)
 */
function scanBBSignals(candles, bb) {
  const signals = [];
  let lastSigIdx = -5;
  for (let i = 1; i < candles.length - 1; i++) {
    if (!bb.lower[i] || !bb.upper[i] || !bb.lower[i-1] || !bb.upper[i-1]) continue;
    if (i - lastSigIdx < 3) continue;
    // Bull bounce: nến trước close < lower, nến hiện tại close > lower
    if (candles[i-1].close <= bb.lower[i-1] && candles[i].close > bb.lower[i]) {
      signals.push({ index: i, type: 'bull', bandRef: bb.lower[i] });
      lastSigIdx = i;
    }
    // Bear rejection: nến trước close > upper, nến hiện tại close < upper
    else if (candles[i-1].close >= bb.upper[i-1] && candles[i].close < bb.upper[i]) {
      signals.push({ index: i, type: 'bear', bandRef: bb.upper[i] });
      lastSigIdx = i;
    }
  }
  return signals;
}

// ============================================
// SWING LEVELS (Rolling N-bar Donchian)
// ============================================
/**
 * Trả về swing high/low dựa trên N nến nhìn về trước (lookback).
 * Không nhìn về tương lai → an toàn cho backtest realtime.
 * swingHigh[i] = highest high trong [i-lookback, i-1]
 * swingLow[i]  = lowest low  trong [i-lookback, i-1]
 */
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

// ============================================
// SCAN FALSE BREAKOUT SIGNALS (Fakeout)
// ============================================
/**
 * Phát hiện False Breakout (Fakeout):
 *
 * Bull Fakeout → tín hiệu SELL (fade breakout lên):
 *   - high > swingHigh + breakoutPct% (phá vỡ lên trên đủ xa)
 *   - close < swingHigh (đóng cửa trở lại bên dưới)  → đảo chiều giảm
 *
 * Bear Fakeout → tín hiệu BUY (fade breakout xuống):
 *   - low < swingLow - breakoutPct% (phá vỡ xuống đủ xa)
 *   - close > swingLow (đóng cửa trở lại bên trên)  → đảo chiều tăng
 *
 * Cooldown: 5 nến giữa 2 tín hiệu để tránh nhiều tín hiệu trong cùng zone
 */
function scanFalseBreakouts(candles, swings, breakoutPct = 0.002) {
  const { swingHigh, swingLow } = swings;
  const signals = [];
  let lastSigIdx = -10;
  for (let i = 1; i < candles.length - 1; i++) {
    if (!swingHigh[i] || !swingLow[i]) continue;
    if (i - lastSigIdx < 5) continue;
    const c = candles[i];

    // Bull Fakeout (fake break lên → SHORT):
    if (c.high > swingHigh[i] * (1 + breakoutPct) && c.close < swingHigh[i]) {
      signals.push({
        index: i, type: 'bear', fakeDir: 'up',
        levelRef: swingHigh[i],
        breakPct: +((c.high / swingHigh[i] - 1) * 100).toFixed(3),
      });
      lastSigIdx = i;
    }
    // Bear Fakeout (fake break xuống → LONG):
    else if (c.low < swingLow[i] * (1 - breakoutPct) && c.close > swingLow[i]) {
      signals.push({
        index: i, type: 'bull', fakeDir: 'down',
        levelRef: swingLow[i],
        breakPct: +((1 - c.low / swingLow[i]) * 100).toFixed(3),
      });
      lastSigIdx = i;
    }
  }
  return signals;
}

// ============================================
// MACD INDICATOR
// ============================================
/**
 * calcMACD(candles, fast, slow, signal)
 * Trả về: { macd[], signal[], hist[] }
 *   macd   = EMA(fast) - EMA(slow)
 *   signal = EMA(9) của MACD
 *   hist   = macd - signal
 */
function calcMACD(candles, fast = 12, slow = 26, sigPeriod = 9) {
  // Tính EMA nhanh và chậm trực tiếp từ closes
  const closes = candles.map(c => c.close);
  function ema(arr, period) {
    const k = 2 / (period + 1);
    const out = new Array(arr.length).fill(null);
    let prev = null;
    for (let i = 0; i < arr.length; i++) {
      if (i < period - 1) continue;
      if (prev === null) {
        prev = arr.slice(0, period).reduce((a, v) => a + v, 0) / period;
        out[i] = prev; continue;
      }
      prev = arr[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }
  const fastEMA = ema(closes, fast);
  const slowEMA = ema(closes, slow);

  const macdLine = closes.map((_, i) =>
    (fastEMA[i] !== null && slowEMA[i] !== null) ? fastEMA[i] - slowEMA[i] : null
  );

  // Signal line = EMA(sigPeriod) of MACD values (skip nulls)
  const macdVals = macdLine.filter(v => v !== null);
  const signalRaw = ema(macdVals, sigPeriod);
  // Map signal back onto original indices
  const signalLine = new Array(closes.length).fill(null);
  let macdIdx = 0;
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] !== null) {
      signalLine[i] = signalRaw[macdIdx++] ?? null;
    }
  }

  const hist = closes.map((_, i) =>
    (macdLine[i] !== null && signalLine[i] !== null) ? macdLine[i] - signalLine[i] : null
  );

  return { macd: macdLine, signal: signalLine, hist };
}

// ============================================
// SCAN MACD CROSSOVER SIGNALS
// ============================================
/**
 * Bull: MACD cắt lên trên signal + histogram vừa đổi sang dương
 * Bear: MACD cắt xuống dưới signal + histogram vừa đổi sang âm
 * Cooldown 3 nến
 */
function scanMACDSignals(candles, macdData) {
  const { macd, signal, hist } = macdData;
  const signals = [];
  let lastSigIdx = -5;
  for (let i = 1; i < candles.length - 1; i++) {
    if (macd[i] === null || signal[i] === null) continue;
    if (macd[i-1] === null || signal[i-1] === null) continue;
    if (i - lastSigIdx < 3) continue;

    const crossUp   = macd[i-1] < signal[i-1] && macd[i] >= signal[i];
    const crossDown = macd[i-1] > signal[i-1] && macd[i] <= signal[i];

    if (crossUp) {
      signals.push({ index: i, type: 'bull', macdVal: macd[i], histVal: hist[i] });
      lastSigIdx = i;
    } else if (crossDown) {
      signals.push({ index: i, type: 'bear', macdVal: macd[i], histVal: hist[i] });
      lastSigIdx = i;
    }
  }
  return signals;
}

// ============================================
// SUPERTREND INDICATOR
// ============================================
/**
 * Supertrend dựa trên ATR:
 *   Basic Upper = midpoint + multiplier × ATR
 *   Basic Lower = midpoint - multiplier × ATR
 * Band tightens khi giá confirm xu hướng
 * direction: 1 = bullish (giá trên lower band), -1 = bearish (giá dưới upper band)
 */
function calcSupertrend(candles, atrPeriod = 10, multiplier = 3) {
  const n = candles.length;
  const atr   = new Array(n).fill(null);
  const upper = new Array(n).fill(null);
  const lower = new Array(n).fill(null);
  const st    = new Array(n).fill(null);
  const dir   = new Array(n).fill(null); // 1=bull, -1=bear

  // Compute Wilder ATR
  let sumTR = 0;
  for (let i = 1; i <= atrPeriod && i < n; i++) {
    const c = candles[i], p = candles[i-1];
    sumTR += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  if (atrPeriod < n) atr[atrPeriod] = sumTR / atrPeriod;
  for (let i = atrPeriod + 1; i < n; i++) {
    const c = candles[i], p = candles[i-1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    atr[i] = (atr[i-1] * (atrPeriod - 1) + tr) / atrPeriod;
  }

  for (let i = atrPeriod; i < n; i++) {
    const mid  = (candles[i].high + candles[i].low) / 2;
    const band = multiplier * atr[i];
    let bUp = mid + band;
    let bLo = mid - band;

    // Adjust bands (prevent widening into prior trend)
    if (i > atrPeriod) {
      if (upper[i-1] !== null) bUp = (bUp < upper[i-1] || candles[i-1].close > upper[i-1]) ? bUp : upper[i-1];
      if (lower[i-1] !== null) bLo = (bLo > lower[i-1] || candles[i-1].close < lower[i-1]) ? bLo : lower[i-1];
    }
    upper[i] = bUp;
    lower[i] = bLo;

    // Direction
    if (i === atrPeriod) {
      dir[i] = candles[i].close > mid ? 1 : -1;
      st[i]  = dir[i] === 1 ? bLo : bUp;
    } else {
      const prevDir = dir[i-1];
      if (prevDir === -1 && candles[i].close > upper[i]) {
        dir[i] = 1; st[i] = bLo;
      } else if (prevDir === 1 && candles[i].close < lower[i]) {
        dir[i] = -1; st[i] = bUp;
      } else {
        dir[i] = prevDir;
        st[i]  = prevDir === 1 ? bLo : bUp;
      }
    }
  }

  return { st, dir, upper, lower };
}

// ============================================
// SCAN SUPERTREND SIGNALS
// ============================================
/**
 * Bull: direction đổi từ -1 → 1 (giá vượt upper band → trend flip lên)
 * Bear: direction đổi từ 1 → -1 (giá rớt dưới lower band → trend flip xuống)
 */
function scanSupertrendSignals(candles, stData) {
  const { dir } = stData;
  const signals = [];
  for (let i = 1; i < candles.length - 1; i++) {
    if (dir[i] === null || dir[i-1] === null) continue;
    if (dir[i-1] === -1 && dir[i] === 1) {
      signals.push({ index: i, type: 'bull', stVal: stData.st[i] });
    } else if (dir[i-1] === 1 && dir[i] === -1) {
      signals.push({ index: i, type: 'bear', stVal: stData.st[i] });
    }
  }
  return signals;
}

// ============================================
// SCAN DONCHIAN BREAKOUT SIGNALS
// ============================================
/**
 * Đây là breakout THẬT (ngược với Fakeout):
 * Bull: close > N-bar high (breakout lên → LONG trend)
 * Bear: close < N-bar low  (breakout xuống → SHORT trend)
 * Cooldown 5 nến + price phải vượt qua level đủ mạnh (closePct%)
 */
function scanDonchianBreakouts(candles, swings, closePct = 0.001) {
  const { swingHigh, swingLow } = swings;
  const signals = [];
  let lastSigIdx = -10;
  for (let i = 1; i < candles.length - 1; i++) {
    if (!swingHigh[i] || !swingLow[i]) continue;
    if (i - lastSigIdx < 5) continue;
    const c = candles[i];

    // Real Bull Breakout: close vượt N-bar high
    if (c.close > swingHigh[i] * (1 + closePct)) {
      signals.push({ index: i, type: 'bull', levelRef: swingHigh[i],
        breakPct: +((c.close / swingHigh[i] - 1) * 100).toFixed(3) });
      lastSigIdx = i;
    }
    // Real Bear Breakout: close thủng N-bar low
    else if (c.close < swingLow[i] * (1 - closePct)) {
      signals.push({ index: i, type: 'bear', levelRef: swingLow[i],
        breakPct: +((1 - c.close / swingLow[i]) * 100).toFixed(3) });
      lastSigIdx = i;
    }
  }
  return signals;
}

// ============================================
// TURTLE TRADING — CUSTOM TRADE SIMULATOR
// ============================================
/**
 * Khác simulateTrade() ở chỗ:
 *  - Không dùng TP cố định: exit khi giá chạm EXIT CHANNEL (10-day low/high)
 *  - Stop loss vẫn là 2×N (ATR)
 *  - exitReason: 'SL' | 'EXIT_CHANNEL' | 'TIMEOUT'
 *
 * @param {Object[]} candles
 * @param {number}   sigIdx      - index của nến entry (đã +1 từ signal)
 * @param {string}   type        - 'bull' | 'bear'
 * @param {number}   stopDist    - khoảng cách SL = ttN × ATR
 * @param {Object}   exitCh      - { swingHigh, swingLow } — exit channel
 * @param {number}   capital     - vốn hiện tại
 * @param {string}   sizeType    - 'risk' | 'percent' | 'fixed'
 * @param {number}   sizeValue   - % hoặc USD
 * @param {number}   feeRate     - 0–1 (0.001 = 0.1%)
 * @param {number}   maxHoldBars - timeout
 */
function simulateTurtleTrade(candles, sigIdx, type, stopDist, exitCh, capital, sizeType, sizeValue, feeRate, maxHoldBars) {
  const entry = candles[sigIdx]?.close;
  if (!entry || stopDist <= 0) return null;

  const isBuy   = type === 'bull';
  const sl      = isBuy ? entry - stopDist : entry + stopDist;
  const fee     = feeRate || 0;
  const maxBars = maxHoldBars || 300;

  // Position sizing (same logic as simulateTrade)
  let posSize;
  if (sizeType === 'percent') {
    posSize = (capital * (sizeValue / 100)) / entry;
  } else if (sizeType === 'fixed') {
    posSize = sizeValue / entry;
  } else { // risk %
    posSize = (capital * (sizeValue / 100)) / stopDist;
  }
  let posValue = posSize * entry;
  if (posValue > capital && capital > 0) { posValue = capital; posSize = capital / entry; }

  for (let i = sigIdx + 1; i < Math.min(sigIdx + maxBars, candles.length); i++) {
    const c       = candles[i];
    const exitLow  = exitCh.swingLow[i];
    const exitHigh = exitCh.swingHigh[i];

    const hitSL = isBuy ? c.low <= sl : c.high >= sl;
    const hitExit = isBuy
      ? (exitLow  != null && c.low  <= exitLow)
      : (exitHigh != null && c.high >= exitHigh);

    if (hitSL || hitExit) {
      // SL price vs channel exit price — take worse for slippage realism
      let exitPx;
      if (hitSL && hitExit) {
        exitPx = isBuy ? Math.min(sl, exitLow ?? sl) : Math.max(sl, exitHigh ?? sl);
      } else {
        exitPx = hitSL ? sl : (isBuy ? exitLow : exitHigh);
      }
      const gross   = isBuy ? (exitPx - entry) * posSize : (entry - exitPx) * posSize;
      const feeCost = posValue * fee;
      const pnl     = gross - feeCost;
      return {
        result: pnl >= 0 ? 'WIN' : 'LOSS',
        pnl: +pnl.toFixed(2),
        pnlPct: +((pnl / posValue) * 100).toFixed(2),
        holdBars: i - sigIdx,
        entry, sl, tp: null, exitPrice: exitPx,
        posValue, feeCost: +feeCost.toFixed(2),
        exitReason: hitSL && !hitExit ? 'SL' : 'EXIT_CHANNEL',
      };
    }
  }

  // Timeout: close at last bar
  const last    = candles[Math.min(sigIdx + maxBars, candles.length - 1)];
  const gross   = isBuy ? (last.close - entry) * posSize : (entry - last.close) * posSize;
  const feeCost = posValue * fee;
  const pnl     = gross - feeCost;
  return {
    result: pnl >= 0 ? 'WIN' : 'LOSS',
    pnl: +pnl.toFixed(2),
    pnlPct: +((pnl / posValue) * 100).toFixed(2),
    holdBars: Math.min(sigIdx + maxBars, candles.length - 1) - sigIdx,
    entry, sl, tp: null, exitPrice: last.close,
    posValue, feeCost: +feeCost.toFixed(2),
    exitReason: 'TIMEOUT',
  };
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
// ============================================
// DETECT CANDLESTICK PATTERNS (v2 — 22 patterns)
// ============================================
/**
 * Returns the pattern key string, or null if no pattern matched.
 * Checks 3-candle → 2-candle → 1-candle (most specific first).
 * crossType: 'bull' = looking for bullish reversal, 'bear' = bearish reversal.
 */
function detectPattern(candles, idx, crossType) {
  const c0 = candles[idx]; if (!c0) return null;
  const c1 = idx >= 1 ? candles[idx - 1] : null;
  const c2 = idx >= 2 ? candles[idx - 2] : null;

  // Helpers
  const body    = v => Math.abs(v.close - v.open);
  const total   = v => v.high - v.low || 1e-10;
  const lower   = v => Math.min(v.open, v.close) - v.low;
  const upper   = v => v.high - Math.max(v.open, v.close);
  const isBull  = v => v.close > v.open;
  const isBear  = v => v.close < v.open;
  const midBody = v => (v.open + v.close) / 2;
  const topBody = v => Math.max(v.open, v.close);
  const botBody = v => Math.min(v.open, v.close);

  // ──────────────────────────────────────
  // 3-CANDLE PATTERNS
  // ──────────────────────────────────────
  if (c1 && c2) {
    const b0 = body(c0), b1 = body(c1), b2 = body(c2);

    // Morning Star: c2 bearish large, c1 small body gap down, c0 bullish large
    if (crossType === 'bull' &&
        isBear(c2) && b2 > total(c2) * 0.45 &&
        b1 < b2 * 0.45 && c1.high < topBody(c2) &&
        isBull(c0) && b0 > b2 * 0.5 && c0.close > midBody(c2)) {
      return 'morningStar';
    }

    // Evening Star: c2 bullish large, c1 small gap up, c0 bearish large
    if (crossType === 'bear' &&
        isBull(c2) && b2 > total(c2) * 0.45 &&
        b1 < b2 * 0.45 && c1.low > botBody(c2) &&
        isBear(c0) && b0 > b2 * 0.5 && c0.close < midBody(c2)) {
      return 'eveningStar';
    }

    // Three White Soldiers: 3 consecutive bullish candles, each closes higher
    if (crossType === 'bull' &&
        isBull(c2) && isBull(c1) && isBull(c0) &&
        c0.close > c1.close && c1.close > c2.close &&
        c0.open > c2.open &&
        upper(c0) < b0 * 0.4 && upper(c1) < b1 * 0.4) {
      return 'threeWhite';
    }

    // Three Black Crows: 3 consecutive bearish candles, each closes lower
    if (crossType === 'bear' &&
        isBear(c2) && isBear(c1) && isBear(c0) &&
        c0.close < c1.close && c1.close < c2.close &&
        c0.open < c2.open &&
        lower(c0) < b0 * 0.4 && lower(c1) < b1 * 0.4) {
      return 'threeBlack';
    }
  }

  // ──────────────────────────────────────
  // 2-CANDLE PATTERNS
  // ──────────────────────────────────────
  if (c1) {
    const b0 = body(c0), b1 = body(c1);

    // Bullish Engulfing: prev bear, curr bull bao trùm
    if (crossType === 'bull' &&
        isBear(c1) && isBull(c0) &&
        c0.open <= botBody(c1) && c0.close >= topBody(c1) &&
        b0 > b1 * 0.8) {
      return 'bullEngulfing';
    }

    // Bearish Engulfing: prev bull, curr bear bao trùm
    if (crossType === 'bear' &&
        isBull(c1) && isBear(c0) &&
        c0.open >= topBody(c1) && c0.close <= botBody(c1) &&
        b0 > b1 * 0.8) {
      return 'bearEngulfing';
    }

    // Bullish Harami: c1 bear large, c0 small bull bên trong
    if (crossType === 'bull' &&
        isBear(c1) && b1 > total(c1) * 0.4 &&
        isBull(c0) && b0 < b1 * 0.55 &&
        botBody(c0) >= botBody(c1) && topBody(c0) <= topBody(c1)) {
      return 'bullHarami';
    }

    // Bearish Harami: c1 bull large, c0 small bear bên trong
    if (crossType === 'bear' &&
        isBull(c1) && b1 > total(c1) * 0.4 &&
        isBear(c0) && b0 < b1 * 0.55 &&
        botBody(c0) >= botBody(c1) && topBody(c0) <= topBody(c1)) {
      return 'bearHarami';
    }

    // Tweezer Bottom: 2 nến có đáy rất gần nhau, c1 bear c0 bull
    if (crossType === 'bull' &&
        isBear(c1) && isBull(c0) &&
        Math.abs(c0.low - c1.low) < total(c1) * 0.05) {
      return 'tweezersBot';
    }

    // Tweezer Top: 2 nến có đỉnh rất gần nhau, c1 bull c0 bear
    if (crossType === 'bear' &&
        isBull(c1) && isBear(c0) &&
        Math.abs(c0.high - c1.high) < total(c1) * 0.05) {
      return 'tweezersTop';
    }

    // Piercing Line: c1 bear, c0 bull mở dưới low c1 và đóng trên 50% thân c1
    if (crossType === 'bull' &&
        isBear(c1) && isBull(c0) &&
        c0.open < c1.low &&
        c0.close > midBody(c1) && c0.close < topBody(c1)) {
      return 'piercingLine';
    }

    // Dark Cloud Cover: c1 bull, c0 bear mở trên high c1 và đóng dưới 50% thân c1
    if (crossType === 'bear' &&
        isBull(c1) && isBear(c0) &&
        c0.open > c1.high &&
        c0.close < midBody(c1) && c0.close > botBody(c1)) {
      return 'darkCloud';
    }

    // On-Neck: c1 bear, c0 bull nhỏ đóng gần đáy c1 (tiếp diễn giảm)
    if (crossType === 'bear' &&
        isBear(c1) && isBull(c0) &&
        Math.abs(c0.close - c1.low) < total(c1) * 0.06 &&
        b0 < b1 * 0.45) {
      return 'onNeck';
    }
  }

  // ──────────────────────────────────────
  // 1-CANDLE PATTERNS
  // ──────────────────────────────────────
  const b0   = body(c0);
  const tot0 = total(c0);
  const lo0  = lower(c0);
  const up0  = upper(c0);

  // Doji variants (ưu tiên trước khi check hammer/star)
  const isDoji = b0 / tot0 < 0.08;
  if (isDoji) {
    if (lo0 > tot0 * 0.6 && up0 < tot0 * 0.1) return 'dragonflyDoji';  // đuôi dưới dài
    if (up0 > tot0 * 0.6 && lo0 < tot0 * 0.1) return 'gravestoneDoji'; // đuôi trên dài
    return 'dojiStar';
  }

  // Marubozu: gần như không có bóng
  if (b0 > tot0 * 0.9) {
    return isBull(c0) ? 'marubozuBull' : 'marubozuBear';
  }

  // Spinning Top: thân nhỏ, bóng 2 bên tương đương
  if (b0 / tot0 < 0.25 && lo0 > tot0 * 0.2 && up0 > tot0 * 0.2) {
    return 'spintop';
  }

  // Pin Bar Bull: bóng dưới chiếm >60% tổng nến
  if (lo0 / tot0 > 0.6 && crossType === 'bull') return 'pinBarBull';

  // Hammer (bull): bóng dưới ≥2× thân, bóng trên ngắn
  if (b0 > 0 && lo0 >= b0 * 2 && up0 < b0 * 0.5) {
    return crossType === 'bull' ? 'bullHammer' : 'hangingMan';
  }

  // Inverted Hammer (bull): bóng trên dài, bóng dưới ngắn, xuất hiện đáy
  if (crossType === 'bull' && b0 > 0 && up0 >= b0 * 2 && lo0 < b0 * 0.5) {
    return 'invertedHammer';
  }

  // Shooting Star (bear): bóng trên dài
  if (crossType === 'bear' && b0 > 0 && up0 >= b0 * 2 && lo0 < b0 * 0.5) {
    return 'shootingStar';
  }

  // Fallback: generic signal theo crossType
  return crossType === 'bull' ? 'bullHammer' : 'shootingStar';
}

// ============================================
// UI SYNC FOR SIZING MODELS
// ============================================
function onSizeTypeChange() {
  const type = document.getElementById('btSizeType').value;
  const lbl = document.getElementById('lblSizeValue');
  const valInput = document.getElementById('btSizeValue');
  if (!lbl || !valInput) return;

  if (type === 'risk') {
    lbl.textContent = 'Rủi ro %';
    valInput.value = '2';
    valInput.min = '0.01';
    valInput.max = '100';
    valInput.step = '0.1';
  } else if (type === 'percent') {
    lbl.textContent = '% Vốn/lệnh';
    valInput.value = '10';
    valInput.min = '0.1';
    valInput.max = '100';
    valInput.step = '1';
  } else if (type === 'fixed') {
    lbl.textContent = 'Số USD';
    valInput.value = '1000';
    valInput.min = '1';
    valInput.removeAttribute('max');
    valInput.step = '100';
  }
}

// ============================================
// Sprint 3: ATR CONTEXT — show live ATR value
// ============================================
let _atrContextTimer = null;

async function updateATRContext() {
  const atrCtxEl = document.getElementById('atrContext');
  if (!atrCtxEl) return;
  const symbol   = document.getElementById('btSymbol')?.value?.toUpperCase()?.trim();
  const interval = document.getElementById('btInterval')?.value || '4h';
  const period   = parseInt(document.getElementById('atrPeriod')?.value || 14);
  const mult     = parseFloat(document.getElementById('atrMult')?.value || 1.5);
  if (!symbol) { atrCtxEl.textContent = ''; return; }

  atrCtxEl.textContent = '⏳ Đang tính ATR...';
  try {
    const res  = await fetch(`${LOCAL_API}/klines?symbol=${symbol}&interval=${interval}`);
    if (!res.ok) throw new Error('no data');
    const data = await res.json();
    if (!data || data.length < period + 2) throw new Error('insufficient data');

    const atrArr = calcATR(data, period);
    const lastATR = atrArr[atrArr.length - 1];
    if (!lastATR) throw new Error('ATR null');

    const entry    = data[data.length - 1].close;
    const slDist   = lastATR * mult;
    const slPct    = (slDist / entry * 100).toFixed(2);
    const tpDist   = slDist * parseFloat(document.getElementById('btRR')?.value || 2);
    const slPrice  = (entry - slDist).toFixed(2);
    const tpPrice  = (entry + tpDist).toFixed(2);

    atrCtxEl.innerHTML =
      `ATR(${period}) = <strong>$${lastATR.toFixed(2)}</strong> · ` +
      `SL dist = <span style="color:var(--red)">$${slDist.toFixed(2)} (${slPct}%)</span> · ` +
      `<span style="color:var(--text-muted)">SL≈$${slPrice} · TP≈$${tpPrice}</span>`;
  } catch(e) {
    atrCtxEl.textContent = e.message === 'no data'
      ? '⚠️ Chưa có dữ liệu — chạy backtest để tải'
      : `ATR: ${e.message}`;
  }
}

function onATRParamChange() {
  clearTimeout(_atrContextTimer);
  _atrContextTimer = setTimeout(updateATRContext, 600);
}

// ============================================
// SIMULATE TRADE (With Position Sizing Models)
// ============================================
function simulateTrade(candles, sigIdx, crossType, slMode, slValue, atrArr, rrRatio, capital, sizeType, sizeValue, feeRate, maxHoldBars) {
  const entry = candles[sigIdx]?.close; if (!entry) return null;
  const isBuy = crossType === 'bull';
  const maxBars = maxHoldBars || 80;
  const fee = feeRate || 0; // round-trip fee rate (e.g. 0.002 = 0.2%)

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
  
  let posSize = 0;
  if (sizeType === 'percent') {
    posSize = (capital * (sizeValue / 100)) / entry;
  } else if (sizeType === 'fixed') {
    posSize = sizeValue / entry;
  } else { // default is 'risk'
    posSize = (capital * (sizeValue / 100)) / slDist;
  }

  // Cap posValue to current capital for spot trading safety
  let posValue = posSize * entry;
  if (posValue > capital && capital > 0) {
    posValue = capital;
    posSize = capital / entry;
  }

  for (let i = sigIdx + 1; i < Math.min(sigIdx + maxBars, candles.length); i++) {
    const c = candles[i];
    const hitSL = isBuy ? c.low <= sl  : c.high >= sl;
    const hitTP = isBuy ? c.high >= tp : c.low  <= tp;
    if (hitSL || hitTP) {
      const result  = hitTP && !hitSL ? 'WIN' : 'LOSS';
      const exitPx  = result === 'WIN' ? tp : sl;
      const grossPnl = isBuy ? (exitPx - entry) * posSize : (entry - exitPx) * posSize;
      const feeCost  = posValue * fee;  // round-trip fee
      const pnl      = grossPnl - feeCost;
      const holdBars = i - sigIdx;
      return {
        entryTime: candles[sigIdx].time, exitTime: c.time,
        type: isBuy ? 'BUY' : 'SELL', entry, sl, tp, exitPrice: exitPx,
        result: pnl >= 0 ? 'WIN' : 'LOSS',
        pnl: +pnl.toFixed(2), pnlPct: +((pnl/posValue)*100).toFixed(2),
        holdBars, slDist, slMode, posSize, posValue, feeCost: +feeCost.toFixed(2),
      };
    }
  }
  const last      = candles[Math.min(sigIdx + maxBars, candles.length - 1)];
  const grossPnl  = isBuy ? (last.close - entry) * posSize : (entry - last.close) * posSize;
  const feeCost   = posValue * fee;
  const pnl       = grossPnl - feeCost;
  const holdBars  = Math.min(sigIdx + maxBars, candles.length - 1) - sigIdx;
  return {
    entryTime: candles[sigIdx].time, exitTime: last.time,
    type: isBuy ? 'BUY' : 'SELL', entry, sl, tp, exitPrice: last.close,
    result: pnl >= 0 ? 'WIN' : 'LOSS', pnl: +pnl.toFixed(2), pnlPct: +((pnl/posValue)*100).toFixed(2),
    holdBars, slDist, slMode, posSize, posValue, feeCost: +feeCost.toFixed(2),
  };
}

// ============================================
// RUN SINGLE SYMBOL — Strategy Dispatcher
// ============================================
function runSymbolBacktest(candles, params) {
  const strategyId = params.strategy || 'ema_crossover';
  const strategy   = STRATEGY_REGISTRY[strategyId] || STRATEGY_REGISTRY.ema_crossover;
  return strategy.run(candles, params);
}

// ============================================
// METRICS (extended with CAGR)
// ============================================
function calcMetrics(trades, capital, startTimeMs, endTimeMs) {
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

  // Calculate CAGR
  let durationYears = 1;
  if (startTimeMs && endTimeMs) {
    durationYears = (endTimeMs - startTimeMs) / (365.25 * 24 * 60 * 60 * 1000);
  } else {
    const times = trades.map(t => [t.entryTime, t.exitTime]).flat().filter(Boolean);
    if (times.length >= 2) {
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);
      durationYears = (maxTime - minTime) / (365.25 * 24 * 60 * 60 * 1000);
    }
  }
  if (durationYears <= 0) durationYears = 1;

  let cagr = 0;
  if (capital > 0) {
    if (equity <= 0) {
      cagr = -100;
    } else if (durationYears > 0.005) {
      cagr = (Math.pow(equity / capital, 1 / durationYears) - 1) * 100;
    }
  }

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
    cagr,
  };
}

// ============================================
// BUY AND HOLD METRICS
// ============================================
/**
 * Cải thiện của calcBuyAndHold:
 * - Mua tại nến đầu tiên trong khoảng [startMs, endMs]
 * - Bán tại nến cuối cùng
 * - Tạo equity curve theo từng nến dể vẽ overlay
 * - Gom về độ phân giải thấp hơn nếu quá nhiều nến (vẽ nhanh hơn)
 */
function calcBuyAndHold(candles, capital, startMs, endMs) {
  if (!candles || candles.length < 2) return null;

  const inRange = candles.filter(c => (!startMs || c.time >= startMs) && (!endMs || c.time <= endMs));
  if (inRange.length < 2) return null;

  const buyPrice  = inRange[0].close;
  const sellPrice = inRange[inRange.length - 1].close;
  const shares    = capital / buyPrice;

  // Equity curve theo từng nến (dample xuống nếu quá lớn)
  const MAX_POINTS = 500;
  const step = Math.max(1, Math.floor(inRange.length / MAX_POINTS));
  const sampledCandles = inRange.filter((_, i) => i % step === 0 || i === inRange.length - 1);
  const curve = sampledCandles.map(c => +(shares * c.close).toFixed(2));

  // Max Drawdown của B&H
  let peak = capital, maxDD = 0;
  curve.forEach(v => {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  });

  const totalPnL = +(shares * (sellPrice - buyPrice)).toFixed(2);
  const pnlPct   = +((sellPrice - buyPrice) / buyPrice * 100).toFixed(2);
  const finalCap = +(capital + totalPnL).toFixed(2);

  // CAGR
  const durationMs = (inRange[inRange.length - 1].time - inRange[0].time);
  const years      = durationMs / (365.25 * 24 * 3600 * 1000);
  const cagr       = years > 0.01
    ? +((Math.pow(finalCap / capital, 1 / years) - 1) * 100).toFixed(1)
    : 0;

  return {
    buyPrice, sellPrice, shares,
    totalPnL, pnlPct, finalCap,
    maxDrawdown: +maxDD.toFixed(1),
    cagr, curve,
    startDate: new Date(inRange[0].time).toLocaleDateString('vi-VN'),
    endDate:   new Date(inRange[inRange.length - 1].time).toLocaleDateString('vi-VN'),
    candles: inRange.length,
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
// RENDER EQUITY CURVE (v2 — with B&H overlay)
// ============================================
function renderEquityCurve(curve, trades, bhData) {
  const canvas = document.getElementById('equityCanvas');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.parentElement.offsetWidth - 32, H = 260;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const PAD = { top:24, right:100, bottom:40, left:82 };
  const cW = W - PAD.left - PAD.right, cH = H - PAD.top - PAD.bottom;

  // Combined min/max including B&H
  const allVals = [...curve, ...(bhData?.curve || [])];
  const minE = Math.min(...allVals) * 0.997;
  const maxE = Math.max(...allVals) * 1.003;
  const range = maxE - minE || 1;

  const toX  = (i, len) => PAD.left + (i / Math.max(len - 1, 1)) * cW;
  const toY  = v => PAD.top + cH - ((v - minE) / range) * cH;

  // Grid lines
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = PAD.top + (g / 4) * cH;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
    const val = maxE - (g / 4) * range;
    ctx.fillStyle = C.textMuted; ctx.font = '10px JetBrains Mono,monospace'; ctx.textAlign = 'right';
    ctx.fillText('$' + Math.round(val).toLocaleString(), PAD.left - 5, y + 4);
  }

  // ── B&H overlay ────────────────────────────────────
  if (bhData?.curve?.length >= 2) {
    const bc = bhData.curve;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(255, 165, 0, 0.65)';
    ctx.lineWidth   = 1.8;
    ctx.beginPath();
    bc.forEach((v, i) => {
      const x = toX(i, bc.length);
      const y = toY(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // B&H end label
    const bLast = bhData.curve[bhData.curve.length - 1];
    const bPct  = bhData.pnlPct >= 0 ? `+${bhData.pnlPct.toFixed(1)}%` : `${bhData.pnlPct.toFixed(1)}%`;
    ctx.fillStyle = 'rgba(255, 165, 0, 0.85)';
    ctx.font = '10px JetBrains Mono,monospace'; ctx.textAlign = 'left';
    ctx.fillText(`B&H ${bPct}`, W - PAD.right + 6, toY(bLast) + 4);
  }

  // ── Strategy area fill ────────────────────────────────
  ctx.beginPath(); ctx.moveTo(toX(0, curve.length), toY(curve[0]));
  curve.forEach((v, i) => ctx.lineTo(toX(i, curve.length), toY(v)));
  ctx.lineTo(toX(curve.length - 1, curve.length), PAD.top + cH);
  ctx.lineTo(PAD.left, PAD.top + cH); ctx.closePath();
  const isPos = curve[curve.length - 1] >= curve[0];
  const grd = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
  grd.addColorStop(0, isPos ? 'rgba(0, 245, 160, 0.15)' : 'rgba(255, 63, 96, 0.15)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd; ctx.fill();

  // ── Trade segments ────────────────────────────────────────
  trades.forEach((t, i) => {
    ctx.strokeStyle = t.result === 'WIN' ? C.green : C.red; ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(toX(i, curve.length), toY(curve[i]));
    ctx.lineTo(toX(i + 1, curve.length), toY(curve[i + 1]));
    ctx.stroke();
  });

  if (trades.length <= 400) {
    trades.forEach((t, i) => {
      const col = t.result === 'WIN' ? C.green : C.red;
      ctx.fillStyle = col; ctx.shadowBlur = 4; ctx.shadowColor = col;
      ctx.beginPath();
      ctx.arc(toX(i + 1, curve.length), toY(curve[i + 1]), trades.length > 150 ? 1.5 : 3, 0, Math.PI * 2);
      ctx.fill(); ctx.shadowBlur = 0;
    });
  }

  ctx.fillStyle = C.textDim;
  ctx.beginPath(); ctx.arc(toX(0, curve.length), toY(curve[0]), 4, 0, Math.PI * 2); ctx.fill();

  // Strategy end label
  const sLast  = curve[curve.length - 1];
  const sPct   = ((sLast - curve[0]) / curve[0] * 100);
  const sPctStr = sPct >= 0 ? `+${sPct.toFixed(1)}%` : `${sPct.toFixed(1)}%`;
  const sColor  = sLast >= curve[0] ? C.green : C.red;
  ctx.fillStyle = sColor; ctx.font = '10px JetBrains Mono,monospace'; ctx.textAlign = 'left';
  ctx.fillText(`Strat ${sPctStr}`, W - PAD.right + 6, toY(sLast) + 4);

  // X-axis time labels
  ctx.fillStyle = C.textMuted; ctx.font = '10px JetBrains Mono,monospace'; ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(trades.length / 8));
  trades.forEach((t, i) => {
    if (i % step !== 0) return;
    const d = new Date(t.entryTime);
    ctx.fillText(`${d.getMonth() + 1}/${d.getFullYear().toString().slice(2)}`, toX(i + 1, curve.length), H - PAD.bottom + 16);
  });

  // Legend
  ctx.font = '10px JetBrains Mono,monospace';
  const lx = PAD.left + 10, ly = PAD.top + 12;
  ctx.fillStyle = isPos ? C.green : C.red;
  ctx.fillRect(lx, ly - 8, 18, 3);
  ctx.fillStyle = C.textDim; ctx.textAlign = 'left';
  ctx.fillText('Chiến lược', lx + 22, ly);
  if (bhData) {
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(255,165,0,0.75)'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(lx + 90, ly - 5); ctx.lineTo(lx + 108, ly - 5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.textDim;
    ctx.fillText('Buy & Hold', lx + 112, ly);
  }
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
      const bg     = d.pnl >= 0 ? `rgba(0, 245, 160, ${alpha})` : `rgba(255, 63, 96, ${alpha})`;
      const sgn    = d.pnl >= 0 ? '+' : '';
      const tip    = `${d.total} lệnh · WR ${d.wr.toFixed(0)}% · ${sgn}$${Math.abs(d.pnl).toFixed(0)}`;
      return `<div class="hm-cell" style="background:${bg}" title="${tip}">
        <span class="hm-pnl">${sgn}$${Math.abs(d.pnl) < 1000 ? Math.abs(d.pnl).toFixed(0) : (Math.abs(d.pnl)/1000).toFixed(1)+'k'}</span>
        <span class="hm-wr">${d.wr.toFixed(0)}%</span>
      </div>`;
    });

    const ysgn   = yearPnl >= 0 ? '+' : '';
    const ybg    = yearPnl >= 0 ? 'rgba(0, 245, 160, 0.12)' : 'rgba(255, 63, 96, 0.12)';
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

  // Sắp xếp: nhiều giao dịch nhất trước
  const sorted = [...patternStats].sort((a, b) => b.total - a.total);

  sorted.forEach(p => {
    const wrc  = p.wr >= 50 ? 'pnl-pos' : 'pnl-neg';
    const pc   = p.pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
    const desc = PATTERN_DESC[p.pattern] || '';
    const dir  = p.name.includes('↑') ? '↑' : p.name.includes('↓') ? '↓' : '—';
    const dirCol = dir === '↑' ? 'var(--green)' : dir === '↓' ? 'var(--red)' : 'var(--text-muted)';

    // Score màu: WR * PF
    const score = p.wr * (p.avgPnl > 0 ? Math.min(p.avgPnl / 10, 3) : 0);
    const quality = score > 100 ? '🔥' : score > 50 ? '⭐' : '';

    const tr = document.createElement('tr');
    tr.title = desc;
    tr.style.cursor = 'help';
    tr.innerHTML = `
      <td style="color:var(--text)">
        <span style="font-weight:600">${p.name.replace(/[↑↓—]/, '').trim()}</span>
        <span style="color:${dirCol};margin-left:4px;font-size:11px">${dir}</span>
        ${quality ? `<span style="margin-left:4px;font-size:10px">${quality}</span>` : ''}
      </td>
      <td style="color:var(--text-muted)">${p.total}</td>
      <td style="color:var(--green)">${p.wins}</td>
      <td style="color:var(--red)">${p.losses}</td>
      <td class="${wrc}" style="font-weight:600">${p.wr.toFixed(1)}%</td>
      <td class="${p.avgPnl>=0?'pnl-pos':'pnl-neg'}">${p.avgPnl>=0?'+':'-'}$${Math.abs(p.avgPnl).toFixed(2)}</td>
      <td class="${pc}" style="font-weight:700">${p.pnl>=0?'+':'-'}$${Math.abs(p.pnl).toFixed(2)}</td>`;
    tbody.appendChild(tr);
  });

  // Thêm legend tooltip gợi ý
  const note = document.getElementById('patternTableNote');
  if (note) note.style.display = sorted.length ? 'block' : 'none';
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
  const showSymbol = trades.some(t => t.symbol);
  const symbolHeaders = document.querySelectorAll('.col-symbol');
  symbolHeaders.forEach(el => el.style.display = showSymbol ? 'table-cell' : 'none');

  const curInterval = document.getElementById('btInterval')?.value || '4h';
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
    const holdStr = fmtHoldBars(t.holdBars, curInterval);
    const feeStr  = t.feeCost > 0 ? ` <span style="color:var(--text-muted);font-size:10px">(-$${t.feeCost.toFixed(2)} fee)</span>` : '';
    row.innerHTML = `
      <td style="color:var(--text-muted)">${i+1}</td>
      ${t.symbol ? `<td class="col-symbol" style="color:var(--accent);font-weight:600;display:${showSymbol?'table-cell':'none'}">${t.symbol.replace('USDT','')}</td>` : ''}
      <td>${ds}</td>
      <td><span class="badge ${isBuy?'badge-buy':'badge-sell'}">${t.type}</span></td>
      <td style="font-family:var(--font-mono)">$${Math.round(t.posValue || 0).toLocaleString()}</td>
      <td style="color:var(--text-dim)">${PATTERN_NAMES[t.pattern]||'—'}</td>
      <td>${fmtP(t.entry)}</td><td style="color:var(--red)">${fmtP(t.sl)}</td>
      <td style="color:var(--green)">${fmtP(t.tp)}</td><td>${fmtP(t.exitPrice)}</td>
      <td style="color:var(--text-muted);font-size:10px">${slTag}</td>
      <td style="font-size:11px;white-space:nowrap">${holdStr}</td>
      <td><span class="badge ${t.result==='WIN'?'badge-win':'badge-loss'}">${t.result}</span></td>
      <td class="${pc}">${sg}$${Math.abs(t.pnl).toFixed(2)}${feeStr}</td>
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
let PORTFOLIO_COINS = [];

function toggleMode(mode) {
  BT.mode = mode;
  document.getElementById('modeSingle').classList.toggle('active', mode === 'single');
  document.getElementById('modePortfolio').classList.toggle('active', mode === 'portfolio');
  document.getElementById('singleSymbolWrap').style.display    = mode === 'single' ? 'flex' : 'none';
  document.getElementById('portfolioCoinsWrap').style.display  = mode === 'portfolio' ? 'flex' : 'none';
}

async function initPortfolioChips() {
  const wrap = document.getElementById('portfolioChips');
  if (!wrap) return;
  
  wrap.innerHTML = `<div class="loading-chips">⌛ Đang tải danh sách Top 100 coin...</div>`;
  
  try {
    const res = await fetch('/api/top100');
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    PORTFOLIO_COINS = data.coins || [];
    renderPortfolioChips();
    updateSelectedCountBadge();
  } catch (e) {
    console.error("Failed to load top 100 portfolio coins:", e);
    // Fallback if API fails
    PORTFOLIO_COINS = [
      { symbol: 'BTCUSDT', base: 'BTC', price: 0, change: 0, name: 'Bitcoin' },
      { symbol: 'ETHUSDT', base: 'ETH', price: 0, change: 0, name: 'Ethereum' },
      { symbol: 'BNBUSDT', base: 'BNB', price: 0, change: 0, name: 'BNB' },
      { symbol: 'SOLUSDT', base: 'SOL', price: 0, change: 0, name: 'Solana' },
      { symbol: 'XRPUSDT', base: 'XRP', price: 0, change: 0, name: 'Ripple' },
      { symbol: 'ADAUSDT', base: 'ADA', price: 0, change: 0, name: 'Cardano' },
      { symbol: 'DOGEUSDT', base: 'DOGE', price: 0, change: 0, name: 'Dogecoin' },
      { symbol: 'AVAXUSDT', base: 'AVAX', price: 0, change: 0, name: 'Avalanche' },
      { symbol: 'LINKUSDT', base: 'LINK', price: 0, change: 0, name: 'Chainlink' },
      { symbol: 'DOTUSDT', base: 'DOT', price: 0, change: 0, name: 'Polkadot' }
    ];
    renderPortfolioChips();
    updateSelectedCountBadge();
  }
}

function renderPortfolioChips() {
  const wrap = document.getElementById('portfolioChips');
  if (!wrap) return;
  
  const defaultChecked = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
  
  wrap.innerHTML = PORTFOLIO_COINS.map(coin => {
    const sym = coin.symbol;
    const base = coin.base;
    const checked = defaultChecked.includes(sym);
    
    let changeClass = '';
    let changeText = '';
    if (coin.change !== undefined && coin.change !== 0) {
      const sign = coin.change > 0 ? '+' : '';
      changeClass = coin.change > 0 ? 'up' : 'down';
      changeText = `<span class="chip-change ${changeClass}">${sign}${coin.change.toFixed(1)}%</span>`;
    }
    
    let titleAttr = `${coin.name || base}`;
    if (coin.price) {
      titleAttr += `\nGiá: $${coin.price.toLocaleString()}`;
    }
    if (coin.volume) {
      titleAttr += `\nVol 24h: $${coin.volume.toLocaleString()}`;
    }
    if (coin.market_cap) {
      titleAttr += `\nCap: $${coin.market_cap.toLocaleString()}`;
    }
    
    return `<label class="chip-label ${checked ? 'selected' : ''}" id="chip-${sym}" title="${titleAttr}">
      <input type="checkbox" value="${sym}" ${checked ? 'checked' : ''} onchange="toggleChip('${sym}', this)">
      <span>${base}</span>
      ${changeText}
    </label>`;
  }).join('');
}

function toggleChip(sym, input) {
  const chip = document.getElementById(`chip-${sym}`);
  if (chip) chip.classList.toggle('selected', input.checked);
  updateSelectedCountBadge();
}

function updateSelectedCountBadge() {
  const badge = document.getElementById('selectedCount');
  if (!badge) return;
  const count = getSelectedPortfolioSymbols().length;
  badge.textContent = `Đã chọn: ${count}`;
}

function filterPortfolioChips() {
  const query = document.getElementById('portfolioSearch').value.toUpperCase().trim();
  const chips = document.querySelectorAll('#portfolioChips .chip-label');
  
  chips.forEach(chip => {
    const symbolInput = chip.querySelector('input');
    if (!symbolInput) return;
    const sym = symbolInput.value;
    const base = sym.replace('USDT', '');
    
    const matches = base.includes(query) || sym.includes(query);
    chip.style.display = matches ? 'inline-flex' : 'none';
  });
}

function selectTopCoins(count) {
  const inputs = document.querySelectorAll('#portfolioChips input[type=checkbox]');
  inputs.forEach((input, index) => {
    const isSelected = index < count;
    input.checked = isSelected;
    const chip = document.getElementById(`chip-${input.value}`);
    if (chip) chip.classList.toggle('selected', isSelected);
  });
  updateSelectedCountBadge();
}

function deselectAllCoins() {
  const inputs = document.querySelectorAll('#portfolioChips input[type=checkbox]');
  inputs.forEach(input => {
    input.checked = false;
    const chip = document.getElementById(`chip-${input.value}`);
    if (chip) chip.classList.remove('selected');
  });
  updateSelectedCountBadge();
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
  const ctx = document.getElementById('atrContext');
  if (ctx) ctx.style.display = mode === 'atr' ? 'block' : 'none';
  if (mode === 'atr') updateATRContext();
}

// ============================================
// METRIC TOOLTIPS
// ============================================
const METRIC_TIPS = {
  statWinRate:    '% lệnh thắng.\n> 50% = tốt\nLưu ý: win rate cao chưa chắc lãi nếu avg loss lớn hơn avg win.',
  statPF:         'Profit Factor = Tổng lãi / Tổng lỗ.\n> 1.5 = tốt · > 2.0 = xuất sắc\n"∞" = không có lệnh thua.',
  statPnL:        'Tổng lợi nhuận sau phí (nếu có cài đặt phí giao dịch).',
  statFinal:      'Vốn cuối kỳ sau khi cộng tất cả lãi/lỗ.',
  statDD:         'Max Drawdown: mức giảm vốn lớn nhất từ đỉnh.\n< 15% = an toàn · < 30% = chấp nhận được\n> 50% = nguy hiểm cho tâm lý.',
  statCAGR:       'CAGR = Compound Annual Growth Rate.\nTỷ lệ tăng trưởng vốn trung bình mỗi năm (đã gộp lãi).',
  statSharpe:     'Sharpe Ratio = lợi nhuận / rủi ro (dựa trên monthly returns).\n> 1.0 = tốt · > 2.0 = xuất sắc\n< 0 = chiến lược tệ hơn giữ cash.',
  statSortino:    'Sortino Ratio = như Sharpe nhưng chỉ tính downside risk.\n> 1.5 = tốt · Cao hơn Sharpe = ít lỗ bất ngờ.',
  statRecovery:   'Recovery Factor = Tổng PnL / Drawdown tuyệt đối.\n> 2.0 = tốt: lãi gấp đôi mức drawdown tối đa.',
  statExpectancy: 'Kỳ vọng trung bình mỗi lệnh = (WR × AvgWin) − (LossRate × AvgLoss).\nPhải > $0 để chiến lược có lãi dài hạn.',
  statAvgHold:    'Thời gian giữ lệnh trung bình tính theo số nến (bars).',
};

function initMetricTooltips() {
  Object.entries(METRIC_TIPS).forEach(([id, tip]) => {
    const card = document.getElementById(id)?.closest?.('.stat-card, .stat-card-sm');
    if (!card) return;
    const label = card.querySelector('.stat-label, .stat-label-sm');
    if (!label || label.querySelector('.tip-icon')) return;
    const icon = document.createElement('span');
    icon.className = 'tip-icon';
    icon.textContent = ' ⓘ';
    icon.title = tip;
    icon.style.cssText = 'font-size:10px;opacity:0.5;cursor:help;vertical-align:middle';
    label.appendChild(icon);
  });
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
  set('statPF', m.profitFactor === 999 ? '∞' : m.profitFactor.toFixed(2), v => v === '∞' || parseFloat(v) >= 1 ? 'var(--green)' : 'var(--red)');
  set('statPnL', fmtMoney(m.totalPnL));
  document.getElementById('statPnL').className = 'stat-value ' + (m.totalPnL >= 0 ? 'green' : 'red');
  set('statFinal', '$' + Math.round(m.finalCapital).toLocaleString());
  document.getElementById('statFinal').style.color = m.finalCapital >= capital ? 'var(--green)' : 'var(--red)';
  set('statDD', `-${m.maxDrawdown.toFixed(1)}%`);
  set('statAvgWin', `+$${m.avgWin.toFixed(2)}`);
  set('statAvgLoss', `-$${m.avgLoss.toFixed(2)}`);

  // Fee disclaimer
  const feeEl = document.getElementById('feeDisclaimer');
  if (feeEl) {
    const feeRate = parseFloat(document.getElementById('btFeeRate')?.value || 0);
    const totalFees = m.totalFees || 0;
    if (feeRate > 0 && totalFees > 0) {
      feeEl.textContent = `⚠️ Đã trừ phí giao dịch: -$${totalFees.toFixed(2)} (${feeRate}% × 2 chiều)`;
      feeEl.style.display = 'block';
    } else if (feeRate === 0) {
      feeEl.textContent = '⚠️ Chưa tính phí giao dịch — kết quả thực tế sẽ thấp hơn (~0.1-0.2% mỗi lệnh)';
      feeEl.style.display = 'block';
    } else {
      feeEl.style.display = 'none';
    }
  }

  // CAGR
  const cagrVal = m.cagr !== undefined ? `${m.cagr >= 0 ? '+' : ''}${m.cagr.toFixed(1)}%` : '—';
  set('statCAGR', cagrVal);
  const cagrCard = document.getElementById('statCAGRCard');
  if (cagrCard) {
    if (m.cagr >= 0) {
      cagrCard.classList.add('highlight-green');
      cagrCard.classList.remove('highlight-red');
      document.getElementById('statCAGR').style.color = 'var(--green)';
    } else {
      cagrCard.classList.add('highlight-red');
      cagrCard.classList.remove('highlight-green');
      document.getElementById('statCAGR').style.color = 'var(--red)';
    }
  }

  // Extended
  set('statSharpe', m.sharpe, v => parseFloat(v) >= 1 ? 'var(--green)' : parseFloat(v) < 0 ? 'var(--red)' : 'var(--text)');
  set('statSortino', m.sortino, v => parseFloat(v) >= 1.5 ? 'var(--green)' : parseFloat(v) < 0 ? 'var(--red)' : 'var(--text)');
  set('statRecovery', m.recoveryFactor);
  set('statExpectancy', `${m.expectancy >= 0 ? '+' : ''}$${m.expectancy}`);
  const curInterval = document.getElementById('btInterval')?.value || '4h';
  set('statAvgHold', fmtHoldBars(m.avgHold, curInterval));
  set('statMaxLoss', m.maxLossStreak);
  set('statMaxWin', m.maxWinStreak);

  initMetricTooltips();
}

// ============================================
// MAIN: RUN BACKTEST
// ============================================
async function runBacktest() {
  if (BT.loading) return;
  BT.loading = true;

  const interval = document.getElementById('btInterval').value;
  const startDateStr = document.getElementById('btStartDate').value;
  const endDateStr = document.getElementById('btEndDate').value;
  const rrRatio  = parseFloat(document.getElementById('btRR').value);
  const capital  = parseFloat(document.getElementById('btCapital').value);

  if (!startDateStr || !endDateStr) {
    showToast('⚠️ Vui lòng chọn đầy đủ từ ngày và đến ngày');
    BT.loading = false;
    return;
  }

  const startTimeMs = new Date(startDateStr).getTime();
  const endTimeMs = new Date(endDateStr).getTime() + 86_399_999; // Đến cuối ngày kết thúc

  if (startTimeMs >= endTimeMs) {
    showToast('⚠️ Ngày bắt đầu phải trước ngày kết thúc');
    BT.loading = false;
    return;
  }

  // SL params
  const slMode  = document.getElementById('slModeATR').classList.contains('active') ? 'atr' : 'fixed';
  const slValue = slMode === 'atr'
    ? parseFloat(document.getElementById('atrMult').value || 1.5)
    : parseFloat(document.getElementById('btSL').value);
  const atrPeriod = parseInt(document.getElementById('atrPeriod')?.value || 14);

  // Sizing params
  const sizeType = document.getElementById('btSizeType').value;
  const sizeValue = parseFloat(document.getElementById('btSizeValue').value);

  // Candlestick Pattern params
  const selectedPattern = document.getElementById('btPattern')?.value || 'all';

  // Fee & Max Hold params
  const feeRate   = parseFloat(document.getElementById('btFeeRate')?.value || 0) / 100; // convert % to decimal
  const maxHoldBars = parseInt(document.getElementById('btMaxHold')?.value || 80);

  // Strategy selection
  const strategyId     = getActiveStrategy();
  const strategyExtra  = getStrategyParams(strategyId);

  const params = { slMode, slValue, atrPeriod, rrRatio, capital, sizeType, sizeValue,
                   pattern: selectedPattern, feeRate, maxHoldBars,
                   strategy: strategyId, ...strategyExtra };

  // Determine list of symbols to test
  let symbolsToTest = [];
  if (BT.mode === 'portfolio') {
    symbolsToTest = getSelectedPortfolioSymbols();
    if (symbolsToTest.length < 1) {
      showToast('⚠️ Chọn ít nhất 1 coin trong danh mục');
      BT.loading = false;
      return;
    }
  } else {
    const symbol = document.getElementById('btSymbol').value.toUpperCase().trim();
    if (!symbol) {
      showToast('⚠️ Vui lòng nhập coin cần backtest');
      BT.loading = false;
      return;
    }
    symbolsToTest = [symbol];
  }

  // Pre-check for missing or outdated local data
  showToast('⏳ Đang kiểm tra dữ liệu local...');
  let missingSymbols = [];
  try {
    const metaList = await fetchMeta();
    const intervalMs = getIntervalMs(interval);
    const nowMs = Date.now();
    const targetEndMs = Math.min(endTimeMs, nowMs);

    missingSymbols = symbolsToTest.filter(sym => {
      const m = metaList.find(x => x.symbol === sym && x.interval === interval);
      if (!m || m.count === 0) return true; // Completely missing
      
      // Outdated if lastTime in DB is older than targetEndMs (allowing 2 intervals of latency)
      const isOutdated = m.lastTime < (targetEndMs - 2 * intervalMs);
      return isOutdated;
    });
  } catch (e) {
    console.error("Lỗi khi kiểm tra dữ liệu local:", e);
    missingSymbols = [...symbolsToTest]; // Safe fallback: assume all need check
  }

  // Auto-download all missing data sequentially (pass date range for estimate)
  if (missingSymbols.length > 0) {
    const est = estimateDownload(interval, startTimeMs, endTimeMs);
    showToast(`⬇️ ${missingSymbols.length} coin thiếu/cũ · ${est.totalBars.toLocaleString()} nến · ${est.timeStr} mỗi coin`);
    try {
      await autoDownloadSymbols(missingSymbols, interval, startTimeMs, endTimeMs);
      showToast('✅ Tải dữ liệu thành công!');
    } catch (err) {
      console.error("Lỗi khi tải dữ liệu:", err);
      showToast(`❌ Không thể tải dữ liệu: ${err.message || err}`);
      BT.loading = false;
      return;
    }
  }

  setLoading(true);

  try {
    let allTrades  = [];
    let perSymbol  = {};

    if (BT.mode === 'portfolio') {
      // ── PORTFOLIO MODE ──────────────────────────────
      // Sprint 3: Portfolio capital tracking
      // Vốn chia đều ban đầu, nhưng lãi/lỗ của coin trước được cộng dồn
      // vào vốn pool → capital per coin phản ánh thực tế hơn
      const symbols    = getSelectedPortfolioSymbols();
      if (symbols.length < 1) {
        showToast('⚠️ Chọn ít nhất 1 coin trong danh mục'); setLoading(false); BT.loading = false; return;
      }
      let runningCap   = capital;          // tổng vốn pool hiện tại
      const perCapInit = capital / symbols.length; // vốn ban đầu mỗi slot

      for (let i = 0; i < symbols.length; i++) {
        const sym    = symbols[i];
        // Mỗi coin được cấp vốn = phần còn lại chia đều theo số slot còn lại
        const slotCap = runningCap / (symbols.length - i);
        setProgress(
          Math.round(i / symbols.length * 80),
          `⏳ ${sym.replace('USDT','/USDT')} (${i+1}/${symbols.length}) · Pool: $${Math.round(runningCap).toLocaleString()}`
        );

        try {
          const candles = await loadCandles(sym, interval, startTimeMs, endTimeMs,
            (pct, cnt, label) => {
              if (pct === -1) setProgress(Math.round(i/symbols.length*80), label);
            });

          if (!candles || candles.length < 10) {
            console.warn(`Bỏ qua ${sym}: Không đủ dữ liệu (${candles ? candles.length : 0} nến)`);
            showToast(`⚠️ ${sym.replace('USDT','/USDT')} không đủ dữ liệu. Bỏ qua.`);
            // Không dùng slot này → vốn vẫn nguyên, nhưng cần cộng lại cho pool
            // (slot không dùng vẫn được giữ trong runningCap)
            continue;
          }

          const trades = runSymbolBacktest(candles, { ...params, capital: slotCap });
          trades.forEach(t => t.symbol = sym);

          // Sprint 3: Cộng lãi/lỗ thực của coin vào pool
          const symPnL = trades.reduce((s, t) => s + t.pnl, 0);
          runningCap  += symPnL;  // pool tăng nếu lãi, giảm nếu lỗ

          const symMetrics = calcMetrics(trades, slotCap, startTimeMs, endTimeMs);
          perSymbol[sym]   = { trades, candles: candles.length, metrics: symMetrics, slotCap };
          allTrades.push(...trades);
        } catch (err) {
          console.error(`Lỗi xử lý backtest cho ${sym}:`, err);
          showToast(`⚠️ Không thể xử lý ${sym.replace('USDT','/USDT')}. Bỏ qua.`);
        }
      }

      allTrades.sort((a, b) => a.entryTime - b.entryTime);
      showToast(`⏳ Tính toán metrics... Pool cuối: $${Math.round(runningCap).toLocaleString()}`);
      setProgress(90, `Tính metrics · Pool: $${Math.round(runningCap).toLocaleString()}`);

    } else {
      // ── SINGLE MODE ─────────────────────────────────
      const symbol = document.getElementById('btSymbol').value.toUpperCase().trim();
      showToast(`⏳ Chuẩn bị ${symbol.replace('USDT','/USDT')} ${interval}...`);

      const candles = await loadCandles(symbol, interval, startTimeMs, endTimeMs,
        (pct, count, label) => {
          if (pct === -1) { setProgress(0, label); return; }
          setProgress(pct, label || `${count.toLocaleString()} nến`);
        });

      if (candles.length < 100) {
        showToast('⚠️ Chỉ có ' + candles.length + ' nến — không đủ dữ liệu');
        setLoading(false); BT.loading = false; return;
      }

      allTrades = runSymbolBacktest(candles, params);
      perSymbol[symbol] = { trades: allTrades, candles: candles.length, metrics: calcMetrics(allTrades, capital, startTimeMs, endTimeMs) };
      setProgress(80, `✅ ${allTrades.length} tín hiệu`);
    }

    BT.trades = allTrades;
    await refreshDataManager();

    if (!allTrades.length) {
      showToast(`⚠️ Không tìm thấy tín hiệu nào`);
      setLoading(false); BT.loading = false; hideProgress(); return;
    }

    // ── COMPUTE METRICS ─────────────────────────────
    const m = calcMetrics(allTrades, capital, startTimeMs, endTimeMs);
    // Compute total fees paid
    m.totalFees = allTrades.reduce((s, t) => s + (t.feeCost || 0), 0);
    const patternStats = calcPatternStats(allTrades);

    // ── BUY & HOLD ───────────────────────────────────
    // Lấy candles của symbol đại diện (single mode: symbol đó; portfolio: coin đầu tiên)
    try {
      const refSymbol = BT.mode === 'portfolio'
        ? getSelectedPortfolioSymbols()[0]
        : document.getElementById('btSymbol').value.toUpperCase().trim();
      const refCandles = await fetchFromLocalDB(refSymbol, interval, startTimeMs, endTimeMs);
      BT.bhData = calcBuyAndHold(refCandles, capital, startTimeMs, endTimeMs);
    } catch(e) {
      BT.bhData = null;
      console.warn('B&H calc failed:', e);
    }

    // ── STORE RUN IN BT.runs ─────────────────────────
    const stratId   = params.strategy || 'ema_crossover';
    const stratInfo = STRATEGY_REGISTRY[stratId];
    const runId     = Date.now();
    const runLabel  = BT.mode === 'portfolio'
      ? `${Object.keys(perSymbol).length} coin`
      : Object.keys(perSymbol)[0]?.replace('USDT','/USDT');

    // Remove duplicate run cho cùng strategy (giữ run mới nhất)
    BT.runs = BT.runs.filter(r => r.strategyId !== stratId);
    BT.runs.push({
      id: runId, strategyId: stratId,
      strategyName: stratInfo?.name || stratId,
      icon: stratInfo?.icon || '📈',
      color: stratInfo?.color || '#00f5a0',
      trades: allTrades, metrics: m,
      params, symbol: runLabel, interval,
      startDateStr, endDateStr, capital,
      bhData: BT.bhData,
    });
    BT.activeRunId = runId;

    // ── UPDATE UI ───────────────────────────────────
    document.getElementById('btCandleCount').textContent =
      `${stratInfo?.icon || ''} ${stratInfo?.name || stratId} · ${allTrades.length} lệnh · ${runLabel} · ${interval} · ${startDateStr} → ${endDateStr}`;

    document.getElementById('statsBar').style.display = 'block';
    document.getElementById('btMain').style.display   = 'flex';
    document.getElementById('btEmpty').style.display  = 'none';

    renderStats(m, capital);
    updateRunBadges();

    setTimeout(() => {
      renderEquityCurve(m.equityCurve, allTrades, BT.bhData);
      renderMonthlyHeatmap(m.monthly);
      renderDistribution(allTrades, m);
      renderPatternTable(patternStats);
      renderSymbolBreakdown(perSymbol);
      renderTradeTable(allTrades);
      renderBHComparison(m, BT.bhData, capital);
      if (BT.runs.length >= 2) renderStrategyComparison();
      hideProgress();
    }, 50);

    const pnlStr = m.totalPnL >= 0 ? `+$${m.totalPnL.toFixed(2)}` : `-$${Math.abs(m.totalPnL).toFixed(2)}`;
    showToast(`✅ ${stratInfo?.icon || ''} ${stratInfo?.name || stratId}: ${allTrades.length} lệnh · WR ${m.winRate.toFixed(1)}% · ${pnlStr}`);

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
// UPDATE RUN BADGES (tab pills)
// ============================================
function updateRunBadges() {
  const container = document.getElementById('runBadgeBar');
  if (!container) return;
  container.innerHTML = BT.runs.map(r => {
    const pnl = r.metrics?.totalPnL || 0;
    const pnlStr = pnl >= 0 ? `+${pnl.toFixed(0)}` : pnl.toFixed(0);
    const pnlCls = pnl >= 0 ? 'pos' : 'neg';
    const isActive = r.id === BT.activeRunId ? 'active' : '';
    return `<div class="run-badge ${isActive}" data-run-id="${r.id}" onclick="switchRun(${r.id})" style="--badge-color:${r.color}">
      <span>${r.icon} ${r.strategyName}</span>
      <span class="run-badge-pnl ${pnlCls}">$${pnlStr}</span>
      <span class="run-badge-close" onclick="event.stopPropagation();removeRun(${r.id})">×</span>
    </div>`;
  }).join('');
  container.style.display = BT.runs.length >= 2 ? 'flex' : 'none';
}

// Switch active run (xem kết quả của run khác)
function switchRun(runId) {
  const run = BT.runs.find(r => r.id === runId);
  if (!run) return;
  BT.activeRunId = runId;
  BT.trades = run.trades;
  BT.bhData = run.bhData;
  const m = run.metrics;
  const patternStats = calcPatternStats(run.trades);
  renderStats(m, run.capital);
  renderEquityCurve(m.equityCurve, run.trades, run.bhData);
  renderMonthlyHeatmap(m.monthly);
  renderDistribution(run.trades, m);
  renderPatternTable(patternStats);
  renderTradeTable(run.trades);
  renderBHComparison(m, run.bhData, run.capital);
  if (BT.runs.length >= 2) renderStrategyComparison();
  updateRunBadges();
  document.getElementById('btCandleCount').textContent =
    `${run.icon} ${run.strategyName} · ${run.trades.length} lệnh · ${run.symbol} · ${run.interval} · ${run.startDateStr} → ${run.endDateStr}`;
}

// Remove a run
function removeRun(runId) {
  BT.runs = BT.runs.filter(r => r.id !== runId);
  if (BT.activeRunId === runId && BT.runs.length > 0) {
    switchRun(BT.runs[BT.runs.length - 1].id);
  }
  updateRunBadges();
  const cmpSection = document.getElementById('stratCompareSection');
  if (cmpSection) cmpSection.style.display = BT.runs.length >= 2 ? 'block' : 'none';
}

// ============================================
// RENDER STRATEGY COMPARISON TABLE
// ============================================
function renderStrategyComparison() {
  const section = document.getElementById('stratCompareSection');
  if (!section) return;
  section.style.display = 'block';

  const runs = BT.runs;
  if (runs.length < 2) { section.style.display = 'none'; return; }

  const metrics = [
    { key: 'totalPnL',       label: '💰 Tổng PnL ($)',    fmt: v => (v>=0?'+':'')+v.toFixed(2), higher: true },
    { key: 'winRate',        label: '🎯 Win Rate',         fmt: v => v.toFixed(1)+'%',           higher: true },
    { key: 'profitFactor',   label: '⚡ Profit Factor',    fmt: v => v===999?'∞':v.toFixed(2),   higher: true },
    { key: 'cagr',           label: '📅 CAGR/Năm',         fmt: v => (v>=0?'+':'')+v+'%',        higher: true },
    { key: 'maxDrawdown',    label: '📉 Max Drawdown',      fmt: v => '-'+v.toFixed(1)+'%',       higher: false },
    { key: 'sharpe',         label: '⚖️ Sharpe',           fmt: v => v,                          higher: true },
  ];

  // Tính điểm champion cho từng tiêu chí
  const champions = metrics.map(metric => {
    const vals = runs.map(r => +r.metrics[metric.key]);
    const best = metric.higher ? Math.max(...vals) : Math.min(...vals);
    return runs.findIndex(r => +r.metrics[metric.key] === best);
  });

  const winCounts = runs.map(() => 0);
  champions.forEach(ci => { if (ci >= 0) winCounts[ci]++; });
  const overallWinner = winCounts.indexOf(Math.max(...winCounts));

  const headerCells = runs.map(r =>
    `<th style="color:${r.color};text-align:center">${r.icon} ${r.strategyName}</th>`
  ).join('');

  const rows = metrics.map((metric, mi) => {
    const cells = runs.map((r, ri) => {
      const val = r.metrics[metric.key];
      const cls = ri === champions[mi] ? 'pnl-pos' : '';
      const trophy = ri === champions[mi] ? ' 🏆' : '';
      return `<td class="${cls}" style="text-align:center;font-weight:${ri===champions[mi]?700:400}">${metric.fmt(val)}${trophy}</td>`;
    }).join('');
    return `<tr><td style="color:var(--text-dim)">${metric.label}</td>${cells}</tr>`;
  }).join('');

  // Số lệnh row
  const tradesRow = `<tr>
    <td style="color:var(--text-dim)">📋 Số Lệnh</td>
    ${runs.map(r => `<td style="text-align:center;color:var(--text-muted)">${r.trades.length}</td>`).join('')}
  </tr>`;

  // Verdict
  const winner = runs[overallWinner];
  const verdict = `<div style="text-align:center;padding:12px;background:var(--bg4);border-radius:var(--radius);margin-top:12px;font-weight:700;color:${winner.color}">
    🏆 Chiến lược tốt nhất: ${winner.icon} ${winner.strategyName} (${winCounts[overallWinner]}/${metrics.length} tiêu chí)
  </div>`;

  // Equity overlay với nhiều màu
  const equityCanvasNote = `<div style="font-size:11px;color:var(--text-muted);padding:4px 0 8px">
    ${runs.map(r => `<span style="color:${r.color};margin-right:16px">● ${r.icon} ${r.strategyName}</span>`).join('')}
    ${BT.bhData ? `<span style="color:#f59e0b;border-bottom:2px dashed #f59e0b">● 💤 Buy &amp; Hold</span>` : ''}
  </div>`;

  section.innerHTML = `
    <div class="bt-section-header">
      <h2 class="bt-section-title">⚡ So Sánh Chiến Lược</h2>
      <span style="font-size:11px;color:var(--text-muted)">${runs.length} chiến lược · ${runs[0]?.symbol || ''} · ${runs[0]?.interval || ''}</span>
    </div>
    ${equityCanvasNote}
    <div class="trade-table-wrap">
      <table class="trade-table">
        <thead><tr>
          <th>Tiêu chí</th>${headerCells}
        </tr></thead>
        <tbody>${rows}${tradesRow}</tbody>
      </table>
    </div>
    ${verdict}
  `;

  // Redraw equity curve với tất cả runs overlaid
  renderMultiStrategyEquity();
}

// ============================================
// MULTI-STRATEGY EQUITY OVERLAY
// ============================================
function renderMultiStrategyEquity() {
  const canvas = document.getElementById('equityCanvas');
  if (!canvas || !BT.runs.length) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const PAD = { t: 30, r: 90, b: 40, l: 70 };

  ctx.clearRect(0, 0, W, H);

  // Gather all equity curves
  const allCurves = BT.runs.map(r => ({
    label: r.strategyName, icon: r.icon, color: r.color,
    curve: r.metrics?.equityCurve || [],
    capital: r.capital
  }));

  // Add B&H if available
  const activeRun = BT.runs.find(r => r.id === BT.activeRunId) || BT.runs[0];
  if (activeRun?.bhData?.curve) {
    allCurves.push({
      label: 'Buy & Hold', icon: '💤', color: '#f59e0b', dash: true,
      curve: activeRun.bhData.curve, capital: activeRun.capital
    });
  }

  if (!allCurves.length) return;

  // Compute global min/max
  const allVals = allCurves.flatMap(c => c.curve).filter(v => v != null && !isNaN(v));
  if (!allVals.length) return;
  let minV = Math.min(...allVals), maxV = Math.max(...allVals);
  const range = maxV - minV || 1;
  minV -= range * 0.05;
  maxV += range * 0.05;

  const cW = W - PAD.l - PAD.r;
  const cH = H - PAD.t - PAD.b;

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PAD.t + (cH / 4) * i;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + cW, y); ctx.stroke();
    const val = maxV - (maxV - minV) / 4 * i;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('$' + val.toFixed(0), PAD.l - 6, y + 4);
  }

  // Draw each curve
  allCurves.forEach(series => {
    const pts = series.curve;
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = series.color;
    ctx.lineWidth   = series.dash ? 1.5 : 2;
    if (series.dash) ctx.setLineDash([6, 4]);
    else ctx.setLineDash([]);
    pts.forEach((v, i) => {
      const x = PAD.l + (i / (pts.length - 1)) * cW;
      const y = PAD.t + cH - ((v - minV) / (maxV - minV)) * cH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Label at right edge
    const lastV = pts[pts.length - 1];
    const lastY = PAD.t + cH - ((lastV - minV) / (maxV - minV)) * cH;
    const pct   = series.capital > 0 ? ((lastV - series.capital) / series.capital * 100) : 0;
    const pctStr = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
    ctx.font = 'bold 10px JetBrains Mono, monospace';
    ctx.fillStyle = series.color;
    ctx.textAlign = 'left';
    ctx.fillText(series.icon + ' ' + pctStr, PAD.l + cW + 6, Math.max(PAD.t + 10, Math.min(H - PAD.b - 5, lastY)));
  });
}



// ============================================
// STRATEGY TAB SWITCHING
// ============================================

/**
 * Turtle System preset selector — called by S1/S2/Custom buttons in param panel
 * Updates the hidden input, auto-fills entry/exit period inputs,
 * shows/hides the custom period row, and adjusts Win Filter state.
 */
function selectTurtleSystem(system) {
  document.getElementById('s_ttSystem').value = system;
  // Button states
  ['S1','S2','custom'].forEach(s => {
    const el = document.getElementById(`ttBtn${s.charAt(0).toUpperCase() + s.slice(1)}`);
    if (el) el.classList.toggle('tt-active', s === system);
  });
  // Show/hide custom period inputs
  const customRow = document.getElementById('tt-custom-params');
  if (customRow) customRow.style.display = system === 'custom' ? 'flex' : 'none';
  // Auto-fill periods for presets
  const entryEl = document.getElementById('s_ttEntry');
  const exitEl  = document.getElementById('s_ttExit');
  const filterEl = document.getElementById('s_ttWinFilter');
  if (system === 'S1') {
    if (entryEl) entryEl.value = 20;
    if (exitEl)  exitEl.value  = 10;
    if (filterEl) filterEl.checked = true;  // S1 uses Win Filter
  } else if (system === 'S2') {
    if (entryEl) entryEl.value = 55;
    if (exitEl)  exitEl.value  = 20;
    if (filterEl) filterEl.checked = false; // S2 does NOT use Win Filter
  }
}

function switchStrategy(strategyId, tabEl) {
  // Update active tab
  document.querySelectorAll('.strat-tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');

  // Update description
  const desc = STRATEGY_REGISTRY[strategyId]?.desc || '';
  const descEl = document.getElementById('stratTabDesc');
  if (descEl) descEl.textContent = desc;

  // Toggle param panels
  document.querySelectorAll('.strat-params-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`params-${strategyId}`);
  if (panel) panel.classList.add('active');

  // Update strategy-specific active color on tab bar
  const tabBar = document.getElementById('stratTabBar');
  if (tabBar) {
    const color = STRATEGY_REGISTRY[strategyId]?.color || 'var(--accent)';
    tabBar.style.setProperty('--active-strat-color', color);
    // Update active tab border color dynamically
    document.querySelectorAll('.strat-tab.active').forEach(t => {
      t.style.borderBottomColor = color;
      t.style.color = color;
    });
  }

  // Update equity curve legend visibility
  const legends = {
    ema_crossover: 'legEMA', rsi_reversal: 'legRSI', bb_bounce: 'legBB',
    false_breakout: 'legFB', macd_crossover: 'legMACD',
    supertrend: 'legST', donchian_breakout: 'legDC',
    turtle_trading: 'legTT',
  };
  Object.values(legends).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const activeLeg = document.getElementById(legends[strategyId]);
  if (activeLeg) activeLeg.style.display = '';
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
    const startDateStr = document.getElementById('btStartDate').value;
    const endDateStr   = document.getElementById('btEndDate').value;
    const startTimeMs  = startDateStr ? new Date(startDateStr).getTime() : 0;
    const endTimeMs    = endDateStr   ? new Date(endDateStr).getTime() + 86_399_999 : Date.now();
    const m = calcMetrics(BT.trades, parseFloat(document.getElementById('btCapital').value), startTimeMs, endTimeMs);
    if (m) renderEquityCurve(m.equityCurve, BT.trades, BT.bhData);
  }, 200);
});

// ============================================
// RENDER BUY & HOLD COMPARISON
// ============================================
function renderBHComparison(stratMetrics, bh, capital) {
  const section = document.getElementById('bhCompareSection');
  if (!section) return;
  section.style.display = 'block';

  if (!bh) {
    section.innerHTML = `
      <div class="bt-section-header">
        <h2 class="bt-section-title">💰 So Sánh: Chiến Lược vs Buy &amp; Hold</h2>
      </div>
      <div style="padding:20px;color:var(--text-muted);font-family:var(--font-mono);font-size:12px">
        Không có dữ liệu B&H — chạy backtest để tải
      </div>`;
    return;
  }

  const s = stratMetrics;
  const rows = [
    {
      metric: '💰 Tổng PnL',
      strat:  { val: `${s.totalPnL >= 0 ? '+' : ''}$${s.totalPnL.toFixed(2)}`, pos: s.totalPnL >= 0 },
      bh:     { val: `${bh.totalPnL >= 0 ? '+' : ''}$${bh.totalPnL.toFixed(2)}`, pos: bh.totalPnL >= 0 },
      winner: s.totalPnL >= bh.totalPnL ? 'strat' : 'bh',
    },
    {
      metric: '📈 PnL %',
      strat:  { val: `${s.totalPnL >= 0 ? '+' : ''}${((s.finalCapital - capital) / capital * 100).toFixed(1)}%`, pos: s.totalPnL >= 0 },
      bh:     { val: `${bh.pnlPct >= 0 ? '+' : ''}${bh.pnlPct.toFixed(1)}%`, pos: bh.pnlPct >= 0 },
      winner: s.totalPnL / capital >= bh.totalPnL / capital ? 'strat' : 'bh',
    },
    {
      metric: '⚡ Vốn Cuối',
      strat:  { val: `$${Math.round(s.finalCapital).toLocaleString()}`, pos: s.finalCapital >= capital },
      bh:     { val: `$${Math.round(bh.finalCap).toLocaleString()}`, pos: bh.finalCap >= capital },
      winner: s.finalCapital >= bh.finalCap ? 'strat' : 'bh',
    },
    {
      metric: '📅 CAGR/Năm',
      strat:  { val: `${s.cagr >= 0 ? '+' : ''}${s.cagr.toFixed(1)}%`, pos: s.cagr >= 0 },
      bh:     { val: `${bh.cagr >= 0 ? '+' : ''}${bh.cagr.toFixed(1)}%`, pos: bh.cagr >= 0 },
      winner: s.cagr >= bh.cagr ? 'strat' : 'bh',
    },
    {
      metric: '📉 Max Drawdown',
      strat:  { val: `-${s.maxDrawdown.toFixed(1)}%`, pos: false },
      bh:     { val: `-${bh.maxDrawdown.toFixed(1)}%`, pos: false },
      winner: s.maxDrawdown <= bh.maxDrawdown ? 'strat' : 'bh', // nhỏ hơn = tốt hơn
    },
    {
      metric: '⚖️ Sharpe Ratio',
      strat:  { val: `${s.sharpe}`, pos: s.sharpe >= 1 },
      bh:     { val: '—', pos: false }, // B&H không có Sharpe
      winner: 'strat',
    },
  ];

  // Count strategy wins
  const stratWins = rows.filter(r => r.winner === 'strat').length;
  const bhWins    = rows.filter(r => r.winner === 'bh').length;
  const overallWinner = stratWins > bhWins ? 'strat' : stratWins < bhWins ? 'bh' : 'tie';
  const verdictColor = overallWinner === 'strat' ? 'var(--green)' : overallWinner === 'bh' ? 'var(--red)' : 'var(--text-muted)';
  const verdictText  = overallWinner === 'strat'
    ? `✅ Chiến lược OUTPERFORM B&H (${stratWins}/${rows.length} tiêu chí)`
    : overallWinner === 'bh'
    ? `⚠️ B&H OUTPERFORM Chiến lược (${bhWins}/${rows.length} tiêu chí)`
    : `↔️ Hòa — Chiến lược và B&H ngang nhau`;

  const rowsHtml = rows.map(r => `
    <tr>
      <td style="color:var(--text-muted);padding:10px 12px;font-family:var(--font-mono);font-size:12px">${r.metric}</td>
      <td style="padding:10px 12px;text-align:center;font-weight:${r.winner==='strat'?'700':'400'};color:${r.strat.pos?'var(--green)':r.strat.val==='\u2014'?'var(--text-muted)':'var(--red)'};font-family:var(--font-mono);font-size:13px;background:${r.winner==='strat'?'rgba(0,245,160,0.06)':'transparent'};border-radius:6px">
        ${r.winner==='strat'?'<span style="color:var(--green);margin-right:4px">🏆</span>':''}
        ${r.strat.val}
      </td>
      <td style="padding:10px 12px;text-align:center;font-weight:${r.winner==='bh'?'700':'400'};color:${r.bh.pos?'var(--green)':r.bh.val==='\u2014'?'var(--text-muted)':'var(--red)'};font-family:var(--font-mono);font-size:13px;background:${r.winner==='bh'?'rgba(255,165,0,0.08)':'transparent'};border-radius:6px">
        ${r.winner==='bh'?'<span style="color:orange;margin-right:4px">🏆</span>':''}
        ${r.bh.val}
      </td>
    </tr>`).join('');

  section.innerHTML = `
    <div class="bt-section-header">
      <h2 class="bt-section-title">💰 So Sánh: Chiến Lược vs Buy &amp; Hold</h2>
      <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono)">
        Mua ${bh.startDate} @ $${bh.buyPrice.toLocaleString(undefined,{maximumFractionDigits:2})} → bán ${bh.endDate} @ $${bh.sellPrice.toLocaleString(undefined,{maximumFractionDigits:2})}
      </span>
    </div>
    <div style="padding:0 16px 8px">
      <div style="background:${overallWinner==='strat'?'rgba(0,245,160,0.07)':overallWinner==='bh'?'rgba(255,165,0,0.07)':'rgba(255,255,255,0.04)'};
                  border:1px solid ${overallWinner==='strat'?'rgba(0,245,160,0.2)':overallWinner==='bh'?'rgba(255,165,0,0.2)':'rgba(255,255,255,0.08)'};
                  border-radius:10px;padding:12px 16px;margin-bottom:16px;text-align:center">
        <span style="font-size:15px;font-weight:700;color:${verdictColor};font-family:var(--font-mono)">${verdictText}</span>
      </div>
      <div class="trade-table-wrap">
        <table class="trade-table" style="width:100%">
          <thead><tr>
            <th style="text-align:left;padding:10px 12px">Tiêu chí</th>
            <th style="text-align:center;padding:10px 12px;color:var(--accent)">Chiến lược EMA</th>
            <th style="text-align:center;padding:10px 12px;color:orange">Buy &amp; Hold 💤</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>`;
}

// ============================================
// CLEAR CACHE WITH CONFIRM
// ============================================
async function clearAllCacheConfirmed() {
  const confirmed = window.confirm(
    '🗑 Xóa tất cả dữ liệu local?\n\nDữ liệu sẽ bị xóa khỏi SQLite DB.\nBạn cần tải lại từ Binance khi backtest lần sau.\n\nTiếp tục?'
  );
  if (!confirmed) return;
  try {
    const res = await fetch('/api/clear', { method: 'POST' });
    if (res.ok) {
      showToast('✅ Đã xóa tất cả dữ liệu local');
      SS.dbSet.clear();
      await refreshDataManager();
    } else {
      showToast('⚠️ Không thể xóa — thử xóa file db/market_data.db thủ công');
    }
  } catch(e) {
    showToast('⚠️ Server chưa hỗ trợ endpoint xóa — xóa file db/market_data.db thủ công');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  initSymbolSearch();
  initPortfolioChips();
  refreshDataManager();
  
  // Set default start/end dates in local timezone
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const today = new Date();
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(today.getFullYear() - 3);
  document.getElementById('btStartDate').value = formatDate(threeYearsAgo);
  document.getElementById('btEndDate').value = formatDate(today);

  // Default SL mode = fixed
  toggleSLMode('fixed');
  toggleMode('single');
});
