const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const pool = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { nextMemberId, randomPassword } = require('../utils/ids');

const router = express.Router();

// ---------- Page views ----------
router.get('/admin/dashboard', requireAdmin, (req, res) => res.render('admin/dashboard', { admin: req.admin }));
router.get('/admin/applicants', requireAdmin, (req, res) => res.render('admin/applicants', { admin: req.admin }));
router.get('/admin/members', requireAdmin, (req, res) => res.render('admin/members', { admin: req.admin }));
router.get('/admin/payments', requireAdmin, (req, res) => res.render('admin/payments', { admin: req.admin }));
router.get('/admin/expenses', requireAdmin, (req, res) => res.render('admin/expenses', { admin: req.admin }));
router.get('/admin/accounts', requireAdmin, (req, res) => res.render('admin/accounts', { admin: req.admin }));

// ---------- Dashboard summary ----------
router.get('/api/admin/summary', requireAdmin, async (req, res) => {
  try {
    const [applicants, members, payments, expenses, balance] = await Promise.all([
      pool.query("SELECT count(*) FROM applicants WHERE status = 'pending'"),
      pool.query("SELECT count(*) FROM members WHERE status = 'active'"),
      pool.query("SELECT count(*) FROM payments WHERE status = 'pending'"),
      pool.query("SELECT count(*) FROM expenses WHERE status = 'pending'"),
      pool.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE entry_type='credit'),0) -
                         COALESCE(SUM(amount) FILTER (WHERE entry_type='debit'),0) AS balance
                  FROM accounts WHERE status = 'posted'`)
    ]);
    res.json({
      pendingApplicants: Number(applicants.rows[0].count),
      activeMembers: Number(members.rows[0].count),
      pendingPayments: Number(payments.rows[0].count),
      pendingExpenses: Number(expenses.rows[0].count),
      clubBalance: Number(balance.rows[0].balance)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load summary' });
  }
});

// ---------- Applicants ----------
router.get('/api/admin/applicants', requireAdmin, async (req, res) => {
  const status = req.query.status || 'pending';
  try {
    const { rows } = await pool.query(
      'SELECT * FROM applicants WHERE status = $1 ORDER BY created_at ASC',
      [status]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load applicants' });
  }
});

router.post('/api/admin/applicants/:id/approve', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const appQ = await client.query('SELECT * FROM applicants WHERE applicant_id = $1 FOR UPDATE', [req.params.id]);
    if (!appQ.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Applicant not found' }); }
    const applicant = appQ.rows[0];
    if (applicant.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Applicant has already been reviewed' });
    }

    const memberId = await nextMemberId();
    const tempPassword = randomPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await client.query(
      `INSERT INTO members
        (member_id, applicant_id, full_name, dob, nationality, occupation, phone, email,
         address, interests, reason_for_joining, photo_path, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [memberId, applicant.applicant_id, applicant.full_name, applicant.dob, applicant.nationality,
       applicant.occupation, applicant.phone, applicant.email, applicant.address, applicant.interests,
       applicant.reason_for_joining, applicant.photo_path, passwordHash]
    );

    await client.query(
      `UPDATE applicants SET status = 'approved', reviewed_by = $1, reviewed_at = now(), approved_member_id = $2
       WHERE applicant_id = $3`,
      [req.admin.adminId, memberId, applicant.applicant_id]
    );

    await client.query('COMMIT');
    // Temp password is returned once, here, for the admin to relay to the applicant.
    res.json({ ok: true, memberId, tempPassword });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not approve applicant' });
  } finally {
    client.release();
  }
});

router.post('/api/admin/applicants/:id/reject', requireAdmin, async (req, res) => {
  const { reason } = req.body;
  try {
    const result = await pool.query(
      `UPDATE applicants SET status = 'rejected', rejection_reason = $1,
        reviewed_by = $2, reviewed_at = now()
       WHERE applicant_id = $3 AND status = 'pending' RETURNING applicant_id`,
      [reason || null, req.admin.adminId, req.params.id]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Applicant not found or already reviewed' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not reject applicant' });
  }
});

router.get('/api/admin/applicants/:id/photo', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT photo_path FROM applicants WHERE applicant_id = $1', [req.params.id]);
    if (!rows.length || !rows[0].photo_path) return res.status(404).end();
    res.sendFile(path.join('/app/uploads', rows[0].photo_path));
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

// ---------- Members ----------
router.get('/api/admin/members', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT member_id, full_name, email, phone, status, joined_at FROM members ORDER BY joined_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load members' });
  }
});

router.get('/api/admin/members/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM members WHERE member_id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load member' });
  }
});

router.post('/api/admin/members/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body; // 'active' | 'suspended'
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    await pool.query('UPDATE members SET status = $1, updated_at = now() WHERE member_id = $2', [status, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update member status' });
  }
});

// ---------- Payments (verify -> posts a credit to accounts) ----------
router.get('/api/admin/payments', requireAdmin, async (req, res) => {
  const status = req.query.status || 'pending';
  try {
    const { rows } = await pool.query(
      `SELECT p.*, m.full_name AS member_name FROM payments p
       JOIN members m ON m.member_id = p.member_id
       WHERE p.status = $1 ORDER BY p.created_at ASC`,
      [status]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load payments' });
  }
});

router.post('/api/admin/payments/:id/verify', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pQ = await client.query('SELECT * FROM payments WHERE payment_id = $1 FOR UPDATE', [req.params.id]);
    if (!pQ.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Payment not found' }); }
    const payment = pQ.rows[0];
    if (payment.status !== 'pending') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Already reviewed' }); }

    await client.query(
      `UPDATE payments SET status = 'verified', reviewed_by = $1, reviewed_at = now() WHERE payment_id = $2`,
      [req.admin.adminId, payment.payment_id]
    );
    await client.query(
      `INSERT INTO accounts (entry_type, source_type, source_id, member_id, amount, description)
       VALUES ('credit', 'payment', $1, $2, $3, $4)`,
      [payment.payment_id, payment.member_id, payment.amount, payment.purpose]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not verify payment' });
  } finally {
    client.release();
  }
});

router.post('/api/admin/payments/:id/reject', requireAdmin, async (req, res) => {
  const { note } = req.body;
  try {
    const result = await pool.query(
      `UPDATE payments SET status = 'rejected', admin_note = $1, reviewed_by = $2, reviewed_at = now()
       WHERE payment_id = $3 AND status = 'pending' RETURNING payment_id`,
      [note || null, req.admin.adminId, req.params.id]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Payment not found or already reviewed' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not reject payment' });
  }
});

// ---------- Expenses (approve -> posts a debit to accounts) ----------
router.get('/api/admin/expenses', requireAdmin, async (req, res) => {
  const status = req.query.status || 'pending';
  try {
    const { rows } = await pool.query(
      `SELECT e.*, m.full_name AS member_name FROM expenses e
       JOIN members m ON m.member_id = e.member_id
       WHERE e.status = $1 ORDER BY e.created_at ASC`,
      [status]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load expenses' });
  }
});

router.post('/api/admin/expenses/:id/approve', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const eQ = await client.query('SELECT * FROM expenses WHERE expense_id = $1 FOR UPDATE', [req.params.id]);
    if (!eQ.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Expense not found' }); }
    const expense = eQ.rows[0];
    if (expense.status !== 'pending') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Already reviewed' }); }

    await client.query(
      `UPDATE expenses SET status = 'approved', reviewed_by = $1, reviewed_at = now() WHERE expense_id = $2`,
      [req.admin.adminId, expense.expense_id]
    );
    await client.query(
      `INSERT INTO accounts (entry_type, source_type, source_id, member_id, amount, description)
       VALUES ('debit', 'expense', $1, $2, $3, $4)`,
      [expense.expense_id, expense.member_id, expense.amount, expense.purpose]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not approve expense' });
  } finally {
    client.release();
  }
});

router.post('/api/admin/expenses/:id/reject', requireAdmin, async (req, res) => {
  const { note } = req.body;
  try {
    const result = await pool.query(
      `UPDATE expenses SET status = 'rejected', admin_note = $1, reviewed_by = $2, reviewed_at = now()
       WHERE expense_id = $3 AND status = 'pending' RETURNING expense_id`,
      [note || null, req.admin.adminId, req.params.id]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Expense not found or already reviewed' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not reject expense' });
  }
});

// ---------- Accounts ledger ----------
router.get('/api/admin/accounts', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, m.full_name AS member_name FROM accounts a
       LEFT JOIN members m ON m.member_id = a.member_id
       ORDER BY a.created_at DESC LIMIT 500`
    );
    const balanceQ = await pool.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE entry_type='credit'),0) AS total_credit,
              COALESCE(SUM(amount) FILTER (WHERE entry_type='debit'),0) AS total_debit
       FROM accounts WHERE status = 'posted'`
    );
    res.json({ entries: rows, ...balanceQ.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load accounts' });
  }
});

// Generic protected file access for admins (receipts / budget sheets / photos)
router.get('/api/admin/file/:type/:filename', requireAdmin, (req, res) => {
  const { type, filename } = req.params;
  const dirs = { photo: 'photos', receipt: 'receipts', budget: 'budgets' };
  const dir = dirs[type];
  if (!dir) return res.status(404).end();
  res.sendFile(path.join('/app/uploads', dir, filename), (err) => {
    if (err) res.status(404).end();
  });
});

module.exports = router;
