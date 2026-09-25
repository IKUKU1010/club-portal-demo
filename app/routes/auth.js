const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const router = express.Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === 'true',
  maxAge: 8 * 60 * 60 * 1000 // 8 hours
};

// ---------- Member login ----------
router.post('/api/member/login', async (req, res) => {
  const { memberId, password } = req.body;
  if (!memberId || !password) {
    return res.status(400).json({ error: 'Member ID and password are required' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT member_id, password_hash, status, full_name, must_change_password FROM members WHERE member_id = $1',
      [memberId.trim()]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid member ID or password' });
    const member = rows[0];
    if (member.status !== 'active') {
      return res.status(403).json({ error: 'This membership is not currently active' });
    }
    const ok = await bcrypt.compare(password, member.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid member ID or password' });

    const token = jwt.sign(
      { role: 'member', memberId: member.member_id, fullName: member.full_name },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.cookie('member_token', token, COOKIE_OPTS);
    res.json({ ok: true, mustChangePassword: member.must_change_password, redirect: '/dashboard' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed, please try again' });
  }
});

router.post('/api/member/logout', (req, res) => {
  res.clearCookie('member_token');
  res.json({ ok: true });
});

// Member changes their own password (view-only elsewhere, but they must be
// able to set their password after the admin-issued temporary one)
router.post('/api/member/change-password', require('../middleware/auth').requireMember, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  try {
    const { rows } = await pool.query('SELECT password_hash FROM members WHERE member_id = $1', [req.member.memberId]);
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE members SET password_hash = $1, must_change_password = false, updated_at = now() WHERE member_id = $2',
      [newHash, req.member.memberId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update password' });
  }
});

// ---------- Admin login ----------
router.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM admins WHERE username = $1', [username.trim()]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const admin = rows[0];
    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { role: admin.role, adminId: admin.admin_id, username: admin.username },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.cookie('admin_token', token, COOKIE_OPTS);
    res.json({ ok: true, redirect: '/admin/dashboard' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed, please try again' });
  }
});

router.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ ok: true });
});

module.exports = router;
