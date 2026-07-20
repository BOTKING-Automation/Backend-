// Real indicator math - no placeholders. All functions take an array of
// closes (or full candles where noted) and return either a number, null
// (not enough data), or an array aligned to the input.

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let emaVal = sma(values.slice(0, period), period);
  for (let i = period; i < values.length; i++) {
    emaVal = values[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  const recent = values.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function stddev(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  return Math.sqrt(variance);
}

function bollingerBands(values, period = 20, mult = 2) {
  const mid = sma(values, period);
  const sd = stddev(values, period);
  if (mid === null || sd === null) return null;
  return { upper: mid + mult * sd, mid, lower: mid - mult * sd };
}

// Finds recent swing highs/lows for basic market-structure analysis (used by SMC-lite)
function findSwings(candles, lookback = 3) {
  const highs = [];
  const lows = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const window = candles.slice(i - lookback, i + lookback + 1);
    const high = candles[i].high;
    const low = candles[i].low;
    if (high === Math.max(...window.map((c) => c.high))) highs.push({ index: i, price: high });
    if (low === Math.min(...window.map((c) => c.low))) lows.push({ index: i, price: low });
  }
  return { highs, lows };
}

function emaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let emaVal = sma(values.slice(0, period), period);
  out.push(emaVal);
  for (let i = period; i < values.length; i++) {
    emaVal = values[i] * k + emaVal * (1 - k);
    out.push(emaVal);
  }
  return out;
}

// Returns the two most recent MACD line / signal line values so callers can
// detect a crossover between the previous cycle and now.
function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  if (values.length < slow + signalPeriod + 1) return null;
  const fastSeries = emaSeries(values, fast);
  const slowSeries = emaSeries(values, slow);
  const offset = fastSeries.length - slowSeries.length;
  const macdLine = slowSeries.map((s, i) => fastSeries[i + offset] - s);
  const signalLine = emaSeries(macdLine, signalPeriod);
  if (signalLine.length < 2) return null;
  const macdOffset = macdLine.length - signalLine.length;
  return {
    macd: macdLine[macdLine.length - 1],
    macdPrev: macdLine[macdOffset + signalLine.length - 2],
    signal: signalLine[signalLine.length - 1],
    signalPrev: signalLine[signalLine.length - 2],
  };
}

module.exports = { sma, ema, emaSeries, rsi, macd, stddev, bollingerBands, findSwings };
