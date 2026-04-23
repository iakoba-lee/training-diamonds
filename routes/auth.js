const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');
const { requireManager } = require('../middleware/auth');

const SALT_ROUNDS = 10;

// POST /api/auth/login — authenticate with role + password
router.post('/login', (req, res) => {
  const { role, password } = req.body;

  if (!['team', 'manager'].includes(role)) {
    return res.status(400).json({ error: 'Role must be "team" or "manager"' });
  }

  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  const key = role === 'manager' ? 'manager_password' : 'team_password';
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);

  if (!row) {
    return res.status(500).json({ error: 'Access code not configured' });
  }

  const valid = bcrypt.compareSync(password, row.value);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  req.session.role = role;
  req.session.save((err) => {
    if (err) {
      return res.status(500).json({ error: 'Session save failed' });
    }
    res.json({ role });
  });
});

// POST /api/auth/logout — destroy session
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out' });
  });
});

// GET /api/auth/me — get current session role
router.get('/me', (req, res) => {
  if (req.session && req.session.role) {
    return res.json({ role: req.session.role });
  }
  res.status(401).json({ error: 'Not authenticated' });
});

// POST /api/auth/change-password — manager only, change team or manager password
router.post('/change-password', requireManager, (req, res) => {
  const { target, newPassword } = req.body;

  if (!['team', 'manager'].includes(target)) {
    return res.status(400).json({ error: 'Target must be "team" or "manager"' });
  }

  if (!newPassword || newPassword.length < 1) {
    return res.status(400).json({ error: 'New password is required' });
  }

  const key = target === 'manager' ? 'manager_password' : 'team_password';
  const hash = bcrypt.hashSync(newPassword, SALT_ROUNDS);

  db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(hash, key);

  res.json({ message: `${target} password updated` });
});

module.exports = router;
