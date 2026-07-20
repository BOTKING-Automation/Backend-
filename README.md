# KingBot Backend

Real Node.js/Express + PostgreSQL backend. No mocked data, no simulated endpoints —
every route talks to a real database and real third-party APIs once you plug in your keys.

## What's wired up for real

| Feature | Provider | Status |
|---|---|---|
| Auth (signup/login) | JWT + bcrypt | Fully working, just needs `JWT_SECRET` |
| Email verification | SMTP (Gmail/SendGrid/etc via nodemailer) | Needs SMTP credentials |
| SMS verification | Africa's Talking | Needs AT account (works with Safaricom/Airtel numbers) |
| Broker connections (MT4/MT5) | MetaApi.cloud | Needs `METAAPI_TOKEN` |
| Payments | Manual M-Pesa code + admin approval | Works out of the box (no Daraja needed) |
| AI Support Agent | Anthropic API | Needs `ANTHROPIC_API_KEY` |
| Admin panel APIs | Internal | Fully working |

## Setup

```bash
npm install
cp .env.example .env   # fill in real values
psql $DATABASE_URL -f src/db/schema.sql
node src/db/seed.js    # loads real strategy templates + starter education articles
npm run dev            # API server
npm run engine         # separate process - the actual trade execution loop
```

## Why payments are "manual verification" and not automated

Your M-Pesa number (0748275015) is a **personal number**, not a registered Paybill/Till.
Safaricom's Daraja API (the only real way to auto-confirm an M-Pesa payment) requires a
business shortcode. Until you register one:

1. User pays to your number manually and gets an M-Pesa confirmation SMS with a code
   (e.g. `QFT7K2XXXX`).
2. User pastes that code into `/api/payments/submit`.
3. It lands in `/api/admin/payments/pending` for you to check against your own M-Pesa
   statement (Safaricom app > Statements, or *334# > My Account) and approve or reject
   via `/api/payments/:id/decide`.
4. On approval, the user's subscription activates automatically and they get an email.

This is intentionally transparent in the UI copy ("verified by our team, usually within
a few hours") rather than claiming instant automated verification, since that would be
inaccurate with your current setup.

**When you get a Paybill/Till + Daraja app**, tell me and I'll add the automated
C2B confirmation webhook — at that point payments activate instantly with zero manual
review needed.

## Broker connections — how "each user has their own login" works

Each user enters their own MT4/MT5 account number, password, and broker server on the
Broker Connection page. The backend:
1. Sends those credentials to MetaApi.cloud, which provisions a dedicated cloud
   connection to their broker (this is a real, licensed way to bridge to MT4/MT5 without
   you running your own terminal servers).
2. Encrypts and stores the password (AES-256) — it is never stored in plaintext.
3. Polls MetaApi for real balance/equity/position data and can place real orders through
   it once a strategy is toggled to "live" mode against that connection.

Sign up for a MetaApi.cloud account to get `METAAPI_TOKEN`. They have a free tier
sufficient for testing.

## Important: nothing here executes trades automatically yet

~~The strategy execution engine doesn't exist yet.~~ **Update: it's built.**
`src/services/strategyEngine.js` runs on an interval, reads each active
`user_strategies` row (per-user settings — nothing shared or global), evaluates
it against real market candles pulled from that user's connected broker, and
either simulates a demo fill or places a **real live order** via MetaApi.

Strategy templates included (seeded via `npm run seed` after `npm run migrate`):

| Strategy | Logic |
|---|---|
| Moving Average Crossover (+ Conservative / Aggressive presets) | Fast SMA crosses slow SMA |
| RSI Reversal | RSI exits oversold/overbought zone |
| Bollinger Band Breakout | Price closes outside the bands |
| MACD Momentum | MACD line crosses its signal line |
| Grid Trader | Buys/sells at evenly spaced price levels — for ranging markets |
| Smart Money Concepts (SMC) | Simplified break-of-structure detection off swing highs/lows |
| Custom Strategy | User-defined buy/sell rules (price/SMA/EMA/RSI vs threshold), no code needed |

Run the engine as a separate process: `npm run engine` (every 60s by default,
configurable via `ENGINE_INTERVAL_MS`).

## Endpoints overview

- `POST /api/auth/signup`, `/verify`, `/resend-code`, `/login`
- `GET/PUT /api/profile/me`, `/change-password`
- `GET /api/payments/instructions`, `POST /submit`, `GET /my-payments`
- `GET /api/payments/pending` (admin), `POST /:id/decide` (admin)
- `POST /api/broker/connect`, `GET /:id/status`, `GET /`, `DELETE /:id`
- `GET /api/strategies/templates`, `GET/POST/PUT/DELETE /my-strategies`
- `GET /api/dashboard/wallet`, `/summary`, `/trades`, `/journal`, `/analytics`
- `POST /api/support/message`, `GET /conversation`
- `GET /api/admin/overview`, `/users`, `/users/:id`, `/audit-logs`, `/settings`
- `GET/POST/PUT/DELETE /api/content/education`, `POST /media/upload`
