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
    ORDER BY recorded_at DESC
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
      avgScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
    }

    // Last updated timestamp
    const lastUpdate = db.prepare(`
      SELECT recorded_at FROM skill_snapshots
      WHERE user_id = ?
      ORDER BY recorded_at DESC
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

module.exports = router;
