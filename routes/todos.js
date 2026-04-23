const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireManager } = require('../middleware/auth');

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
        SELECT todo_id, completed, completed_at
        FROM user_todos
        WHERE user_id = ?
      `).all(userId);

      const completedMap = {};
      for (const row of completions) {
        completedMap[row.todo_id] = { completed: row.completed, completed_at: row.completed_at };
      }

      for (const todo of todos) {
        todo.completion = completedMap[todo.id] || { completed: 0, completed_at: null };
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

  // Ideally, userId comes from session or a token. In this basic system, the frontend passes it.
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const todo = db.prepare('SELECT id FROM todos WHERE id = ?').get(id);
    if (!todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    // Upsert completion
    db.prepare(`
      INSERT INTO user_todos (user_id, todo_id, completed, completed_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, todo_id) DO UPDATE SET
        completed = excluded.completed,
        completed_at = CURRENT_TIMESTAMP
    `).run(userId, id, completed ? 1 : 0);

    const status = db.prepare('SELECT * FROM user_todos WHERE user_id = ? AND todo_id = ?').get(userId, id);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
