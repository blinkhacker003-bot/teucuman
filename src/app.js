'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const session = require('./models/sessionModel');
const sbGame = require('./engines/sb');
const { pool } = require('./config/db');

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';
const GAME_HTML = path.join(__dirname, '../games/sb/html5Game.html');
const RAILWAY_ORIGIN = 'https://teucuman-production.up.railway.app';

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ limit: '1mb' }));

const configuredOrigins = [
  process.env.PUBLIC_BASE_URL,
  ...(process.env.CORS_ORIGINS || '').split(','),
]
  .filter(Boolean)
  .map(value => {
    try {
      return new URL(value.trim()).origin;
    } catch {
      throw new Error('PUBLIC_BASE_URL and CORS_ORIGINS must contain valid URLs');
    }
  });

const allowedOrigins = new Set(configuredOrigins);

app.use((req, res, next) => {
  const origin = req.get('Origin');

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

const MUTED_PATHS = ['/collect', '/stats', '/favicon', '/rum'];
app.use((req, res, next) => {
  if (MUTED_PATHS.some(item => req.path.includes(item))) return next();

  const startedAt = Date.now();
  res.on('finish', () => {
    const color = res.statusCode >= 400 ? '\x1b[31m' : '\x1b[32m';
    console.log(
      \`\${color}\${req.method}\x1b[0m \${req.path} → \${res.statusCode} (\${Date.now() - startedAt}ms)\`
    );
  });
  next();
});

// Preserve query strings only for endpoints that consume them.
app.use((req, _res, next) => {
  const keepQuery = [
    'gameService',
    'reloadBalance',
    'saveSettings',
    'html5Game',
  ];
  if (!keepQuery.some(item => req.path.includes(item))) {
    req.url = req.url.split('?')[0];
  }
  next();
});

// Game frontend assets are served from the repository's public/gs2c directory.
app.use('/gs2c', express.static(path.join(__dirname, '../public/gs2c'), {
  maxAge: 0,
  etag: false,
  setHeaders: res => res.setHeader('Cache-Control', 'no-store'),
}));

function publicOrigin(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return new URL(process.env.PUBLIC_BASE_URL).origin;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('PUBLIC_BASE_URL is required in production');
  }

  return \`\${req.protocol}://\${req.get('host')}\`;
}

// The supplied HTML contains the old Railway host and a fixed session key.
// Rebind both per page request so the browser talks to this deployment and
// each browser launch gets an independent demo balance/session.
app.get('/gs2c/html5Game.html', async (req, res, next) => {
  try {
    const origin = publicOrigin(req);
    const mgckey = crypto.randomUUID();
    let html = await fs.readFile(GAME_HTML, 'utf8');

    html = html.replaceAll(RAILWAY_ORIGIN, origin);
    html = html.replace(/SESSION@[^~"'\\s]+/g, \`SESSION@\${mgckey}\`);

    res
      .status(200)
      .type('html')
      .set('Cache-Control', 'no-store, no-cache, must-revalidate')
      .set('Pragma', 'no-cache')
      .send(html);
  } catch (err) {
    next(err);
  }
});

app.get('/healthz', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ ok: true, service: 'teucuman', database: 'connected' });
  } catch (err) {
    console.error('[healthz]', err.message);
    res.status(503).json({ ok: false, service: 'teucuman', database: 'disconnected' });
  }
});

// The game client posts URL-encoded game protocol parameters to this endpoint.
app.post('/api/slots/gs2c_/gameService', async (req, res) => {
  try {
    const params = typeof req.body === 'string'
      ? Object.fromEntries(new URLSearchParams(req.body))
      : req.body;
    const action = params.action || '';
    const response = await sbGame.handle(action, params);

    res
      .status(200)
      .type('text/plain')
      .set('Cache-Control', 'no-store')
      .send(response);
  } catch (err) {
    const status = err.message === 'INSUFFICIENT_BALANCE' ? 409 : 400;
    console.error('[gameService]', err.message);
    res.status(status).type('text/plain').send('error=1');
  }
});

function formatBalance(value) {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

app.get('/api/slots/gs2c/reloadBalance.do', async (req, res) => {
  try {
    const mgckey = String(req.query.mgckey || 'default');
    if (mgckey.length > 256) return res.status(400).type('text/plain').send('error=1');

    const balance = await session.getBalance(mgckey);
    res
      .type('text/plain')
      .set('Cache-Control', 'no-store')
      .send(
        \`balance_bonus=0.00&balance=\${formatBalance(balance)}&balance_cash=\${formatBalance(balance)}&stime=\${Date.now()}\`
      );
  } catch (err) {
    console.error('[reloadBalance]', err.message);
    res.status(500).type('text/plain').send('error=1');
  }
});

const DEFAULT_SETTINGS = 'SoundState=true_true_true_false_false;FastPlay=false;Intro=true;StopMsg=0;TurboSpinMsg=0;BetInfo=0_-1;BatterySaver=false;ShowCCH=false;ShowFPH=false;CustomGameStoredData=;Coins=false;Volume=0.5;GameSpeed=0;HapticFeedback=false';

app.post('/api/slots/gs2c/saveSettings.do', (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const settings = typeof body.settings === 'string' ? body.settings : '';

  if (body.method === 'load') {
    if (body.id === 'vsCommon') {
      return res.type('json').send(JSON.stringify({
        MinimizedNotificationTypes: '',
        HideMetaNotifications: 'false',
      }));
    }
    return res.type('text/plain').send(DEFAULT_SETTINGS);
  }

  if (!settings) return res.type('text/plain').send(DEFAULT_SETTINGS);
  if (settings.trim().startsWith('{')) return res.type('json').send(settings);
  return res.type('text/plain').send(settings);
});

// Compatibility endpoints requested by the bundled frontend.
const emptyStub = (_req, res) => res.status(200).send('');
app.all('/api/slots/gs2c/stats.do', emptyStub);
app.all('/api/slots/gs2c/clientLog.do', emptyStub);
app.all('/gs2c/jackpot/*', emptyStub);
app.all('/gs2c/regulation/*', emptyStub);
app.all('/gs2c/logout.do', emptyStub);
app.all('/gs2c/closeGame.do', emptyStub);
app.all('/gs2c/announcements/*', emptyStub);
app.all('/gs2c/promo/*', emptyStub);
app.all('/collect', (_req, res) => res.status(204).end());
app.all('/j/collect', (_req, res) => res.status(204).end());
app.all('/cdn-cgi/*', (_req, res) => res.status(204).end());
app.all('/apps/*', emptyStub);

app.get('/', (_req, res) => {
  res
    .type('html')
    .send('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sweet Bonanza 1000 Demo</title><style>body{background:#111;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;font-family:Arial,sans-serif}a{background:#f59e0b;color:#111;padding:16px 28px;border-radius:12px;text-decoration:none;font-weight:700}</style></head><body><a href="/gs2c/html5Game.html">▶ Open Sweet Bonanza 1000 Demo</a></body></html>');
});

app.use((req, res) => {
  console.warn(\`[404] \${req.method} \${req.originalUrl}\`);
  res.status(404).type('text/plain').send('Not Found');
});

app.use((err, _req, res, _next) => {
  console.error('[http]', err.message);
  if (res.headersSent) return;
  res.status(500).type('text/plain').send('Internal Server Error');
});

async function start() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  await pool.query('SELECT 1');
  const server = app.listen(PORT, HOST, () => {
    console.log(\`[DB] Connected ✓\`);
    console.log(\`[HTTP] Teucuman listening on http://\${HOST}:\${PORT}\`);
  });

  const shutdown = signal => {
    console.log(\`[HTTP] \${signal} received; shutting down\`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch(async err => {
  console.error('[startup] Failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});

module.exports = app;
