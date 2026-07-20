const express = require('express');
const db = require('../config/db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// ---------- WALLET (demo + live cached balances) ----------
router.get('/wallet', authRequired, async (req, res) => {
  const result = await db.query('SELECT * FROM wallets WHERE user_id=$1', [req.user.id]);
  res.json(result.rows[0] || null);
});

// ---------- DASHBOARD SUMMARY ----------
router.get('/summary', authRequired, async (req, res) => {
  const wallet = await db.query('SELECT * FROM wallets WHERE user_id=$1', [req.user.id]);
  const openTrades = await db.query(
    `SELECT COUNT(*) FROM trades WHERE user_id=$1 AND status='open'`,
    [req.user.id]
  );
  const closedPnl = await db.query(
    `SELECT mode, COALESCE(SUM(profit),0) AS total_pnl, COUNT(*) AS trade_count
     FROM trades WHERE user_id=$1 AND status='closed' GROUP BY mode`,
    [req.user.id]
  );
  const activeStrategies = await db.query(
    `SELECT COUNT(*) FROM user_strategies WHERE user_id=$1 AND is_active=TRUE`,
    [req.user.id]
  );
  const brokerConnections = await db.query(
    `SELECT COUNT(*) FROM broker_connections WHERE user_id=$1 AND is_active=TRUE`,
    [req.user.id]
  );

  res.json({
    wallet: wallet.rows[0] || null,
    open_trades: Number(openTrades.rows[0].count),
    pnl_by_mode: closedPnl.rows,
    active_strategies: Number(activeStrategies.rows[0].count),
    broker_connections: Number(brokerConnections.rows[0].count),
  });
});

// ---------- TRADE HISTORY ----------
router.get('/trades', authRequired, async (req, res) => {
  const { mode, status, limit = 50, offset = 0 } = req.query;
  const conditions = ['user_id=$1'];
  const params = [req.user.id];
  if (mode) { params.push(mode); conditions.push(`mode=$${params.length}`); }
  if (status) { params.push(status); conditions.push(`status=$${params.length}`); }

  params.push(limit, offset);
  const result = await db.query(
    `SELECT * FROM trades WHERE ${conditions.join(' AND ')}
     ORDER BY opened_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json(result.rows);
});

// ---------- JOURNAL ----------
router.get('/journal', authRequired, async (req, res) => {
  const result = await db.query(
    `SELECT j.*, t.symbol, t.direction, t.profit, t.mode
     FROM journal_entries j LEFT JOIN trades t ON t.id = j.trade_id
     WHERE j.user_id=$1 ORDER BY j.created_at DESC`,
    [req.user.id]
  );
  res.json(result.rows);
});

router.post('/journal', authRequired, async (req, res) => {
  const { trade_id, title, notes, tags, sentiment } = req.body;
  const result = await db.query(
    `INSERT INTO journal_entries (user_id, trade_id, title, notes, tags, sentiment)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.user.id, trade_id || null, title, notes, tags || [], sentiment || null]
  );
  res.status(201).json(result.rows[0]);
});

router.delete('/journal/:id', authRequired, async (req, res) => {
  await db.query('DELETE FROM journal_entries WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ message: 'Entry deleted' });
});

// ---------- ANALYTICS (demo vs live performance breakdown) ----------
router.get('/analytics', authRequired, async (req, res) => {
  const { mode = 'demo' } = req.query;
  const winLoss = await db.query(
    `SELECT
        COUNT(*) FILTER (WHERE profit > 0) AS wins,
        COUNT(*) FILTER (WHERE profit <= 0) AS losses,
        COALESCE(SUM(profit),0) AS net_pnl,
        COALESCE(AVG(profit),0) AS avg_pnl,
        COALESCE(MAX(profit),0) AS best_trade,
        COALESCE(MIN(profit),0) AS worst_trade
     FROM trades WHERE user_id=$1 AND mode=$2 AND status='closed'`,
    [req.user.id, mode]
  );
  const bySymbol = await db.query(
    `SELECT symbol, COUNT(*) AS trades, COALESCE(SUM(profit),0) AS pnl
     FROM trades WHERE user_id=$1 AND mode=$2 AND status='closed'
     GROUP BY symbol ORDER BY pnl DESC`,
    [req.user.id, mode]
  );
  const equityCurve = await db.query(
    `SELECT closed_at, SUM(profit) OVER (ORDER BY closed_at) AS running_pnl
     FROM trades WHERE user_id=$1 AND mode=$2 AND status='closed' ORDER BY closed_at ASC`,
    [req.user.id, mode]
  );

  res.json({ summary: winLoss.rows[0], by_symbol: bySymbol.rows, equity_curve: equityCurve.rows });
});

module.exports = router;
