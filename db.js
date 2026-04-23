const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'skills.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'user',
    team         TEXT DEFAULT 'Default',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS skill_snapshots (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL,
    diamond        INTEGER NOT NULL CHECK(diamond IN (1, 2)),
    axis_1         INTEGER NOT NULL DEFAULT 0 CHECK(axis_1 BETWEEN 0 AND 5),
    axis_2         INTEGER NOT NULL DEFAULT 0 CHECK(axis_2 BETWEEN 0 AND 5),
    axis_3         INTEGER NOT NULL DEFAULT 0 CHECK(axis_3 BETWEEN 0 AND 5),
    axis_4         INTEGER NOT NULL DEFAULT 0 CHECK(axis_4 BETWEEN 0 AND 5),
    snapshot_type  TEXT NOT NULL CHECK(snapshot_type IN ('current', 'aim')),
    recorded_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_snapshots_lookup
    ON skill_snapshots(user_id, diamond, snapshot_type, recorded_at DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Seed default access codes if not set
const SALT_ROUNDS = 10;

const managerPw = db.prepare("SELECT value FROM settings WHERE key = 'manager_password'").get();
if (!managerPw) {
  const hash = bcrypt.hashSync('manager', SALT_ROUNDS);
  db.prepare("INSERT INTO settings (key, value) VALUES ('manager_password', ?)").run(hash);
  console.log('⚠️  Default manager password set to "manager" — change this in Settings!');
}

const teamPw = db.prepare("SELECT value FROM settings WHERE key = 'team_password'").get();
if (!teamPw) {
  const hash = bcrypt.hashSync('team', SALT_ROUNDS);
  db.prepare("INSERT INTO settings (key, value) VALUES ('team_password', ?)").run(hash);
  console.log('⚠️  Default team password set to "team" — change this in Settings!');
}

// Seed a default manager user if no users exist
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
if (userCount.count === 0) {
  const insertUser = db.prepare(
    'INSERT INTO users (display_name, role, team) VALUES (?, ?, ?)'
  );
  insertUser.run('Manager', 'manager', 'Support Team');
}

module.exports = db;
