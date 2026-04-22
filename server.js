const express = require('express');
const path = require('path');

// Initialize database (runs schema creation)
require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/users', require('./routes/users'));
app.use('/api/skills', require('./routes/skills'));
app.use('/api/manager', require('./routes/manager'));

// SPA fallback — serve index.html for non-API routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/manager', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manager.html'));
});

app.listen(PORT, () => {
  console.log(`\n💎 Skill Portal running at http://localhost:${PORT}`);
  console.log(`   Manager View: http://localhost:${PORT}/manager\n`);
});
