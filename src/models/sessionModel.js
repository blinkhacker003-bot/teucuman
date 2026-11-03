'use strict';

const db = require('../config/db');
const DEFAULT_BALANCE = Number(process.env.DEFAULT_BALANCE || '50000');

async function getOrCreate(mgckey) {
  const { rows } = await db.query(
    `INSERT INTO sessions (mgckey) VALUES ($1)
     ON CONFLICT (mgckey) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [mgckey]
  );
  return rows[0];
}

async function debitBet(mgckey, bet) {
  if (!Number.isFinite(bet) || bet <= 0) {
    throw new Error('INVALID_BET');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO sessions (mgckey) VALUES ($1) ON CONFLICT (mgckey) DO NOTHING',
      [mgckey]
    );

    const { rows } = await client.query(
      'SELECT * FROM sessions WHERE mgckey=$1 FOR UPDATE',
      [mgckey]
    );
    const sess = rows[0];

    if (!sess) throw new Error('SESSION_NOT_FOUND');

    const currentBalance = Number(sess.balance);
    if (currentBalance < bet) throw new Error('INSUFFICIENT_BALANCE');

    const { rows: updated } = await client.query(
      `UPDATE sessions
       SET balance=balance-$1, spin_index=spin_index+1, updated_at=NOW()
       WHERE mgckey=$2
       RETURNING *`,
      [bet, mgckey]
    );

    await client.query('COMMIT');
    return updated[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function creditWin(mgckey, win) {
  if (!Number.isFinite(win) || win < 0) throw new Error('INVALID_WIN');

  const { rows } = await db.query(
    'UPDATE sessions SET balance=balance+$1, updated_at=NOW() WHERE mgckey=$2 RETURNING *',
    [win, mgckey]
  );
  if (!rows[0]) throw new Error('SESSION_NOT_FOUND');
  return rows[0];
}

async function nextCollect(mgckey) {
  await getOrCreate(mgckey);
  const { rows } = await db.query(
    'UPDATE sessions SET collect_index=collect_index+1, updated_at=NOW() WHERE mgckey=$1 RETURNING *',
    [mgckey]
  );
  if (!rows[0]) throw new Error('SESSION_NOT_FOUND');
  return rows[0];
}

async function getBalance(mgckey) {
  const { rows } = await db.query('SELECT balance FROM sessions WHERE mgckey=$1', [mgckey]);
  return rows[0] ? Number(rows[0].balance) : DEFAULT_BALANCE;
}

module.exports = { getOrCreate, debitBet, creditWin, nextCollect, getBalance };
