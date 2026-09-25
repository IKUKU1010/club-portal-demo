const pool = require('../config/db');

async function nextMemberId() {
  const { rows } = await pool.query("SELECT nextval('member_id_seq') AS n");
  return `PNK-${String(rows[0].n).padStart(4, '0')}`;
}

async function nextPaymentId() {
  const { rows } = await pool.query("SELECT nextval('payment_id_seq') AS n");
  return `PMT-${String(rows[0].n).padStart(6, '0')}`;
}

async function nextExpenseId() {
  const { rows } = await pool.query("SELECT nextval('expense_id_seq') AS n");
  return `EXP-${String(rows[0].n).padStart(6, '0')}`;
}

function randomPassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

module.exports = { nextMemberId, nextPaymentId, nextExpenseId, randomPassword };
