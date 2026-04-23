// Authentication middleware

// Require any login (team or manager)
function requireLogin(req, res, next) {
  if (req.session && req.session.role) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

// Require manager login
function requireManager(req, res, next) {
  if (req.session && req.session.role === 'manager') {
    return next();
  }
  if (!req.session || !req.session.role) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  res.status(403).json({ error: 'Manager access required' });
}

module.exports = { requireLogin, requireManager };
