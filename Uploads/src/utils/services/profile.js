const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/me', authRequired, async (req, res) => {
  const result = await db.query(
    `SELECT id, full_name, email, phone, avatar_url, email_verified, phone_verified,
            account_status, subscription_status, subscription_plan, subscription_expires_at,
            role, created_at FROM users WHERE id=$1`,
    [req.user.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
  res.json(result.rows[0]);
});

router.put('/me', authRequired, async (req, res) => {
  const { full_name, avatar_url } = req.body;
  const result = await db.query(
    `UPDATE users SET full_name=COALESCE($1,full_name), avatar_url=COALESCE($2,avatar_url), updated_at=NOW()
     WHERE id=$3 RETURNING id, full_name, email, phone, avatar_url`,
    [full_name, avatar_url, req.user.id]
  );
  res.json(result.rows[0]);
});

router.post('/change-password', authRequired, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const userRes = await db.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  const match = await bcrypt.compare(current_password, userRes.rows[0].password_hash);
  if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

  const newHash = await bcrypt.hash(new_password, 12);
  await db.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [newHash, req.user.id]);
  res.json({ message: 'Password updated' });
});

module.exports = router;
