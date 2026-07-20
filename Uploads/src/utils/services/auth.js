const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { sendVerificationEmail } = require('../utils/email');
const { sendVerificationSMS } = require('../utils/sms');

const router = express.Router();

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// ---------- SIGN UP ----------
router.post(
  '/signup',
  [
    body('full_name').isLength({ min: 2 }).trim(),
    body('email').isEmail().normalizeEmail(),
    body('phone').isMobilePhone('any'),
    body('password').isLength({ min: 8 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { full_name, email, phone, password } = req.body;

    try {
      const existing = await db.query('SELECT id FROM users WHERE email=$1 OR phone=$2', [email, phone]);
      if (existing.rows.length) {
        return res.status(409).json({ error: 'Email or phone already registered' });
      }

      const password_hash = await bcrypt.hash(password, 12);
      const userResult = await db.query(
        `INSERT INTO users (full_name, email, phone, password_hash)
         VALUES ($1,$2,$3,$4) RETURNING id, full_name, email, phone, role, created_at`,
        [full_name, email, phone, password_hash]
      );
      const user = userResult.rows[0];

      await db.query(
        `INSERT INTO wallets (user_id) VALUES ($1)`,
        [user.id]
      );

      // create + send both verification codes
      const emailCode = generateCode();
      const phoneCode = generateCode();
      const expires = new Date(Date.now() + 15 * 60 * 1000);

      await db.query(
        `INSERT INTO verification_codes (user_id, type, code, expires_at) VALUES ($1,'email',$2,$3),($1,'phone',$4,$3)`,
        [user.id, emailCode, expires, phoneCode]
      );

      await sendVerificationEmail(email, emailCode);
      try {
        await sendVerificationSMS(phone, phoneCode);
      } catch (smsErr) {
        console.error('SMS send failed:', smsErr.message);
        // don't fail signup just because SMS provider hiccuped
      }

      return res.status(201).json({
        message: 'Account created. Check your email and phone for verification codes.',
        user_id: user.id,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Signup failed' });
    }
  }
);

// ---------- VERIFY EMAIL OR PHONE ----------
router.post('/verify', async (req, res) => {
  const { user_id, type, code } = req.body; // type = 'email' | 'phone'
  if (!user_id || !['email', 'phone'].includes(type) || !code) {
    return res.status(400).json({ error: 'user_id, type, and code are required' });
  }
  try {
    const result = await db.query(
      `SELECT * FROM verification_codes
       WHERE user_id=$1 AND type=$2 AND code=$3 AND used=FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [user_id, type, code]
    );
    if (!result.rows.length) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    await db.query('UPDATE verification_codes SET used=TRUE WHERE id=$1', [result.rows[0].id]);
    const column = type === 'email' ? 'email_verified' : 'phone_verified';
    await db.query(`UPDATE users SET ${column}=TRUE, updated_at=NOW() WHERE id=$1`, [user_id]);

    const userCheck = await db.query('SELECT email_verified, phone_verified FROM users WHERE id=$1', [user_id]);
    if (userCheck.rows[0].email_verified && userCheck.rows[0].phone_verified) {
      await db.query(`UPDATE users SET account_status='active' WHERE id=$1`, [user_id]);
    }

    return res.json({ message: `${type} verified successfully` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

// ---------- RESEND CODE ----------
router.post('/resend-code', async (req, res) => {
  const { user_id, type } = req.body;
  try {
    const userRes = await db.query('SELECT * FROM users WHERE id=$1', [user_id]);
    if (!userRes.rows.length) return res.status(404).json({ error: 'User not found' });
    const user = userRes.rows[0];

    const code = generateCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    await db.query(
      `INSERT INTO verification_codes (user_id, type, code, expires_at) VALUES ($1,$2,$3,$4)`,
      [user_id, type, code, expires]
    );

    if (type === 'email') await sendVerificationEmail(user.email, code);
    else await sendVerificationSMS(user.phone, code);

    return res.json({ message: `${type} code resent` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not resend code' });
  }
});

// ---------- LOGIN ----------
router.post('/login', [body('email').isEmail(), body('password').notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    if (!user.email_verified || !user.phone_verified) {
      return res.status(403).json({
        error: 'Please verify your email and phone before logging in',
        user_id: user.id,
        email_verified: user.email_verified,
        phone_verified: user.phone_verified,
      });
    }
    if (user.account_status === 'suspended' || user.account_status === 'banned') {
      return res.status(403).json({ error: `Account is ${user.account_status}` });
    }

    const token = signToken(user);
    const refreshToken = uuidv4();
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1,$2,NOW() + INTERVAL '30 days')`,
      [user.id, refreshToken]
    );

    return res.json({
      token,
      refreshToken,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        subscription_status: user.subscription_status,
        subscription_plan: user.subscription_plan,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
