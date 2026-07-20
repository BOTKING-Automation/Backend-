require('dotenv').config();
const db = require('../config/db');

async function seed() {
  const templates = [
    {
      name: 'Moving Average Crossover',
      description: 'Enters trades when a fast moving average crosses a slow moving average. Classic trend-following approach, works best in trending markets.',
      category: 'trend',
      risk_level: 'medium',
      default_params: { strategy_key: 'moving_average_crossover', fast_period: 9, slow_period: 21, lot_size: 0.1, stop_loss_pips: 30, take_profit_pips: 60, timeframe: '15m' },
    },
    {
      name: 'Conservative Trend Follower',
      description: 'Same crossover logic with slower, wider averages and tighter risk - fewer trades, aims for higher quality entries.',
      category: 'trend',
      risk_level: 'low',
      default_params: { strategy_key: 'moving_average_crossover', fast_period: 20, slow_period: 50, lot_size: 0.05, stop_loss_pips: 20, take_profit_pips: 40, timeframe: '1h' },
    },
    {
      name: 'Aggressive Scalper Preset',
      description: 'Fast, tight-period crossover for short-term moves. Higher trade frequency and higher risk - best tested extensively in demo first.',
      category: 'scalping',
      risk_level: 'high',
      default_params: { strategy_key: 'moving_average_crossover', fast_period: 5, slow_period: 13, lot_size: 0.1, stop_loss_pips: 15, take_profit_pips: 25, timeframe: '5m' },
    },
    {
      name: 'RSI Reversal',
      description: 'Buys when RSI exits oversold territory and sells when it exits overbought territory. A mean-reversion approach suited to ranging markets.',
      category: 'mean_reversion',
      risk_level: 'medium',
      default_params: { strategy_key: 'rsi_reversal', rsi_period: 14, oversold: 30, overbought: 70, lot_size: 0.1, stop_loss_pips: 25, take_profit_pips: 50, timeframe: '15m' },
    },
    {
      name: 'Bollinger Band Breakout',
      description: 'Enters when price breaks outside the upper or lower Bollinger Band, aiming to catch the start of a volatility expansion.',
      category: 'breakout',
      risk_level: 'medium',
      default_params: { strategy_key: 'bollinger_breakout', bb_period: 20, bb_mult: 2, lot_size: 0.1, stop_loss_pips: 30, take_profit_pips: 60, timeframe: '15m' },
    },
    {
      name: 'MACD Momentum',
      description: 'Trades MACD line crossing its signal line - a widely used momentum confirmation approach that works well layered on top of a clear trend.',
      category: 'trend',
      risk_level: 'medium',
      default_params: { strategy_key: 'macd_momentum', macd_fast: 12, macd_slow: 26, macd_signal: 9, lot_size: 0.1, stop_loss_pips: 30, take_profit_pips: 60, timeframe: '1h' },
    },
    {
      name: 'Grid Trader',
      description: 'Places trades at evenly spaced price levels around a base price - built for ranging, low-trend markets. Does not use a directional bias.',
      category: 'grid',
      risk_level: 'high',
      default_params: { strategy_key: 'grid_trading', grid_size_pips: 20, lot_size: 0.05, stop_loss_pips: 40, take_profit_pips: 20, timeframe: '15m' },
    },
    {
      name: 'Smart Money Concepts (SMC)',
      description: 'Tracks market structure using swing highs/lows and enters on a break of structure (BOS) - a simplified version of the institutional "smart money" framework used to trade with momentum shifts.',
      category: 'smc',
      risk_level: 'high',
      default_params: { strategy_key: 'smc_structure_break', swing_lookback: 3, lot_size: 0.1, stop_loss_pips: 35, take_profit_pips: 70, timeframe: '1h' },
    },
    {
      name: 'Custom Strategy',
      description: 'Build your own entry logic from price, SMA, EMA, and RSI conditions - no coding required. Configure buy/sell rules directly in the strategy settings.',
      category: 'custom',
      risk_level: 'medium',
      default_params: {
        strategy_key: 'custom',
        lot_size: 0.1,
        stop_loss_pips: 30,
        take_profit_pips: 60,
        timeframe: '15m',
        rules: {
          buy: [{ indicator: 'rsi', period: 14, operator: 'lt', value: 30 }],
          sell: [{ indicator: 'rsi', period: 14, operator: 'gt', value: 70 }],
        },
      },
    },
  ];

  for (const t of templates) {
    await db.query(
      `INSERT INTO strategy_templates (name, description, category, risk_level, default_params)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [t.name, t.description, t.category, t.risk_level, t.default_params]
    );
  }

  const articles = [
    {
      title: 'Demo Mode vs Live Mode: What Actually Changes',
      slug: 'demo-vs-live-mode',
      category: 'basics',
      content: 'Demo mode runs the same strategy logic against real market prices but simulates fills against a virtual balance - no real money moves. Live mode sends real orders to your connected broker account. Always validate a strategy in demo before switching a strategy to live mode.',
    },
    {
      title: 'Understanding Moving Average Crossover Strategies',
      slug: 'understanding-ma-crossover',
      category: 'strategies',
      content: 'A moving average crossover strategy compares a fast-moving average to a slow-moving average. When the fast average crosses above the slow average, it signals potential upward momentum; when it crosses below, potential downward momentum. It works best in trending markets and can generate false signals in choppy, sideways markets.',
    },
    {
      title: 'How to Connect Your MT4/MT5 Broker Account',
      slug: 'connecting-your-broker',
      category: 'platform',
      content: 'Go to Broker Connection, select MT4 or MT5, and enter your account number, password, and broker server name exactly as shown in your MetaTrader terminal (under Tools > Options > Server, or in your welcome email from your broker). Never share these credentials outside this platform.',
    },
    {
      title: 'Smart Money Concepts (SMC) Explained',
      slug: 'smart-money-concepts-explained',
      category: 'strategies',
      content: 'Smart Money Concepts is a framework for reading price action the way large institutional participants are believed to trade: through market structure (swing highs and lows), breaks of structure (BOS) that signal a momentum shift, and order blocks (the last opposing candle before a strong move) that mark potential re-entry zones. KingBot\'s SMC template implements a simplified structure-break approach - it is not a guarantee of institutional order flow, and should be tested extensively in demo mode first.',
    },
    {
      title: 'Building a Custom Strategy',
      slug: 'building-a-custom-strategy',
      category: 'strategies',
      content: 'The Custom Strategy template lets you define your own buy and sell conditions from price, SMA, EMA, and RSI values without writing code. Each condition compares an indicator to a threshold (greater than or less than). All conditions on a side (buy or sell) must be true simultaneously for that signal to fire. Start simple - one or two conditions - and review results in demo mode before adding complexity.',
    },
  ];

  for (const a of articles) {
    await db.query(
      `INSERT INTO education_articles (title, slug, category, content) VALUES ($1,$2,$3,$4)
       ON CONFLICT (slug) DO NOTHING`,
      [a.title, a.slug, a.category, a.content]
    );
  }

  console.log('Seed complete');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
