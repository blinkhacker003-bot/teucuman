'use strict';

require('dotenv').config();
const { pool } = require('./db');

const DEFAULT_BALANCE = Number(process.env.DEFAULT_BALANCE || '50000');

if (!Number.isFinite(DEFAULT_BALANCE) || DEFAULT_BALANCE < 0) {
  throw new Error('DEFAULT_BALANCE must be a finite number greater than or equal to zero');
}

const SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id            BIGSERIAL PRIMARY KEY,
  mgckey        TEXT NOT NULL UNIQUE,
  balance       NUMERIC(14,2) NOT NULL DEFAULT ${DEFAULT_BALANCE.toFixed(2)} CHECK (balance >= 0),
  spin_index    INTEGER NOT NULL DEFAULT 0 CHECK (spin_index >= 0),
  collect_index INTEGER NOT NULL DEFAULT 0 CHECK (collect_index >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions (updated_at);

-- Maps the browser-visible local session key to the upstream demo-session key.
-- This is isolated from the local Sweet Bonanza 1000 fixture sessions.
CREATE TABLE IF NOT EXISTS provider_game_sessions (
  local_key       TEXT PRIMARY KEY,
  game_symbol     TEXT NOT NULL,
  provider_mgckey TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_game_sessions_updated_at
  ON provider_game_sessions (updated_at);

-- Upgrade an earlier deployment where only fully initialized sessions were stored.
ALTER TABLE provider_game_sessions
  ALTER COLUMN provider_mgckey DROP NOT NULL;
`;

(async () => {
  console.log('[migrate] Running...');
  try {
    await pool.query(SQL);
    console.log('[migrate] Done ✓');
  } catch (err) {
    console.error('[migrate] Error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
