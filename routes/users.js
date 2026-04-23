const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireManager } = require('../middleware/auth');

// GET /api/users — list all users
router.get('/', (req, res) => {
  const users = db.prepare(`
    SELECT id, display_name, role, team, created_at
    FROM users
    ORDER BY role DESC, display_name ASC
  `).all();
  res.json(users);
});

// POST /api/users — create a new user
router.post('/', requireManager, (req, res) => {
  const { display_name, role = 'user', team = 'Support Team' } = req.body;

  if (!display_name || !display_name.trim()) {
    return res.status(400).json({ error: 'display_name is required' });
  }

  try {
    const result = db.prepare(
      'INSERT INTO users (display_name, role, team) VALUES (?, ?, ?)'
    ).run(display_name.trim(), role, team);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/users/:id — remove a user and their snapshots
router.delete('/:id', requireManager, (req, res) => {
  const { id } = req.params;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ message: `User "${user.display_name}" removed`, id: Number(id) });
});

// PUT /api/users/:id — update user details
router.put('/:id', requireManager, (req, res) => {
  const { id } = req.params;
  const { display_name, role, team } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  db.prepare(
    'UPDATE users SET display_name = ?, role = ?, team = ? WHERE id = ?'
  ).run(
    display_name || user.display_name,
    role || user.role,
    team || user.team,
    id
  );

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json(updated);
});

module.exports = router;
