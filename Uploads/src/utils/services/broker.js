// Real broker connectivity via MetaApi.cloud (https://metaapi.cloud).
// Each user supplies their own MT4/MT5 login, password, and broker server.
// We provision a MetaApi account on their behalf and talk to the real
// MetaApi REST API for balance/positions and order execution.
const express = require('express');
const axios = require('axios');
const db = require('../config/db');
const { authRequired } = require('../middleware/auth');
const { encrypt, decrypt } = require('../utils/encryption');

const router = express.Router();

const METAAPI_BASE = 'https://mt-provisioning-api-v1.agiliumtrade.ai';
const METAAPI_CLIENT_BASE = 'https://mt-client-api-v1.agiliumtrade.ai';

function metaApiHeaders() {
  return { 'auth-token': process.env.METAAPI_TOKEN, 'Content-Type': 'application/json' };
}

// Connect a broker account
router.post('/connect', authRequired, async (req, res) => {
  const { broker_name, platform, login, password, server } = req.body;
  if (!broker_name || !['mt4', 'mt5'].includes(platform) || !login || !password || !server) {
    return res.status(400).json({ error: 'broker_name, platform (mt4/mt5), login, password, server are required' });
  }

  try {
    // 1. Provision the account on MetaApi with the user's real credentials
    const provisionRes = await axios.post(
      `${METAAPI_BASE}/users/current/accounts`,
      {
        login,
        password,
        server,
        platform,
        magic: 0,
        name: `${req.user.email}-${platform}`,
        type: 'cloud',
      },
      { headers: metaApiHeaders() }
    );

    const metaapiAccountId = provisionRes.data.id;

    const insert = await db.query(
      `INSERT INTO broker_connections
        (user_id, broker_name, platform, login, password_encrypted, server, metaapi_account_id, connection_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'connecting') RETURNING id, broker_name, platform, login, server, connection_status, created_at`,
      [req.user.id, broker_name, platform, login, encrypt(password), server, metaapiAccountId]
    );

    // 2. Deploy it so MetaApi starts syncing with the broker
    await axios.post(
      `${METAAPI_BASE}/users/current/accounts/${metaapiAccountId}/deploy`,
      {},
      { headers: metaApiHeaders() }
    );

    return res.status(201).json({ message: 'Broker connection initiated', connection: insert.rows[0] });
  } catch (err) {
    console.error(err.response?.data || err.message);
    return res.status(502).json({
      error: 'Could not connect to broker. Check login, password, and server name.',
      details: err.response?.data || err.message,
    });
  }
});

// Check live status + sync balance
router.get('/:id/status', authRequired, async (req, res) => {
  try {
    const connRes = await db.query('SELECT * FROM broker_connections WHERE id=$1 AND user_id=$2', [
      req.params.id,
      req.user.id,
    ]);
    if (!connRes.rows.length) return res.status(404).json({ error: 'Connection not found' });
    const conn = connRes.rows[0];

    const accountInfo = await axios.get(
      `${METAAPI_BASE}/users/current/accounts/${conn.metaapi_account_id}`,
      { headers: metaApiHeaders() }
    );
    const state = accountInfo.data.state; // DEPLOYING, DEPLOYED, UNDEPLOYED, etc.
    const connectionStatus = accountInfo.data.connectionStatus; // CONNECTED, DISCONNECTED

    let liveBalance = null;
    let liveEquity = null;
    if (connectionStatus === 'CONNECTED') {
      const accountData = await axios.get(
        `${METAAPI_CLIENT_BASE}/users/current/accounts/${conn.metaapi_account_id}/account-information`,
        { headers: metaApiHeaders() }
      );
      liveBalance = accountData.data.balance;
      liveEquity = accountData.data.equity;

      await db.query(
        `UPDATE wallets SET live_balance_cache=$1, live_equity_cache=$2, live_cache_updated_at=NOW() WHERE user_id=$3`,
        [liveBalance, liveEquity, req.user.id]
      );
    }

    await db.query(`UPDATE broker_connections SET connection_status=$1, updated_at=NOW() WHERE id=$2`, [
      connectionStatus === 'CONNECTED' ? 'connected' : 'connecting',
      conn.id,
    ]);

    res.json({ state, connectionStatus, liveBalance, liveEquity });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(502).json({ error: 'Could not fetch broker status' });
  }
});

// List user's broker connections (never returns passwords)
router.get('/', authRequired, async (req, res) => {
  const result = await db.query(
    `SELECT id, broker_name, platform, login, server, connection_status, last_error, is_active, created_at
     FROM broker_connections WHERE user_id=$1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json(result.rows);
});

// Disconnect / remove
router.delete('/:id', authRequired, async (req, res) => {
  const connRes = await db.query('SELECT * FROM broker_connections WHERE id=$1 AND user_id=$2', [
    req.params.id,
    req.user.id,
  ]);
  if (!connRes.rows.length) return res.status(404).json({ error: 'Connection not found' });
  const conn = connRes.rows[0];

  try {
    await axios.post(
      `${METAAPI_BASE}/users/current/accounts/${conn.metaapi_account_id}/undeploy`,
      {},
      { headers: metaApiHeaders() }
    );
  } catch (err) {
    console.error('undeploy failed (continuing):', err.response?.data || err.message);
  }

  await db.query('UPDATE broker_connections SET is_active=FALSE, connection_status=$1 WHERE id=$2', [
    'disconnected',
    conn.id,
  ]);
  res.json({ message: 'Broker disconnected' });
});

module.exports = router;
