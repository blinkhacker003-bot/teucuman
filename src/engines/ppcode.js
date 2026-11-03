'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_ROOT = process.env.PP_ASSETS_ROOT
  ? path.resolve(process.env.PP_ASSETS_ROOT)
  : null;
const PROVIDER_ORIGIN = process.env.PRAGMATIC_DEMO_ORIGIN || 'https://demogamesfree.pragmaticplay.net';
const LEGACY_V3_ORIGIN = 'https://demogamesfree.ppgames.net';
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.PROVIDER_TIMEOUT_MS || '20000', 10);
const SYMBOL_PATTERN = /^vs[a-z0-9]+$/;

function safeSymbol(value) {
  const symbol = String(value || '').toLowerCase();
  if (!SYMBOL_PATTERN.test(symbol)) throw new Error('INVALID_GAME');
  return symbol;
}

function requireAssets() {
  if (!PUBLIC_ROOT) throw new Error('PP_ASSETS_ROOT_NOT_CONFIGURED');
  return PUBLIC_ROOT;
}

async function gameDirectory(symbol) {
  const root = requireAssets();
  const safe = safeSymbol(symbol);
  const dir = path.join(root, safe);
  const wrapper = path.join(dir, 'gs2c', 'html5Game.php');
  await fs.access(wrapper);
  return { dir, wrapper };
}

async function listGames() {
  const root = requireAssets();
  const entries = await fs.readdir(root, { withFileTypes: true });
  const games = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SYMBOL_PATTERN.test(entry.name)) continue;
    try {
      await fs.access(path.join(root, entry.name, 'gs2c', 'html5Game.php'));
      games.push({ symbol: entry.name, name: entry.name.replace(/^vs/, '').replace(/([a-z])([0-9])/g, '$1 $2').replace(/([0-9])([a-z])/g, '$1 $2').replace(/\b\w/g, c => c.toUpperCase()) });
    } catch {}
  }
  return games.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function renderTemplate(template, { symbol, user, lang, currency }) {
  let html = template
    .replace(/<\?php\s+echo\s+\$_GET\[['"]user['"]\];\s*\?>/g, escapeHtml(user))
    .replace(/<\?php\s+echo\s+\$_GET\[['"]lang['"]\];\s*\?>/g, escapeHtml(lang))
    .replace(/<\?php\s+echo\s+\$_GET\[['"]cur['"]\];\s*\?>/g, escapeHtml(currency));
  // The imported PPCode wrapper contains an unused hard-coded private-IP
  // console telemetry target. Keep any accidental invocation local.
  html = html.replaceAll('https://192.168.10.108:8000/console.php?', '/__disabled_game_console__?');
  if (/<\\?php/.test(html)) throw new Error('UNSUPPORTED_GAME_TEMPLATE');
  return html;
}

async function renderGame(symbol, query = {}) {
  const safe = safeSymbol(symbol);
  const { wrapper } = await gameDirectory(safe);
  const user = String(query.user || crypto.randomUUID());
  if (user.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(user)) throw new Error('INVALID_SESSION_KEY');
  const lang = String(query.lang || 'pt').slice(0, 8);
  const currency = String(query.cur || 'BRL').slice(0, 8);
  const template = await fs.readFile(wrapper, 'utf8');
  const html = renderTemplate(template, { symbol: safe, user, lang, currency });
  return { html, user, symbol: safe };
}

function providerEndpoint(ver) {
  if (ver === 'v4') return new URL('/gs2c/ge/v4/gameService', PROVIDER_ORIGIN).toString();
  if (ver === 'gameService') return new URL('/gs2c/gameService', PROVIDER_ORIGIN).toString();
  return new URL('/gs2c/v3/gameService', LEGACY_V3_ORIGIN).toString();
}

async function createProviderKey(symbol) {
  const url = new URL('/gs2c/openGame.do', PROVIDER_ORIGIN);
  url.searchParams.set('gameSymbol', symbol);
  url.searchParams.set('websiteUrl', PROVIDER_ORIGIN);
  url.searchParams.set('jurisdiction', '99');
  url.searchParams.set('lobby_url', 'https://www.pragmaticplay.com/en/');
  url.searchParams.set('lang', 'PT');
  url.searchParams.set('cur', 'BRL');

  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': '*/*',
      'Referer': PROVIDER_ORIGIN + '/',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const finalUrl = new URL(response.url);
  let providerKey = finalUrl.searchParams.get('mgckey');
  const body = await response.text();
  if (!providerKey) {
    const match = body.match(/[?&]mgckey=([^&"'\s]+)/);
    if (match) providerKey = decodeURIComponent(match[1]);
  }
  if (!response.ok || !providerKey) {
    throw new Error('PROVIDER_SESSION_INIT_FAILED');
  }
  return providerKey;
}

async function handleGameRequest(symbol, params, ver = '') {
  const safe = safeSymbol(symbol);
  await gameDirectory(safe);
  const action = String(params.action || '');

  // PPCode handles the settings action by reading the game's local settings file.
  if (action === 'settings') {
    const settingsPath = path.join(requireAssets(), safe, 'gs2c', 'saveSettings.do');
    const settings = await fs.readFile(settingsPath, 'utf8');
    return { status: 200, contentType: 'text/plain; charset=utf-8', body: settings };
  }

  const db = require('../config/db');
  const localKey = String(params.mgckey || '');
  if (!localKey || localKey.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(localKey)) {
    throw new Error('INVALID_SESSION_KEY');
  }

  let providerKey;
  if (action === 'doInit') {
    providerKey = await createProviderKey(safe);
    await db.query(
      `INSERT INTO provider_game_sessions (local_key, game_symbol, provider_mgckey)
       VALUES ($1, $2, $3)
       ON CONFLICT (local_key) DO UPDATE
       SET game_symbol=EXCLUDED.game_symbol,
           provider_mgckey=EXCLUDED.provider_mgckey,
           updated_at=NOW()`,
      [localKey, safe, providerKey]
    );
  } else {
    const { rows } = await db.query(
      'SELECT game_symbol, provider_mgckey FROM provider_game_sessions WHERE local_key=$1',
      [localKey]
    );
    if (!rows[0] || rows[0].game_symbol !== safe) throw new Error('GAME_SESSION_NOT_FOUND');
    providerKey = rows[0].provider_mgckey;
  }

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && !['__proto__', 'constructor', 'prototype'].includes(key)) {
      form.set(key, String(value));
    }
  }
  form.set('action', action);
  form.set('symbol', safe);
  form.set('mgckey', providerKey);

  const origin = ver === 'v4' || ver === 'gameService' ? PROVIDER_ORIGIN : LEGACY_V3_ORIGIN;
  const response = await fetch(providerEndpoint(ver), {
    method: 'POST',
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': '*/*',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': origin,
      'Referer': origin + '/',
    },
    body: form.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  return {
    status: response.status,
    contentType: response.headers.get('content-type') || 'text/plain; charset=utf-8',
    body: await response.text(),
  };
}

module.exports = {
  PUBLIC_ROOT,
  safeSymbol,
  listGames,
  renderGame,
  renderTemplate,
  handleGameRequest,
};
