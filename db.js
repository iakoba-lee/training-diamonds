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

  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    diamond INTEGER NOT NULL CHECK(diamond IN (1, 2)),
    axis INTEGER NOT NULL CHECK(axis BETWEEN 1 AND 4),
    level INTEGER NOT NULL DEFAULT 1 CHECK(level BETWEEN 1 AND 5),
    title TEXT NOT NULL,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    todo_id INTEGER NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'incomplete' CHECK(status IN ('incomplete', 'awaiting_approval', 'completed')),
    completed_at DATETIME,
    submitted_at DATETIME,
    notes TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
    UNIQUE(user_id, todo_id)
  );

  CREATE TABLE IF NOT EXISTS progress_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    notes TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Add 'level' column migration if it doesn't exist
try {
  db.exec('ALTER TABLE todos ADD COLUMN level INTEGER NOT NULL DEFAULT 1 CHECK(level BETWEEN 1 AND 5)');
} catch (e) {
  // Column already exists
}

// Add 'content' column migration to todos
try {
  db.exec("ALTER TABLE todos ADD COLUMN content TEXT");
} catch (e) {
  // Column already exists
}

// Add 'status' column migration to user_todos
try {
  db.exec("ALTER TABLE user_todos ADD COLUMN status TEXT NOT NULL DEFAULT 'incomplete' CHECK(status IN ('incomplete', 'awaiting_approval', 'completed'))");
} catch (e) {
  // Column already exists
}

// Add 'submitted_at' column migration to user_todos
try {
  db.exec("ALTER TABLE user_todos ADD COLUMN submitted_at DATETIME");
} catch (e) {
  // Column already exists
}

// Add 'completed_at' column migration to user_todos
try {
  db.exec("ALTER TABLE user_todos ADD COLUMN completed_at DATETIME");
} catch (e) {
  // Column already exists
}

// Add 'notes' column migration to user_todos
try {
  db.exec("ALTER TABLE user_todos ADD COLUMN notes TEXT");
} catch (e) {
  // Column already exists
}

// Add 'snapshot_type' column migration to skill_snapshots
try {
  db.exec("ALTER TABLE skill_snapshots ADD COLUMN snapshot_type TEXT NOT NULL DEFAULT 'current' CHECK(snapshot_type IN ('current', 'aim'))");
} catch (e) {
  // Column already exists
}

// Add 'role' column migration to users
try {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
} catch (e) {
  // Column already exists
}

// Add 'team' column migration to users
try {
  db.exec("ALTER TABLE users ADD COLUMN team TEXT DEFAULT 'Default'");
} catch (e) {
  // Column already exists
}

// Add 'created_at' column migration to users
try {
  db.exec("ALTER TABLE users ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP");
} catch (e) {
  // Column already exists
}

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

// Seed curriculum from curriculum.json if it exists
const curriculumPath = path.join(__dirname, 'curriculum.json');
if (fs.existsSync(curriculumPath)) {
  try {
    const curriculumData = JSON.parse(fs.readFileSync(curriculumPath, 'utf8'));
    
    const checkTodo = db.prepare(`
      SELECT id FROM todos WHERE diamond = ? AND axis = ? AND level = ? AND title = ?
    `);
    
    const insertTodo = db.prepare(`
      INSERT INTO todos (diamond, axis, level, title, content)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const updateTodo = db.prepare(`
      UPDATE todos SET content = ? WHERE id = ?
    `);

    const syncCurriculum = db.transaction((todos) => {
      let added = 0;
      let updated = 0;
      
      for (const item of todos) {
        const existing = checkTodo.get(item.diamond, item.axis, item.level, item.title);
        if (!existing) {
          insertTodo.run(item.diamond, item.axis, item.level, item.title, item.content || '');
          added++;
        } else {
          updateTodo.run(item.content || '', existing.id);
          updated++;
        }
      }
      
      console.log(`Synced curriculum: added ${added}, updated ${updated} to-do items in the database.`);
    });

    syncCurriculum(curriculumData);
  } catch (err) {
    console.error('Error seeding curriculum.json:', err);
  }
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


