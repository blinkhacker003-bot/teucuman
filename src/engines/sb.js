'use strict';

const path = require('path');
const fs = require('fs');
const session = require('../models/sessionModel');

const RESPONSES_PATH = path.join(__dirname, '../../games/sb/responses/index.json');
let cachedResponses = null;

function responses() {
  if (!cachedResponses) {
    cachedResponses = JSON.parse(fs.readFileSync(RESPONSES_PATH, 'utf8'));
    if (
      typeof cachedResponses.doInit !== 'string' ||
      !Array.isArray(cachedResponses.doSpin) ||
      cachedResponses.doSpin.length === 0 ||
      !Array.isArray(cachedResponses.doCollect) ||
      cachedResponses.doCollect.length === 0
    ) {
      throw new Error('Invalid Sweet Bonanza response fixture');
    }
  }
  return cachedResponses;
}

function fmt(value) {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parse(raw) {
  const result = {};
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0) result[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return result;
}

function serialize(value) {
  return Object.entries(value).map(([key, item]) => `${key}=${item}`).join('&');
}

function patchBalance(raw, balance) {
  const fields = parse(raw);
  fields.balance = fmt(balance);
  fields.balance_cash = fmt(balance);
  fields.balance_bonus = '0.00';
  fields.stime = Date.now();
  return serialize(fields);
}

async function doInit(mgckey) {
  const sess = await session.getOrCreate(mgckey);
  return patchBalance(responses().doInit, Number(sess.balance));
}

async function doSpin(mgckey, bet) {
  const fixture = responses();
  const sess = await session.debitBet(mgckey, bet);
  const index = (sess.spin_index - 1) % fixture.doSpin.length;
  const fields = parse(fixture.doSpin[index]);

  const win = Number(String(fields.tw || '0').replace(/,/g, '')) || 0;
  let balance = Number(sess.balance);

  if (win > 0) {
    const credited = await session.creditWin(mgckey, win);
    balance = Number(credited.balance);
  }

  fields.balance = fmt(balance);
  fields.balance_cash = fmt(balance);
  fields.balance_bonus = '0.00';
  fields.stime = Date.now();
  fields.c = bet.toFixed(2);

  return serialize(fields);
}

async function doCollect(mgckey) {
  const fixture = responses();
  const sess = await session.nextCollect(mgckey);
  const index = (sess.collect_index - 1) % fixture.doCollect.length;
  return patchBalance(fixture.doCollect[index], Number(sess.balance));
}

async function handle(action, params = {}) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new Error('INVALID_GAME_REQUEST');
  }

  const mgckey = String(params.mgckey || 'default');
  if (mgckey.length > 256) throw new Error('INVALID_SESSION_KEY');

  if (action === 'doInit') return doInit(mgckey);
  if (action === 'doSpin') {
    const bet = Number(params.c === undefined || params.c === '' ? '0.20' : params.c);
    if (!Number.isFinite(bet) || bet <= 0 || bet > 120000) {
      throw new Error('INVALID_BET');
    }
    return doSpin(mgckey, bet);
  }
  if (action === 'doCollect') return doCollect(mgckey);

  const balance = await session.getBalance(mgckey);
  return `balance=${fmt(balance)}&balance_cash=${fmt(balance)}&balance_bonus=0.00&na=s&stime=${Date.now()}`;
}

module.exports = { handle };
