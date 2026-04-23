const express = require('express');
const path = require('path');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);

// Initialize database (runs schema creation + seeding)
const db = require('./db');

const { requireLogin, requireManager, requireManagerPage } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());

// Session middleware (SQLite-backed)
app.use(session({
  store: new SqliteStore({
    client: db,
    expired: { clear: true, intervalMs: 900000 } // clean expired sessions every 15 min
  }),
  secret: process.env.SESSION_SECRET || 'diamond-portal-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Static files (public assets always accessible — CSS, JS, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// --- Auth routes (public — no middleware) ---
app.use('/api/auth', require('./routes/auth'));

// --- Protected API routes ---
// Users: GET is readable by anyone logged in, mutations handled inside router (require manager)
app.use('/api/users', requireLogin, require('./routes/users'));

// Skills: GET readable by anyone logged in, POST (update) handled inside router (require manager)
app.use('/api/skills', requireLogin, require('./routes/skills'));

// Todos: GET readable by anyone logged in, POST/PUT/DELETE manager only handled inside router
app.use('/api/todos', requireLogin, require('./routes/todos'));

// Manager: readable by manager only
app.use('/api/manager', requireManager, require('./routes/manager'));

// --- Page routes ---
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/manager', requireManagerPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manager.html'));
});

app.listen(PORT, () => {
  console.log(`\n💎 Skill Portal running at http://localhost:${PORT}`);
  console.log(`   Login: http://localhost:${PORT}/login\n`);
});
