'use strict';

require('dotenv').config();
const { Pool } = require('pg');

function required(name, value) {
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

const useConnectionString = Boolean(process.env.DATABASE_URL);
const sslEnabled = String(process.env.DB_SSL || 'false').toLowerCase() === 'true';

const poolConfig = useConnectionString
  ? {
      connectionString: required('DATABASE_URL', process.env.DATABASE_URL),
      ssl: sslEnabled ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : false,
    }
  : {
      host: required('DB_HOST', process.env.DB_HOST),
      port: Number.parseInt(process.env.DB_PORT || '5432', 10),
      database: required('DB_NAME', process.env.DB_NAME),
      user: required('DB_USER', process.env.DB_USER),
      password: required('DB_PASS', process.env.DB_PASS),
      ssl: sslEnabled ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : false,
    };

if (!Number.isInteger(poolConfig.port) && !useConnectionString) {
  throw new Error('DB_PORT must be a valid integer');
}

const pool = new Pool({
  ...poolConfig,
  max: Number.parseInt(process.env.DB_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', err => console.error('[DB] Pool error:', err.message));

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
};
