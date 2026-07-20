-- KingBot Trading Platform - PostgreSQL Schema
-- Run with: psql $DATABASE_URL -f schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========== USERS ==========
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    phone_verified BOOLEAN DEFAULT FALSE,
    account_status VARCHAR(20) DEFAULT 'pending', -- pending, active, suspended, banned
    subscription_status VARCHAR(20) DEFAULT 'inactive', -- inactive, active, expired
    subscription_plan VARCHAR(50),
    subscription_expires_at TIMESTAMP,
    role VARCHAR(20) DEFAULT 'user', -- user, admin, superadmin
    avatar_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ========== EMAIL / PHONE VERIFICATION CODES ==========
CREATE TABLE IF NOT EXISTS verification_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(10) NOT NULL, -- 'email' or 'phone'
    code VARCHAR(10) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ========== SESSIONS / REFRESH TOKENS ==========
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ========== WALLETS (demo + live balances shown to user) ==========
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    demo_balance NUMERIC(18,2) DEFAULT 10000.00,
    demo_equity NUMERIC(18,2) DEFAULT 10000.00,
    -- live balance/equity is pulled live from the connected broker account,
    -- these columns are a cache updated on each sync, never the source of truth
    live_balance_cache NUMERIC(18,2) DEFAULT 0,
    live_equity_cache NUMERIC(18,2) DEFAULT 0,
    live_cache_updated_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ========== BROKER CONNECTIONS (MT4/MT5 via MetaApi) ==========
CREATE TABLE IF NOT EXISTS broker_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    broker_name VARCHAR(100) NOT NULL,
    platform VARCHAR(10) NOT NULL, -- 'mt4' or 'mt5'
    login VARCHAR(50) NOT NULL,
    password_encrypted TEXT NOT NULL, -- AES-256 encrypted, never plaintext
    server VARCHAR(150) NOT NULL,
    metaapi_account_id VARCHAR(100), -- id returned by MetaApi after provisioning
    connection_status VARCHAR(20) DEFAULT 'connecting', -- connecting, connected, failed, disconnected
    last_error TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ========== STRATEGY TEMPLATES (platform-provided) ==========
CREATE TABLE IF NOT EXISTS strategy_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    description TEXT,
    category VARCHAR(50), -- trend, scalping, grid, breakout, mean_reversion
    risk_level VARCHAR(20), -- low, medium, high
    default_params JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ========== USER STRATEGY SETTINGS ==========
CREATE TABLE IF NOT EXISTS user_strategies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    template_id UUID REFERENCES strategy_templates(id),
    name VARCHAR(150) NOT NULL,
    params JSONB NOT NULL DEFAULT '{}',
    execution_mode VARCHAR(10) NOT NULL DEFAULT 'demo', -- 'demo' or 'live'
    broker_connection_id UUID REFERENCES broker_connections(id), -- required if execution_mode = live
    symbols TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ========== TRADE HISTORY (both demo + live) ==========
CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    user_strategy_id UUID REFERENCES user_strategies(id),
    mode VARCHAR(10) NOT NULL, -- 'demo' or 'live'
    symbol VARCHAR(20) NOT NULL,
    direction VARCHAR(5) NOT NULL, -- buy/sell
    volume NUMERIC(10,2) NOT NULL,
    open_price NUMERIC(18,5),
    close_price NUMERIC(18,5),
    stop_loss NUMERIC(18,5),
    take_profit NUMERIC(18,5),
    profit NUMERIC(18,2),
    status VARCHAR(20) DEFAULT 'open', -- open, closed, cancelled
    broker_ticket_id VARCHAR(100), -- real MetaApi order id for live trades
    opened_at TIMESTAMP DEFAULT NOW(),
    closed_at TIMESTAMP
);

-- ========== TRADING JOURNAL (user notes per trade) ==========
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    trade_id UUID REFERENCES trades(id) ON DELETE SET NULL,
    title VARCHAR(200),
    notes TEXT,
    tags TEXT[] DEFAULT '{}',
    sentiment VARCHAR(20), -- confident, uncertain, mistake, disciplined
    created_at TIMESTAMP DEFAULT NOW()
);

-- ========== PAYMENTS (manual M-Pesa verification queue) ==========
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    plan VARCHAR(50) NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    mpesa_code VARCHAR(20) NOT NULL,
    payer_phone VARCHAR(20),
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP,
    admin_note TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(mpesa_code)
);

-- ========== AI SUPPORT CHAT ==========
CREATE TABLE IF NOT EXISTS support_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    escalated_to_human BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES support_conversations(id) ON DELETE CASCADE,
    sender VARCHAR(10) NOT NULL, -- 'user' or 'ai' or 'admin'
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ========== MEDIA / IMAGES LIBRARY (admin-managed assets) ==========
CREATE TABLE IF NOT EXISTS media_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    uploaded_by UUID REFERENCES users(id),
    file_url TEXT NOT NULL,
    section VARCHAR(50), -- hero, education, strategy_icons, misc
    label VARCHAR(150),
    created_at TIMESTAMP DEFAULT NOW()
);

-- ========== EDUCATION CONTENT ==========
CREATE TABLE IF NOT EXISTS education_articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(200) NOT NULL,
    slug VARCHAR(200) UNIQUE NOT NULL,
    category VARCHAR(50),
    content TEXT NOT NULL,
    cover_image_url TEXT,
    published BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ========== AUDIT LOG (admin visibility) ==========
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    target_table VARCHAR(50),
    target_id UUID,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_journal_user ON journal_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_broker_user ON broker_connections(user_id);
