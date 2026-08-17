/* ============================================================
   SIGNAL DESK — forex candlestick trend reader
   Combines a few classic technical rules (moving-average
   crossover, RSI, MACD histogram, last-candle pattern) into a
   single weighted score. This is a heuristic, not a statistical
   forecast — see the disclaimer in the UI.
   ============================================================ */

const els = {
  form: document.getElementById('controls'),
  pair: document.getElementById('pairSelect'),
  interval: document.getElementById('intervalSelect'),
  apiKey: document.getElementById('apiKey'),
  runBtn: document.getElementById('runBtn'),
  chartTitle: document.getElementById('chartTitle'),
  statusLine: document.getElementById('statusLine'),
  chartFootnote: document.getElementById('chartFootnote'),
  gaugeFill: document.getElementById('gaugeFill'),
  gaugeNeedle: document.getElementById('gaugeNeedle'),
  verdictWord: document.getElementById('verdictWord'),
  verdictConf: document.getElementById('verdictConf'),
  printout: document.getElementById('printout'),
  tapeTrack: document.getElementById('tapeTrack'),
};

let chart, series;

function initChart() {
  const container = document.getElementById('chart');
  chart = LightweightCharts.createChart(container, {
    layout: {
      background: { color: '#12161c' },
      textColor: '#7c8695',
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: '#1a2028' },
      horzLines: { color: '#1a2028' },
    },
    rightPriceScale: { borderColor: '#232a34' },
    timeScale: { borderColor: '#232a34' },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });
  series = chart.addCandlestickSeries({
    upColor: '#3fb950',
    downColor: '#f0524d',
    borderVisible: false,
    wickUpColor: '#3fb950',
    wickDownColor: '#f0524d',
  });

  new ResizeObserver(entries => {
    for (const entry of entries) {
      chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
    }
  }).observe(container);
}

/* ---------------- data fetching ---------------- */

async function fetchCandles(pair, interval, apiKey) {
  const [from, to] = pair.split('/');

  if (!apiKey) {
    return { candles: generateDemoCandles(180), demo: true };
  }

  const fn = interval === 'daily' ? 'FX_DAILY' : 'FX_INTRADAY';
  const params = new URLSearchParams({
    function: fn,
    from_symbol: from,
    to_symbol: to,
    outputsize: 'compact',
    apikey: apiKey,
  });
  if (fn === 'FX_INTRADAY') params.set('interval', interval);

  const url = `https://www.alphavantage.co/query?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API request failed (${res.status})`);
  const data = await res.json();

  const seriesKey = Object.keys(data).find(k => k.toLowerCase().includes('time series'));
  if (!seriesKey) {
    const note = data['Note'] || data['Information'] || data['Error Message'];
    throw new Error(note || 'Unexpected response shape from Alpha Vantage.');
  }

  const raw = data[seriesKey];
  const candles = Object.entries(raw)
    .map(([time, ohlc]) => ({
      time: interval === 'daily' ? time : Math.floor(new Date(time + 'Z').getTime() / 1000),
      open: parseFloat(ohlc['1. open']),
      high: parseFloat(ohlc['2. high']),
      low: parseFloat(ohlc['3. low']),
      close: parseFloat(ohlc['4. close']),
    }))
    .sort((a, b) => (a.time > b.time ? 1 : -1));

  return { candles, demo: false };
}

function generateDemoCandles(n) {
  const candles = [];
  let price = 1.0850;
  const start = Math.floor(Date.now() / 1000) - n * 86400;
  for (let i = 0; i < n; i++) {
    const drift = (Math.sin(i / 14) * 0.0006) + (Math.random() - 0.5) * 0.0022;
    const open = price;
    const close = open + drift;
    const high = Math.max(open, close) + Math.random() * 0.0009;
    const low = Math.min(open, close) - Math.random() * 0.0009;
    candles.push({ time: start + i * 86400, open, high, low, close });
    price = close;
  }
  return candles;
}

/* ---------------- indicators ---------------- */

function sma(values, period) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    out.push(sum / period);
  }
  return out;
}

function ema(values, period) {
  const out = [];
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) { out.push(null); continue; }
    prev = prev == null ? values[i] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  out[period] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss));
  }
  return out;
}

function macdHistogram(closes) {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = closes.map((_, i) => (ema12[i] != null && ema26[i] != null) ? ema12[i] - ema26[i] : null);
  const signal = ema(macdLine.map(v => v == null ? 0 : v), 9);
  return macdLine.map((v, i) => (v != null && signal[i] != null) ? v - signal[i] : null);
}

function lastCandlePattern(candles) {
  const c = candles[candles.length - 1];
  const p = candles[candles.length - 2];
  if (!c || !p) return { name: 'insufficient data', bias: 0 };

  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low || 1e-9;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;

  const bullishEngulf = c.close > c.open && p.close < p.open && c.close >= p.open && c.open <= p.close;
  const bearishEngulf = c.close < c.open && p.close > p.open && c.open >= p.close && c.close <= p.open;
  const hammer = lowerWick > body * 2 && upperWick < body * 0.6 && c.close > c.open;
  const shootingStar = upperWick > body * 2 && lowerWick < body * 0.6 && c.close < c.open;
  const doji = body / range < 0.08;

  if (bullishEngulf) return { name: 'bullish engulfing', bias: 1 };
  if (bearishEngulf) return { name: 'bearish engulfing', bias: -1 };
  if (hammer) return { name: 'hammer', bias: 0.6 };
  if (shootingStar) return { name: 'shooting star', bias: -0.6 };
  if (doji) return { name: 'doji (indecision)', bias: 0 };
  return { name: c.close > c.open ? 'plain bullish candle' : 'plain bearish candle', bias: c.close > c.open ? 0.3 : -0.3 };
}

/* ---------------- scoring ---------------- */

function buildSignal(candles) {
  const closes = candles.map(c => c.close);
  const smaFast = sma(closes, 20);
  const smaSlow = sma(closes, 50);
  const rsiSeries = rsi(closes, 14);
  const hist = macdHistogram(closes);

  const i = closes.length - 1;
  const lines = [];
  let score = 0;
  let weight = 0;

  // Moving average crossover
  if (smaFast[i] != null && smaSlow[i] != null) {
    const diff = smaFast[i] - smaSlow[i];
    const pct = diff / smaSlow[i];
    const contribution = Math.max(-1, Math.min(1, pct * 300));
    score += contribution * 1.2;
    weight += 1.2;
    lines.push({ tag: 'SMA20 vs SMA50', val: diff > 0 ? 'bullish cross' : 'bearish cross', cls: diff > 0 ? 'up' : 'down' });
  }

  // RSI
  if (rsiSeries[i] != null) {
    const r = rsiSeries[i];
    let contribution = 0;
    if (r > 70) contribution = -0.7;
    else if (r < 30) contribution = 0.7;
    else contribution = (50 - r) / 50 * 0.4;
    score += contribution;
    weight += 1;
    lines.push({ tag: `RSI(14) ${r.toFixed(1)}`, val: r > 70 ? 'overbought' : r < 30 ? 'oversold' : 'neutral', cls: r > 70 ? 'down' : r < 30 ? 'up' : 'flat' });
  }

  // MACD histogram momentum
  if (hist[i] != null && hist[i - 1] != null) {
    const rising = hist[i] > hist[i - 1];
    const contribution = Math.max(-1, Math.min(1, hist[i] * 400)) * 0.5 + (rising ? 0.2 : -0.2);
    score += contribution;
    weight += 0.9;
    lines.push({ tag: 'MACD histogram', val: hist[i] > 0 ? (rising ? 'rising, positive' : 'positive, fading') : (rising ? 'negative, improving' : 'falling, negative'), cls: hist[i] > 0 ? 'up' : 'down' });
  }

  // Candlestick pattern
  const pattern = lastCandlePattern(candles);
  score += pattern.bias * 1.1;
  weight += 1.1;
  lines.push({ tag: 'Last candle', val: pattern.name, cls: pattern.bias > 0 ? 'up' : pattern.bias < 0 ? 'down' : 'flat' });

  const normalized = weight ? score / weight : 0; // roughly -1..1
  // Map to a confidence percentage. Kept in a realistic band (50-85%)
  // rather than claiming false precision near 0% or 100%.
  const magnitude = Math.min(1, Math.abs(normalized));
  const confidence = Math.round(50 + magnitude * 35);
  const direction = normalized > 0.08 ? 'up' : normalized < -0.08 ? 'down' : 'flat';

  return { direction, confidence, lines, normalized };
}

/* ---------------- rendering ---------------- */

function renderGauge(direction, confidence) {
  const circumference = 267;
  // map confidence(50-85) + direction to a fill offset around the arc
  const signed = direction === 'up' ? confidence : direction === 'down' ? -confidence : 0;
  const t = (signed + 100) / 200; // 0..1 across the arc
  const offset = circumference * (1 - t);
  els.gaugeFill.style.strokeDashoffset = offset;
  els.gaugeFill.style.stroke = direction === 'up' ? '#3fb950' : direction === 'down' ? '#f0524d' : '#e8a33d';

  const angle = -90 + t * 180;
  els.gaugeNeedle.style.transform = `rotate(${angle}deg)`;

  els.verdictWord.textContent = direction === 'up' ? 'LEAN BUY' : direction === 'down' ? 'LEAN SELL' : 'NO EDGE';
  els.verdictWord.className = 'verdict-word ' + direction;
  els.verdictConf.textContent = direction === 'flat'
    ? 'signals are mixed / weak'
    : `heuristic confidence ~${confidence}%`;
}

function renderPrintout(lines) {
    els.printout.innerHTML = lines.map(l => `<p class="printout-line"><span class="tag">${l.tag}</span><span class="val ${l.cls}">${l.val}</span></p>`.replace(/\n/g, '<br />')).join('');
    
    if (window.candles && window.candles.length > 0) {
        const sltpHTML = renderSLTP(window.candles);
        if (els.printout) {
            els.printout.innerHTML += sltpHTML;
        }
    }
}
}

function renderTape(pair, candles) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const chg = prev ? (((last.close - prev.close) / prev.close) * 100).toFixed(2) : '0.00';
  const items = [];
  for (let i = 0; i < 6; i++) {
    items.push(`<span>${pair}</span> ${last.close.toFixed(5)} <span style="color:${chg >= 0 ? '#3fb950' : '#f0524d'}">${chg >= 0 ? '+' : ''}${chg}%</span>`);
  }
  els.tapeTrack.innerHTML = items.join(' &nbsp;&nbsp;•&nbsp;&nbsp; ');
}

/* ---------------- main flow ---------------- */

async function run(e) {
  if (e) e.preventDefault();
  const pair = els.pair.value;
  const interval = els.interval.value;
  const apiKey = els.apiKey.value.trim();

  els.runBtn.disabled = true;
  els.statusLine.textContent = 'fetching…';
  els.chartTitle.textContent = `${pair} · ${interval.toUpperCase()}`;

  try {
    const { candles, demo } = await fetchCandles(pair, interval, apiKey);
    if (candles.length < 30) throw new Error('Not enough candles returned to compute indicators.');

    series.setData(candles);
    chart.timeScale().fitContent();

    const signal = buildSignal(candles);

// === NEW FEATURES ===
window.candles = candles;
const mtfHTML = await renderMultiTimeframe(els.apiKey.value.trim());
const backtestHTML = renderBacktest(candles);
if (els.printout) els.printout.innerHTML += mtfHTML + backtestHTML;
    renderGauge(signal.direction, signal.confidence);
    renderPrintout(signal.lines);
    renderTape(pair, candles);

    els.statusLine.textContent = demo ? 'demo data' : 'live';
    els.chartFootnote.textContent = demo
      ? 'No API key entered — showing synthetic demo candles so the layout is visible. Add a free Alpha Vantage key above for live data.'
      : `${candles.length} candles loaded from Alpha Vantage.`;
  } catch (err) {
    els.statusLine.textContent = 'error';
    els.chartFootnote.textContent = err.message || 'Something went wrong fetching data.';
    els.printout.innerHTML = `<p class="printout-line muted">${err.message || 'Could not compute a signal.'}</p>`;
  } finally {
    els.runBtn.disabled = false;
  }
}

initChart();
els.form.addEventListener('submit', run);
run();
// ============================================
// NEW FEATURES - Added at the bottom
// ============================================

// Calculate ATR and SL/TP levels
function calculateSLTPFromCandles(candles) {
    if (!candles || candles.length < 15) return null;
    
    const atr = calculateATR(candles, 14);
    const lastCandle = candles[candles.length - 1];
    const currentPrice = lastCandle.close;
    
    const stopLoss = currentPrice - (atr * 1.5);
    const takeProfit = currentPrice + (atr * 2.5);
    
    return {
        atr: atr,
        currentPrice: currentPrice,
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        riskRewardRatio: (2.5 / 1.5),
        riskPercent: ((atr * 1.5) / currentPrice * 100).toFixed(2),
        rewardPercent: ((atr * 2.5) / currentPrice * 100).toFixed(2)
    };
}

// Render SL/TP display
function renderSLTP(candles) {
    const levels = calculateSLTPFromCandles(candles);
    if (!levels) return '';
    
    return `
        <div style="margin-top: 10px; padding: 10px; background: #1a1a2e; border-radius: 6px; font-size: 13px; border: 1px solid #333;">
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; text-align: center;">
                <div>
                    <div style="color: #888; font-size: 10px;">🛑 STOP LOSS</div>
                    <div style="color: #ff4444; font-weight: bold;">${levels.stopLoss.toFixed(5)}</div>
                    <div style="color: #ff6666; font-size: 11px;">-${levels.riskPercent}%</div>
                </div>
                <div>
                    <div style="color: #888; font-size: 10px;">📊 ENTRY</div>
                    <div style="color: #fff; font-weight: bold;">${levels.currentPrice.toFixed(5)}</div>
                    <div style="color: #666; font-size: 10px;">ATR: ${levels.atr.toFixed(5)}</div>
                </div>
                <div>
                    <div style="color: #888; font-size: 10px;">🎯 TAKE PROFIT</div>
                    <div style="color: #00ff88; font-weight: bold;">${levels.takeProfit.toFixed(5)}</div>
                    <div style="color: #66ff88; font-size: 11px;">+${levels.rewardPercent}%</div>
                </div>
            </div>
            <div style="text-align: center; margin-top: 6px; color: ${levels.riskRewardRatio >= 2 ? '#00ff88' : '#ffaa00'}; font-weight: bold; font-size: 12px;">
                📈 Risk/Reward Ratio: ${levels.riskRewardRatio.toFixed(2)}:1
            </div>
        </div>
    `;
}

// Multi-timeframe signal
async function getMultiTimeframeSignalEnhanced(apiKey) {
    if (!apiKey || apiKey === 'FSV8DNHVT1B0D6OK9.') {
        return {
            action: '⚠️ Enter API key for multi-timeframe',
            details: 'Add your Alpha Vantage key above'
        };
    }
    
    const baseUrl = 'https://www.alphavantage.co/query';
    
    try {
        const dailyRes = await fetch(
            `${baseUrl}?function=FX_DAILY&from_symbol=EUR&to_symbol=USD&apikey=${apiKey}&outputsize=compact`
        );
        const dailyData = await dailyRes.json();
        
        const hourlyRes = await fetch(
            `${baseUrl}?function=FX_INTRADAY&from_symbol=EUR&to_symbol=USD&interval=60min&apikey=${apiKey}&outputsize=compact`
        );
        const hourlyData = await hourlyRes.json();
        
        const dailyCandles = parseCandles(dailyData['Time Series FX (Daily)']);
        const hourlyCandles = parseCandles(hourlyData['Time Series FX (60min)']);
        
        if (!dailyCandles || !hourlyCandles || dailyCandles.length < 20) {
            return {
                action: '⚠️ Insufficient data',
                details: 'Need more candles for analysis'
            };
        }
        
        const dailySignal = calculateSimpleSignal(dailyCandles);
        const hourlySignal = calculateSimpleSignal(hourlyCandles);
        
        if (dailySignal.direction === hourlySignal.direction && dailySignal.direction !== 'NEUTRAL') {
            return {
                action: `✅ STRONG ${dailySignal.direction}`,
                details: `Daily: ${dailySignal.direction} (${dailySignal.confidence}%) | Hourly: ${hourlySignal.direction} (${hourlySignal.confidence}%)`
            };
        } else {
            return {
                action: '⚠️ WAIT - Timeframes conflict',
                details: `Daily: ${dailySignal.direction} | Hourly: ${hourlySignal.direction}`
            };
        }
        
    } catch (error) {
        return {
            action: '❌ Error fetching data',
            details: error.message
        };
    }
}

// Render multi-timeframe
async function renderMultiTimeframe(apiKey) {
    const signal = await getMultiTimeframeSignalEnhanced(apiKey);
    
    const color = signal.action.includes('STRONG BUY') ? '#00ff88' :
                  signal.action.includes('STRONG SELL') ? '#ff4444' :
                  signal.action.includes('WAIT') ? '#ffaa00' : '#888';
    
    return `
        <div style="margin-top: 8px; padding: 10px; background: #1a1a2e; border-radius: 6px; font-size: 12px; border: 1px solid #333;">
            <div style="color: ${color}; font-weight: bold;">${signal.action}</div>
            <div style="color: #888; font-size: 11px;">${signal.details}</div>
        </div>
    `;
}

// Backtest results
function renderBacktest(candles) {
    if (!candles || candles.length < 50) return '';
    
    const results = backtestStrategy(candles, 1000);
    
    return `
        <div style="margin-top: 8px; padding: 10px; background: #1a1a2e; border-radius: 6px; font-size: 12px; border: 1px solid #333;">
            <div style="color: #888; margin-bottom: 4px;">📊 BACKTEST (Last 100 candles)</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 6px; text-align: center;">
                <div>
                    <div style="color: #666; font-size: 10px;">Trades</div>
                    <div style="color: #fff; font-weight: bold;">${results.trades}</div>
                </div>
                <div>
                    <div style="color: #666; font-size: 10px;">Win Rate</div>
                    <div style="color: ${parseFloat(results.winRate) > 50 ? '#00ff88' : '#ff4444'}; font-weight: bold;">${results.winRate}</div>
                </div>
                <div>
                    <div style="color: #666; font-size: 10px;">Return</div>
                    <div style="color: ${parseFloat(results.totalReturn) > 0 ? '#00ff88' : '#ff4444'}; font-weight: bold;">${results.totalReturn}</div>
                </div>
                <div>
                    <div style="color: #666; font-size: 10px;">P/F</div>
                    <div style="color: ${parseFloat(results.profitFactor) > 1 ? '#00ff88' : '#ff4444'}; font-weight: bold;">${results.profitFactor}</div>
                </div>
            </div>
            <div style="color: #666; font-size: 10px; text-align: center; margin-top: 4px;">
                Final Balance: $${results.finalBalance} (${results.winners}W / ${results.losers}L)
            </div>
        </div>
    `;
}

console.log('✅ New features loaded - SL/TP, Multi-timeframe, Backtest');