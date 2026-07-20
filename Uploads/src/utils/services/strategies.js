const express = require('express');
const axios = require('axios');
const db = require('../config/db');
const { authRequired, adminRequired } = require('../middleware/auth');

const router = express.Router();
const METAAPI_CLIENT_BASE = 'https://mt-client-api-v1.agiliumtrade.ai';

// ---------- PUBLIC TEMPLATES ----------
router.get('/templates', authRequired, async (req, res) => {
  const result = await db.query('SELECT * FROM strategy_templates WHERE is_active=TRUE ORDER BY created_at DESC');
  res.json(result.rows);
});

router.post('/templates', authRequired, adminRequired, async (req, res) => {
  const { name, description, category, risk_level, default_params } = req.body;
  const result = await db.query(
    `INSERT INTO strategy_templates (name, description, category, risk_level, default_params)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, description, category, risk_level, default_params || {}]
  );
  res.status(201).json(result.rows[0]);
});

// ---------- USER STRATEGY CONFIG ----------
router.get('/my-strategies', authRequired, async (req, res) => {
  const result = await db.query(
    `SELECT us.*, st.name AS template_name, bc.broker_name, bc.platform
     FROM user_strategies us
     LEFT JOIN strategy_templates st ON st.id = us.template_id
     LEFT JOIN broker_connections bc ON bc.id = us.broker_connection_id
     WHERE us.user_id=$1 ORDER BY us.created_at DESC`,
    [req.user.id]
  );
  res.json(result.rows);
});

// Create/configure a strategy for this user - this is where demo vs live is chosen
router.post('/my-strategies', authRequired, async (req, res) => {
  const { template_id, name, params, execution_mode, broker_connection_id, symbols } = req.body;

  if (!['demo', 'live'].includes(execution_mode)) {
    return res.status(400).json({ error: "execution_mode must be 'demo' or 'live'" });
  }
  if (execution_mode === 'live') {
    if (!broker_connection_id) {
      return res.status(400).json({ error: 'broker_connection_id is required for live execution' });
    }
    const conn = await db.query(
      `SELECT * FROM broker_connections WHERE id=$1 AND user_id=$2 AND is_active=TRUE`,
      [broker_connection_id, req.user.id]
    );
    if (!conn.rows.length) {
      return res.status(400).json({ error: 'Broker connection not found or inactive for this user' });
    }
    if (conn.rows[0].connection_status !== 'connected') {
      return res.status(400).json({ error: 'Broker must be fully connected before enabling live execution' });
    }
  }

  const result = await db.query(
    `INSERT INTO user_strategies (user_id, template_id, name, params, execution_mode, broker_connection_id, symbols)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.user.id, template_id, name, params || {}, execution_mode, execution_mode === 'live' ? broker_connection_id : null, symbols || []]
  );
  res.status(201).json(result.rows[0]);
});

// Toggle a strategy on/off - this is the actual "run/stop the bot" switch
router.patch('/my-strategies/:id/toggle', authRequired, async (req, res) => {
  const { is_active } = req.body;
  const result = await db.query(
    `UPDATE user_strategies SET is_active=$1, updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING *`,
    [is_active, req.params.id, req.user.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Strategy not found' });
  res.json(result.rows[0]);
});

// Update params / switch demo <-> live
router.put('/my-strategies/:id', authRequired, async (req, res) => {
  const { params, execution_mode, broker_connection_id, symbols } = req.body;
  const result = await db.query(
    `UPDATE user_strategies
     SET params=COALESCE($1, params),
         execution_mode=COALESCE($2, execution_mode),
         broker_connection_id=$3,
         symbols=COALESCE($4, symbols),
         updated_at=NOW()
     WHERE id=$5 AND user_id=$6 RETURNING *`,
    [params, execution_mode, execution_mode === 'live' ? broker_connection_id : null, symbols, req.params.id, req.user.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Strategy not found' });
  res.json(result.rows[0]);
});

router.delete('/my-strategies/:id', authRequired, async (req, res) => {
  await db.query('DELETE FROM user_strategies WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ message: 'Strategy removed' });
});

module.exports = router;
