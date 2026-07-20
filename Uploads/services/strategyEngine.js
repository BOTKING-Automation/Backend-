// Real execution engine. Runs on an interval, reads real market candles from
// MetaApi (same real data source for demo and live so demo mode is meaningful),
// and evaluates EVERY active strategy using that user's own saved settings
// (execution_mode, symbols, params, broker_connection_id) - nothing here is
// global or shared between users.
//
//   - demo mode: simulates a fill, written to trades with mode='demo'
//   - live mode: places a REAL order via MetaApi's trade endpoint on the
//     user's own connected broker account
//
// Run separately from the API process: `node src/services/strategyEngine.js`
require('dotenv').config();
const axios = require('axios');
const db = require('../config/db');
const { sma, ema, rsi, macd, bollingerBands, findSwings } = require('./indicators');

const METAAPI_CLIENT_BASE = 'https://mt-client-api-v1.agiliumtrade.ai';
function metaApiHeaders() {
  return { 'auth-token': process.env.METAAPI_TOKEN, 'Content-Type': 'application/json' };
}

async function getCandles(metaapiAccountId, symbol, timeframe = '15m', limit = 100) {
  const res = await axios.get(
    `${METAAPI_CLIENT_BASE}/users/current/accounts/${metaapiAccountId}/historical-market-data/symbols/${symbol}/timeframes/${timeframe}/candles`,
    { headers: metaApiHeaders(), params: { limit } }
  );
  return res.data; // array of { time, open, high, low, close, volume }
}

// ========== STRATEGY EVALUATORS ==========
// Every evaluator takes (candles, params) from THIS user's saved strategy row
// and returns null (no signal) or { direction: 'buy'|'sell', price }.

function evalMovingAverageCrossover(candles, params) {
  const fastPeriod = params.fast_period || 9;
  const slowPeriod = params.slow_period || 21;
  const closes = candles.map((c) => c.close);
  if (closes.length < slowPeriod + 1) return null;

  const fastNow = sma(closes, fastPeriod);
  const slowNow = sma(closes, slowPeriod);
  const fastPrev = sma(closes.slice(0, -1), fastPeriod);
  const slowPrev = sma(closes.slice(0, -1), slowPeriod);
  if ([fastNow, slowNow, fastPrev, slowPrev].some((v) => v === null)) return null;

  if (fastPrev <= slowPrev && fastNow > slowNow) return { direction: 'buy', price: closes.at(-1) };
  if (fastPrev >= slowPrev && fastNow < slowNow) return { direction: 'sell', price: closes.at(-1) };
  return null;
}

function evalRsiReversal(candles, params) {
  const period = params.rsi_period || 14;
  const oversold = params.oversold || 30;
  const overbought = params.overbought || 70;
  const closes = candles.map((c) => c.close);
  if (closes.length < period + 2) return null;

  const rsiNow = rsi(closes, period);
  const rsiPrev = rsi(closes.slice(0, -1), period);
  if (rsiNow === null || rsiPrev === null) return null;

  if (rsiPrev <= oversold && rsiNow > oversold) return { direction: 'buy', price: closes.at(-1) };
  if (rsiPrev >= overbought && rsiNow < overbought) return { direction: 'sell', price: closes.at(-1) };
  return null;
}

function evalBollingerBreakout(candles, params) {
  const period = params.bb_period || 20;
  const mult = params.bb_mult || 2;
  const closes = candles.map((c) => c.close);
  if (closes.length < period + 1) return null;

  const bandsNow = bollingerBands(closes, period, mult);
  const bandsPrev = bollingerBands(closes.slice(0, -1), period, mult);
  if (!bandsNow || !bandsPrev) return null;

  const priceNow = closes.at(-1);
  const pricePrev = closes.at(-2);

  if (pricePrev <= bandsPrev.upper && priceNow > bandsNow.upper) return { direction: 'buy', price: priceNow };
  if (pricePrev >= bandsPrev.lower && priceNow < bandsNow.lower) return { direction: 'sell', price: priceNow };
  return null;
}

// Simplified Smart Money Concepts: detects a break of market structure -
// price closing beyond the most recent confirmed swing high/low - as a proxy
// for a bullish/bearish BOS (break of structure).
function evalSmartMoneyStructureBreak(candles, params) {
  const lookback = params.swing_lookback || 3;
  const closes = candles.map((c) => c.close);
  if (candles.length < lookback * 2 + 5) return null;

  const { highs, lows } = findSwings(candles, lookback);
  if (!highs.length || !lows.length) return null;

  const lastSwingHigh = highs.at(-1);
  const lastSwingLow = lows.at(-1);
  const priceNow = closes.at(-1);
  const pricePrev = closes.at(-2);

  if (pricePrev <= lastSwingHigh.price && priceNow > lastSwingHigh.price) {
    return { direction: 'buy', price: priceNow };
  }
  if (pricePrev >= lastSwingLow.price && priceNow < lastSwingLow.price) {
    return { direction: 'sell', price: priceNow };
  }
  return null;
}

// Custom rule builder: user defines conditions in params.rules = { buy: [...], sell: [...] }
// Each condition: { indicator: 'price'|'sma'|'ema'|'rsi', period, operator: 'gt'|'lt', value }
// ALL conditions in a side's array must be true for that signal to fire.
function getIndicatorValue(closes, def) {
  switch (def.indicator) {
    case 'price': return closes.at(-1);
    case 'sma': return sma(closes, def.period || 20);
    case 'ema': return ema(closes, def.period || 20);
    case 'rsi': return rsi(closes, def.period || 14);
    default: return null;
  }
}

function evalCustomRules(candles, params) {
  const rules = params.rules || {};
  const closes = candles.map((c) => c.close);
  const priceNow = closes.at(-1);

  function sideTriggers(conditions) {
    if (!conditions || !conditions.length) return false;
    return conditions.every((cond) => {
      const val = getIndicatorValue(closes, cond);
      if (val === null) return false;
      if (cond.operator === 'gt') return val > cond.value;
      if (cond.operator === 'lt') return val < cond.value;
      return false;
    });
  }

  if (sideTriggers(rules.buy)) return { direction: 'buy', price: priceNow };
  if (sideTriggers(rules.sell)) return { direction: 'sell', price: priceNow };
  return null;
}

function evalMacdMomentum(candles, params) {
  const fast = params.macd_fast || 12;
  const slow = params.macd_slow || 26;
  const signalPeriod = params.macd_signal || 9;
  const closes = candles.map((c) => c.close);
  const result = macd(closes, fast, slow, signalPeriod);
  if (!result) return null;

  const { macd: macdNow, macdPrev, signal: signalNow, signalPrev } = result;
  if (macdPrev <= signalPrev && macdNow > signalNow) return { direction: 'buy', price: closes.at(-1) };
  if (macdPrev >= signalPrev && macdNow < signalNow) return { direction: 'sell', price: closes.at(-1) };
  return null;
}

// Grid trading: places buy signals as price drops through evenly spaced
// levels below a base price, and sell signals as it rises through levels
// above it - designed for ranging/sideways markets, not trending ones.
function evalGridTrading(candles, params) {
  const gridSizePips = params.grid_size_pips || 20;
  const basePrice = params.base_price || candles[0].close;
  const closes = candles.map((c) => c.close);
  const priceNow = closes.at(-1);
  const pricePrev = closes.at(-2);
  const symbolPip = params.jpy_pair ? 0.01 : 0.0001;
  const gridSize = gridSizePips * symbolPip;

  const levelPrev = Math.round((pricePrev - basePrice) / gridSize);
  const levelNow = Math.round((priceNow - basePrice) / gridSize);
  if (levelNow === levelPrev) return null;

  // crossed a grid line downward -> buy the dip; crossed upward -> sell the rip
  if (levelNow < levelPrev) return { direction: 'buy', price: priceNow };
  if (levelNow > levelPrev) return { direction: 'sell', price: priceNow };
  return null;
}


const STRATEGY_EVALUATORS = {
  moving_average_crossover: evalMovingAverageCrossover,
  rsi_reversal: evalRsiReversal,
  bollinger_breakout: evalBollingerBreakout,
  macd_momentum: evalMacdMomentum,
  grid_trading: evalGridTrading,
  smc_structure_break: evalSmartMoneyStructureBreak,
  custom: evalCustomRules,
};

// ========== EXECUTION ==========
async function executeDemoTrade(strategy, signal, symbol) {
  const volume = strategy.params.lot_size || 0.1;
  await db.query(
    `INSERT INTO trades (user_id, user_strategy_id, mode, symbol, direction, volume, open_price, status)
     VALUES ($1,$2,'demo',$3,$4,$5,$6,'open')`,
    [strategy.user_id, strategy.id, symbol, signal.direction, volume, signal.price]
  );
  console.log(`[DEMO] user=${strategy.user_id} strategy=${strategy.name} ${signal.direction} ${symbol} @ ${signal.price}`);
}

async function executeLiveTrade(strategy, signal, symbol, metaapiAccountId) {
  const volume = strategy.params.lot_size || 0.1;
  const stopLossPips = strategy.params.stop_loss_pips || 30;
  const takeProfitPips = strategy.params.take_profit_pips || 60;
  const pip = symbol.includes('JPY') ? 0.01 : 0.0001;

  const stopLoss = signal.direction === 'buy'
    ? signal.price - stopLossPips * pip
    : signal.price + stopLossPips * pip;
  const takeProfit = signal.direction === 'buy'
    ? signal.price + takeProfitPips * pip
    : signal.price - takeProfitPips * pip;

  const orderRes = await axios.post(
    `${METAAPI_CLIENT_BASE}/users/current/accounts/${metaapiAccountId}/trade`,
    {
      actionType: signal.direction === 'buy' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL',
      symbol,
      volume,
      stopLoss,
      takeProfit,
    },
    { headers: metaApiHeaders() }
  );

  await db.query(
    `INSERT INTO trades (user_id, user_strategy_id, mode, symbol, direction, volume, open_price, stop_loss, take_profit, status, broker_ticket_id)
     VALUES ($1,$2,'live',$3,$4,$5,$6,$7,$8,'open',$9)`,
    [strategy.user_id, strategy.id, symbol, signal.direction, volume, signal.price, stopLoss, takeProfit, orderRes.data.orderId || orderRes.data.positionId]
  );
  console.log(`[LIVE] user=${strategy.user_id} strategy=${strategy.name} REAL ${signal.direction} ${symbol} @ ${signal.price} ticket=${orderRes.data.orderId}`);
}

async function runCycle() {
  // Each row here is one user's own strategy configuration - execution_mode,
  // symbols, params, and broker_connection_id are all pulled per-row, so
  // every user's bot runs entirely on their own settings.
  const activeStrategies = await db.query(
    `SELECT us.*, bc.metaapi_account_id, bc.connection_status
     FROM user_strategies us
     LEFT JOIN broker_connections bc ON bc.id = us.broker_connection_id
     WHERE us.is_active = TRUE`
  );

  for (const strategy of activeStrategies.rows) {
    const strategyKey = strategy.params.strategy_key || 'moving_average_crossover';
    const evaluator = STRATEGY_EVALUATORS[strategyKey];
    if (!evaluator) continue;

    // Price data is always sourced from a connected broker account (even in
    // demo mode) so demo results reflect real market conditions.
    if (!strategy.metaapi_account_id) continue;
    if (strategy.execution_mode === 'live' && strategy.connection_status !== 'connected') continue;

    const symbols = strategy.symbols.length ? strategy.symbols : ['EURUSD'];
    for (const symbol of symbols) {
      try {
        const candles = await getCandles(strategy.metaapi_account_id, symbol, strategy.params.timeframe || '15m');
        const signal = evaluator(candles, strategy.params);
        if (!signal) continue;

        if (strategy.execution_mode === 'demo') {
          await executeDemoTrade(strategy, signal, symbol);
        } else {
          await executeLiveTrade(strategy, signal, symbol, strategy.metaapi_account_id);
        }
      } catch (err) {
        console.error(`Strategy ${strategy.id} (${strategyKey}) / ${symbol} failed:`, err.response?.data || err.message);
        await db.query(
          `INSERT INTO audit_logs (actor_id, action, target_table, target_id, metadata)
           VALUES ($1,'strategy_execution_error','user_strategies',$2,$3)`,
          [strategy.user_id, strategy.id, JSON.stringify({ error: err.message, symbol, strategyKey })]
        );
      }
    }
  }
}

const INTERVAL_MS = Number(process.env.ENGINE_INTERVAL_MS || 60_000);

if (require.main === module) {
  console.log(`KingBot strategy engine started - cycle every ${INTERVAL_MS / 1000}s`);
  runCycle();
  setInterval(runCycle, INTERVAL_MS);
}

module.exports = { runCycle, STRATEGY_EVALUATORS };
