const express = require('express');
const path = require('path');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);

// Initialize database (runs schema creation + seeding)
const db = require('./db');

const { requireLogin, requireManager } = require('./middleware/auth');

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
// Users: GET is readable by anyone logged in, mutations require manager
const usersRouter = require('./routes/users');
app.get('/api/users', requireLogin, (req, res, next) => { req.url = '/'; next(); }, usersRouter);
app.post('/api/users', requireManager, (req, res, next) => { req.url = '/'; next(); }, usersRouter);
app.put('/api/users/:id', requireManager, (req, res, next) => { req.url = `/${req.params.id}`; next(); }, usersRouter);
app.delete('/api/users/:id', requireManager, (req, res, next) => { req.url = `/${req.params.id}`; next(); }, usersRouter);

// Skills: GET readable by anyone logged in, POST (update) requires manager
const skillsRouter = require('./routes/skills');
app.get('/api/skills/:userId/latest', requireLogin, (req, res, next) => { req.url = `/${req.params.userId}/latest`; next(); }, skillsRouter);
app.get('/api/skills/:userId/history', requireLogin, (req, res, next) => { req.url = `/${req.params.userId}/history`; next(); }, skillsRouter);
app.post('/api/skills/:userId/update', requireManager, (req, res, next) => { req.url = `/${req.params.userId}/update`; next(); }, skillsRouter);

// Manager: readable by anyone logged in
app.use('/api/manager', requireLogin, require('./routes/manager'));

// --- Page routes ---
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/manager', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manager.html'));
});

app.listen(PORT, () => {
  console.log(`\n💎 Skill Portal running at http://localhost:${PORT}`);
  console.log(`   Login: http://localhost:${PORT}/login\n`);
});
