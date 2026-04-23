const express = require('express');
const router = express.Router();
const db = require('../db');

// Axis labels for reference
const DIAMOND_AXES = {
  1: ['Applications', 'OSs', 'Customer Service', 'Operations'],
  2: ['Security', 'AV', 'Network', 'Project Management/Leadership']
};

// GET /api/skills/:userId/latest — get latest current + aim for both diamonds
router.get('/:userId/latest', (req, res) => {
  const { userId } = req.params;

  const getLatest = db.prepare(`
    SELECT * FROM skill_snapshots
    WHERE user_id = ? AND diamond = ? AND snapshot_type = ?
    ORDER BY recorded_at DESC
    LIMIT 1
  `);

  const result = {
    diamond1: {
      current: getLatest.get(userId, 1, 'current') || null,
      aim: getLatest.get(userId, 1, 'aim') || null,
      axes: DIAMOND_AXES[1]
    },
    diamond2: {
      current: getLatest.get(userId, 2, 'current') || null,
      aim: getLatest.get(userId, 2, 'aim') || null,
      axes: DIAMOND_AXES[2]
    }
  };

  res.json(result);
});

// POST /api/skills/:userId/update — save a new skill snapshot
router.post('/:userId/update', (req, res) => {
  const { userId } = req.params;
  const { diamond, axis_1, axis_2, axis_3, axis_4, snapshot_type } = req.body;

  // Validate
  if (![1, 2].includes(diamond)) {
    return res.status(400).json({ error: 'diamond must be 1 or 2' });
  }
  if (!['current', 'aim'].includes(snapshot_type)) {
    return res.status(400).json({ error: 'snapshot_type must be "current" or "aim"' });
  }

  const values = [axis_1, axis_2, axis_3, axis_4];
  for (const v of values) {
    if (typeof v !== 'number' || v < 0 || v > 5) {
      return res.status(400).json({ error: 'All axis values must be integers 0-5' });
    }
  }

  // Verify user exists
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO skill_snapshots (user_id, diamond, axis_1, axis_2, axis_3, axis_4, snapshot_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, diamond, axis_1, axis_2, axis_3, axis_4, snapshot_type);

    const snapshot = db.prepare('SELECT * FROM skill_snapshots WHERE id = ?')
      .get(result.lastInsertRowid);

    res.status(201).json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/skills/:userId/history — full history for growth tracking
router.get('/:userId/history', (req, res) => {
  const { userId } = req.params;
  const { diamond, snapshot_type } = req.query;

  let sql = 'SELECT * FROM skill_snapshots WHERE user_id = ?';
  const params = [userId];

  if (diamond) {
    sql += ' AND diamond = ?';
    params.push(Number(diamond));
  }
  if (snapshot_type) {
    sql += ' AND snapshot_type = ?';
    params.push(snapshot_type);
  }

  sql += ' ORDER BY recorded_at ASC';

  const history = db.prepare(sql).all(...params);
  res.json(history);
});

module.exports = router;
