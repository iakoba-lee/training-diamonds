const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/manager/team-overview — all users with their latest snapshots
router.get('/team-overview', (req, res) => {
  const users = db.prepare(`
    SELECT id, display_name, role, team, created_at
    FROM users
    ORDER BY role DESC, display_name ASC
  `).all();

  const getLatest = db.prepare(`
    SELECT * FROM skill_snapshots
    WHERE user_id = ? AND diamond = ? AND snapshot_type = ?
    ORDER BY recorded_at DESC, id DESC
    LIMIT 1
  `);

  const overview = users.map(user => {
    const d1Current = getLatest.get(user.id, 1, 'current');
    const d1Aim = getLatest.get(user.id, 1, 'aim');
    const d2Current = getLatest.get(user.id, 2, 'current');
    const d2Aim = getLatest.get(user.id, 2, 'aim');

    // Compute average current score across both diamonds
    let avgScore = null;
    const scores = [];
    if (d1Current) scores.push(d1Current.axis_1, d1Current.axis_2, d1Current.axis_3, d1Current.axis_4);
    if (d2Current) scores.push(d2Current.axis_1, d2Current.axis_2, d2Current.axis_3, d2Current.axis_4);
    if (scores.length > 0) {
      avgScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);
    }

    // Last updated timestamp
    const lastUpdate = db.prepare(`
      SELECT recorded_at FROM skill_snapshots
      WHERE user_id = ?
      ORDER BY recorded_at DESC, id DESC
      LIMIT 1
    `).get(user.id);

    return {
      ...user,
      diamond1: { current: d1Current, aim: d1Aim },
      diamond2: { current: d2Current, aim: d2Aim },
      avgScore,
      lastUpdated: lastUpdate ? lastUpdate.recorded_at : null
    };
  });

  res.json(overview);
});

// POST /api/manager/progress-reviews/:userId
router.post('/progress-reviews/:userId', (req, res) => {
  const { userId } = req.params;
  const { notes } = req.body;

  if (!notes) return res.status(400).json({ error: 'Notes are required' });

  try {
    db.prepare('INSERT INTO progress_reviews (user_id, notes) VALUES (?, ?)').run(userId, notes);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/manager/progress-reviews/:reviewId
router.put('/progress-reviews/:reviewId', (req, res) => {
  const { reviewId } = req.params;
  const { notes } = req.body;

  if (!notes) return res.status(400).json({ error: 'Notes are required' });

  try {
    const result = db.prepare('UPDATE progress_reviews SET notes = ? WHERE id = ?').run(notes, reviewId);
    if (result.changes === 0) return res.status(404).json({ error: 'Review not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/manager/progress-reviews/:reviewId
router.delete('/progress-reviews/:reviewId', (req, res) => {
  const { reviewId } = req.params;
  try {
    const result = db.prepare('DELETE FROM progress_reviews WHERE id = ?').run(reviewId);
    if (result.changes === 0) return res.status(404).json({ error: 'Review not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/manager/progress-reviews/:userId
router.get('/progress-reviews/:userId', (req, res) => {
  const { userId } = req.params;
  try {
    const reviews = db.prepare(`
      SELECT * FROM progress_reviews
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(userId);
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
