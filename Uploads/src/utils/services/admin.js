const express = require('express');
const db = require('../config/db');
const { authRequired, adminRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired, adminRequired);

// ---------- OVERVIEW ----------
router.get('/overview', async (req, res) => {
  const users = await db.query(`SELECT COUNT(*) FROM users`);
  const activeSubs = await db.query(`SELECT COUNT(*) FROM users WHERE subscription_status='active'`);
  const pendingPayments = await db.query(`SELECT COUNT(*) FROM payments WHERE status='pending'`);
  const liveConnections = await db.query(`SELECT COUNT(*) FROM broker_connections WHERE connection_status='connected'`);
  const activeStrategies = await db.query(`SELECT COUNT(*) FROM user_strategies WHERE is_active=TRUE`);
  const revenue = await db.query(`SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE status='approved'`);

  res.json({
    total_users: Number(users.rows[0].count),
    active_subscriptions: Number(activeSubs.rows[0].count),
    pending_payments: Number(pendingPayments.rows[0].count),
    live_broker_connections: Number(liveConnections.rows[0].count),
    active_strategies: Number(activeStrategies.rows[0].count),
    total_revenue: Number(revenue.rows[0].total),
  });
});

// ---------- USERS ----------
router.get('/users', async (req, res) => {
  const { search = '', limit = 50, offset = 0 } = req.query;
  const result = await db.query(
    `SELECT id, full_name, email, phone, account_status, subscription_status, subscription_plan,
            email_verified, phone_verified, role, created_at
     FROM users
     WHERE full_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [`%${search}%`, limit, offset]
  );
  res.json(result.rows);
});

router.get('/users/:id', async (req, res) => {
  const user = await db.query(
    `SELECT id, full_name, email, phone, account_status, subscription_status, subscription_plan,
            email_verified, phone_verified, role, created_at FROM users WHERE id=$1`,
    [req.params.id]
  );
  if (!user.rows.length) return res.status(404).json({ error: 'User not found' });

  const wallet = await db.query('SELECT * FROM wallets WHERE user_id=$1', [req.params.id]);
  const brokers = await db.query(
    'SELECT id, broker_name, platform, login, server, connection_status FROM broker_connections WHERE user_id=$1',
    [req.params.id]
  );
  const strategies = await db.query('SELECT * FROM user_strategies WHERE user_id=$1', [req.params.id]);
  const payments = await db.query('SELECT * FROM payments WHERE user_id=$1 ORDER BY created_at DESC', [req.params.id]);

  res.json({ user: user.rows[0], wallet: wallet.rows[0], brokers: brokers.rows, strategies: strategies.rows, payments: payments.rows });
});

router.patch('/users/:id/status', async (req, res) => {
  const { account_status } = req.body; // active, suspended, banned
  if (!['active', 'suspended', 'banned', 'pending'].includes(account_status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  await db.query('UPDATE users SET account_status=$1, updated_at=NOW() WHERE id=$2', [account_status, req.params.id]);
  await db.query(
    `INSERT INTO audit_logs (actor_id, action, target_table, target_id, metadata) VALUES ($1,'user_status_change','users',$2,$3)`,
    [req.user.id, req.params.id, JSON.stringify({ account_status })]
  );
  res.json({ message: 'Status updated' });
});

// ---------- AUDIT LOG ----------
router.get('/audit-logs', async (req, res) => {
  const result = await db.query(
    `SELECT al.*, u.full_name AS actor_name FROM audit_logs al
     LEFT JOIN users u ON u.id = al.actor_id ORDER BY al.created_at DESC LIMIT 200`
  );
  res.json(result.rows);
});

// ---------- PLATFORM SETTINGS (simple key-value store) ----------
router.get('/settings', async (req, res) => {
  res.json({
    mpesa_receiving_number: process.env.MPESA_RECEIVING_NUMBER,
    payment_mode: process.env.PAYMENT_MODE,
    metaapi_region: process.env.METAAPI_REGION,
  });
});

module.exports = router;
