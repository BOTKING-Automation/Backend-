const express = require('express');
const db = require('../config/db');
const { authRequired, adminRequired } = require('../middleware/auth');
const { sendPaymentDecisionEmail } = require('../utils/email');

const router = express.Router();

const PLANS = {
  starter: { amount: 1500, label: 'Starter' },
  pro: { amount: 4500, label: 'Pro' },
  elite: { amount: 9500, label: 'Elite' },
};

// Public: expose the number + plan prices so the frontend can render instructions
router.get('/instructions', (req, res) => {
  res.json({
    payment_number: process.env.MPESA_RECEIVING_NUMBER,
    plans: PLANS,
    steps: [
      'Go to M-Pesa on your phone > Send Money',
      `Enter ${process.env.MPESA_RECEIVING_NUMBER} as the recipient`,
      'Enter the amount for your chosen plan',
      'Complete the transaction and copy the M-Pesa confirmation code (e.g. QFT7XXXXXX)',
      'Paste the code below - our team verifies it and activates your account, usually within a few hours',
    ],
  });
});

// User submits proof of payment
router.post('/submit', authRequired, async (req, res) => {
  const { plan, mpesa_code, payer_phone } = req.body;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });
  if (!mpesa_code || mpesa_code.trim().length < 8) {
    return res.status(400).json({ error: 'Enter a valid M-Pesa confirmation code' });
  }

  try {
    const dup = await db.query('SELECT id FROM payments WHERE mpesa_code=$1', [mpesa_code.trim().toUpperCase()]);
    if (dup.rows.length) {
      return res.status(409).json({ error: 'This M-Pesa code has already been submitted' });
    }

    const result = await db.query(
      `INSERT INTO payments (user_id, plan, amount, mpesa_code, payer_phone)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, plan, PLANS[plan].amount, mpesa_code.trim().toUpperCase(), payer_phone]
    );

    return res.status(201).json({
      message: 'Payment submitted. Your account will be activated once verified by our team.',
      payment: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not submit payment' });
  }
});

// User: view own payment history
router.get('/my-payments', authRequired, async (req, res) => {
  const result = await db.query('SELECT * FROM payments WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json(result.rows);
});

// ---------- ADMIN ----------
router.get('/pending', authRequired, adminRequired, async (req, res) => {
  const result = await db.query(
    `SELECT p.*, u.full_name, u.email, u.phone FROM payments p
     JOIN users u ON u.id = p.user_id
     WHERE p.status='pending' ORDER BY p.created_at ASC`
  );
  res.json(result.rows);
});

router.post('/:id/decide', authRequired, adminRequired, async (req, res) => {
  const { id } = req.params;
  const { decision, note } = req.body; // decision: 'approved' | 'rejected'
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be approved or rejected' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const paymentRes = await client.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [id]);
    if (!paymentRes.rows.length) throw new Error('Payment not found');
    const payment = paymentRes.rows[0];

    await client.query(
      `UPDATE payments SET status=$1, reviewed_by=$2, reviewed_at=NOW(), admin_note=$3 WHERE id=$4`,
      [decision, req.user.id, note || null, id]
    );

    if (decision === 'approved') {
      await client.query(
        `UPDATE users SET subscription_status='active', subscription_plan=$1,
         subscription_expires_at=NOW() + INTERVAL '30 days' WHERE id=$2`,
        [payment.plan, payment.user_id]
      );
    }

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, target_table, target_id, metadata)
       VALUES ($1,$2,'payments',$3,$4)`,
      [req.user.id, `payment_${decision}`, id, JSON.stringify({ plan: payment.plan, note })]
    );

    await client.query('COMMIT');

    const userRes = await db.query('SELECT email FROM users WHERE id=$1', [payment.user_id]);
    sendPaymentDecisionEmail(userRes.rows[0].email, decision, payment.plan).catch((e) =>
      console.error('email send failed', e.message)
    );

    res.json({ message: `Payment ${decision}` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message || 'Decision failed' });
  } finally {
    client.release();
  }
});

module.exports = router;
