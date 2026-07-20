const express = require('express');
const axios = require('axios');
const db = require('../config/db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const SYSTEM_PROMPT = `You are KingBot Support, the AI support agent for the KingBot trading platform.
You help users with: account/verification issues, broker connection (MT4/MT5) troubleshooting,
understanding demo vs live mode, strategy settings, subscription/payment status, and general
platform navigation. You do not give financial advice, do not guarantee trading profits, and do
not tell users what to trade. For anything involving account security, disputed payments, or
broker fund issues, tell the user you're escalating to a human agent.`;

router.get('/conversation', authRequired, async (req, res) => {
  let convo = await db.query(
    `SELECT * FROM support_conversations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [req.user.id]
  );
  if (!convo.rows.length) {
    convo = await db.query(`INSERT INTO support_conversations (user_id) VALUES ($1) RETURNING *`, [req.user.id]);
  }
  const messages = await db.query(
    `SELECT * FROM support_messages WHERE conversation_id=$1 ORDER BY created_at ASC`,
    [convo.rows[0].id]
  );
  res.json({ conversation: convo.rows[0], messages: messages.rows });
});

router.post('/message', authRequired, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'message is required' });

  try {
    let convo = await db.query(
      `SELECT * FROM support_conversations WHERE user_id=$1 AND escalated_to_human=FALSE ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (!convo.rows.length) {
      convo = await db.query(`INSERT INTO support_conversations (user_id) VALUES ($1) RETURNING *`, [req.user.id]);
    }
    const conversationId = convo.rows[0].id;

    await db.query(
      `INSERT INTO support_messages (conversation_id, sender, message) VALUES ($1,'user',$2)`,
      [conversationId, message]
    );

    const history = await db.query(
      `SELECT sender, message FROM support_messages WHERE conversation_id=$1 ORDER BY created_at ASC LIMIT 20`,
      [conversationId]
    );

    const anthropicMessages = history.rows.map((m) => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.message,
    }));

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: anthropicMessages,
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      }
    );

    const aiReply = response.data.content.map((c) => c.text || '').join('\n');

    await db.query(
      `INSERT INTO support_messages (conversation_id, sender, message) VALUES ($1,'ai',$2)`,
      [conversationId, aiReply]
    );

    // simple escalation trigger - flag for a human to pick up
    const escalate = /human|agent|refund|fraud|scam|dispute|hacked/i.test(message);
    if (escalate) {
      await db.query(`UPDATE support_conversations SET escalated_to_human=TRUE WHERE id=$1`, [conversationId]);
    }

    res.json({ reply: aiReply, escalated: escalate });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(502).json({ error: 'AI support is temporarily unavailable' });
  }
});

module.exports = router;
