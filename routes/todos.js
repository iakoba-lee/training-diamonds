const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireManager } = require('../middleware/auth');

/**
 * Recalculates the user's skill diamond snapshot based on completed tasks.
 * The level for an axis is the highest level L where ALL tasks in levels 1 through L are complete.
 */
function syncUserDiamondSnapshot(userId, diamondId) {
  try {
    // 1. Get all todos for this diamond
    const allTodos = db.prepare('SELECT id, axis, level FROM todos WHERE diamond = ?').all(diamondId);
    
    // 2. Get all completed todos for this user
    const completedRows = db.prepare(`
      SELECT todo_id FROM user_todos 
      WHERE user_id = ? AND status = 'completed'
    `).all(userId);
    const completedIds = new Set(completedRows.map(r => r.todo_id));

    const axes = { 1: 0, 2: 0, 3: 0, 4: 0 };

    for (let axis = 1; axis <= 4; axis++) {
      const axisTodos = allTodos.filter(t => t.axis === axis);
      if (axisTodos.length === 0) continue;

      // Group by level
      const levelGroups = {};
      axisTodos.forEach(t => {
        if (!levelGroups[t.level]) levelGroups[t.level] = [];
        levelGroups[t.level].push(t.id);
      });

      // Find highest level where all tasks are complete
      let highestCompleteLevel = 0;
      const sortedLevels = Object.keys(levelGroups).map(Number).sort((a, b) => a - b);
      
      for (const lvl of sortedLevels) {
        const allTaskIds = levelGroups[lvl];
        const allDone = allTaskIds.every(id => completedIds.has(id));
        if (allDone) {
          highestCompleteLevel = lvl;
        } else {
          // Stop at the first incomplete level
          break;
        }
      }
      axes[axis] = highestCompleteLevel;
    }

    // 3. Insert new snapshot
    db.prepare(`
      INSERT INTO skill_snapshots (user_id, diamond, axis_1, axis_2, axis_3, axis_4, snapshot_type)
      VALUES (?, ?, ?, ?, ?, ?, 'current')
    `).run(userId, diamondId, axes[1], axes[2], axes[3], axes[4]);
  } catch (err) {
    console.error('Error syncing diamond snapshot:', err);
  }
}

// GET /api/todos?userId=...
// Fetch all todos. If userId is provided, attach completion status.
router.get('/', (req, res) => {
  const { userId } = req.query;

  try {
    const todos = db.prepare(`
      SELECT id, diamond, axis, level, title, content, created_at
      FROM todos
      ORDER BY diamond ASC, axis ASC, created_at ASC
    `).all();

    if (userId) {
      const completions = db.prepare(`
        SELECT todo_id, completed, status, completed_at, submitted_at, notes
        FROM user_todos
        WHERE user_id = ?
      `).all(userId);

      const completedMap = {};
      for (const row of completions) {
        completedMap[row.todo_id] = { 
          completed: row.completed, 
          status: row.status, 
          completed_at: row.completed_at,
          submitted_at: row.submitted_at,
          notes: row.notes
        };
      }

      for (const todo of todos) {
        todo.completion = completedMap[todo.id] || { 
          completed: 0, 
          status: 'incomplete', 
          completed_at: null,
          submitted_at: null,
          notes: ''
        };
      }
    }

    res.json(todos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/todos - Manager only
router.post('/', requireManager, (req, res) => {
  const { diamond, axis, level, title, content } = req.body;

  if (!diamond || !axis || !level || !title) {
    return res.status(400).json({ error: 'diamond, axis, level, and title are required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO todos (diamond, axis, level, title, content)
      VALUES (?, ?, ?, ?, ?)
    `).run(diamond, axis, level, title, content || '');

    const newTodo = db.prepare('SELECT * FROM todos WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newTodo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/todos/:id - Manager only
router.put('/:id', requireManager, (req, res) => {
  const { id } = req.params;
  const { title, content } = req.body;

  try {
    const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
    if (!todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    db.prepare(`
      UPDATE todos
      SET title = ?, content = ?, level = ?
      WHERE id = ?
    `).run(title || todo.title, content || todo.content, req.body.level || todo.level, id);

    const updatedTodo = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
    res.json(updatedTodo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/todos/:id - Manager only
router.delete('/:id', requireManager, (req, res) => {
  const { id } = req.params;

  try {
    const result = db.prepare('DELETE FROM todos WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Todo not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/todos/:id/complete - User toggles their own completion status
router.post('/:id/complete', (req, res) => {
  const { id } = req.params;
  const { completed, userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const todo = db.prepare('SELECT id, diamond FROM todos WHERE id = ?').get(id);
    if (!todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    const newStatus = completed ? 'awaiting_approval' : 'incomplete';
    // If completed is checked, we don't set completed=1 yet, we keep it 0 but set status to awaiting_approval. 
    // Wait, let's keep completed=1 so it appears checked on the frontend until approved.
    
    db.prepare(`
      INSERT INTO user_todos (user_id, todo_id, completed, status, completed_at, submitted_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ${completed ? 'CURRENT_TIMESTAMP' : 'NULL'})
      ON CONFLICT(user_id, todo_id) DO UPDATE SET
        completed = excluded.completed,
        status = excluded.status,
        completed_at = CURRENT_TIMESTAMP,
        submitted_at = ${completed ? 'CURRENT_TIMESTAMP' : 'NULL'}
    `).run(userId, id, completed ? 1 : 0, newStatus);

    const statusRow = db.prepare('SELECT * FROM user_todos WHERE user_id = ? AND todo_id = ?').get(userId, id);
    
    // Recalculate diamond snapshot in case a completed task was marked incomplete
    if (todo) {
      syncUserDiamondSnapshot(userId, todo.diamond);
    }

    res.json(statusRow);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/todos/:id/notes - User saves notes for a todo
router.post('/:id/notes', (req, res) => {
  const { id } = req.params;
  const { notes, userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    db.prepare(`
      INSERT INTO user_todos (user_id, todo_id, notes)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, todo_id) DO UPDATE SET
        notes = excluded.notes
    `).run(userId, id, notes);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/todos/pending-approvals - Manager only
router.get('/pending-approvals', requireManager, (req, res) => {
  try {
    const pending = db.prepare(`
      SELECT ut.user_id, ut.todo_id, ut.completed_at, ut.submitted_at, ut.notes, u.display_name, u.team, t.title, t.diamond, t.axis, t.level
      FROM user_todos ut
      JOIN users u ON ut.user_id = u.id
      JOIN todos t ON ut.todo_id = t.id
      WHERE ut.status = 'awaiting_approval'
      ORDER BY ut.submitted_at ASC
    `).all();
    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/todos/approvals - Manager only
router.post('/approvals', requireManager, (req, res) => {
  const { userId, todoId, action } = req.body; // action: 'approve' or 'deny'

  if (!userId || !todoId || !action) {
    return res.status(400).json({ error: 'userId, todoId, and action are required' });
  }

  try {
    const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(todoId);
    if (!todo) return res.status(404).json({ error: 'Todo not found' });

    if (action === 'approve') {
      // 1. Update or Insert user_todos to 'completed'
      db.prepare(`
        INSERT INTO user_todos (user_id, todo_id, status, completed, completed_at)
        VALUES (?, ?, 'completed', 1, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, todo_id) DO UPDATE SET
          status = 'completed',
          completed = 1,
          completed_at = CURRENT_TIMESTAMP
      `).run(userId, todoId);
    } else if (action === 'deny') {
      db.prepare(`
        UPDATE user_todos
        SET status = 'incomplete', completed = 0
        WHERE user_id = ? AND todo_id = ?
      `).run(userId, todoId);
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    // 2. Recalculate diamond snapshot regardless of action (could be grant or revoke)
    syncUserDiamondSnapshot(userId, todo.diamond);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
