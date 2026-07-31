const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, '..', '..', 'data', 'admin-users.json');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 saat

// Basit in-memory oturum deposu (tek sunucu için yeterli)
const sessions = new Map();

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check), Buffer.from(hash));
}

function findUser(username) {
  return loadUsers().find((u) => u.username === username);
}

function setUserPassword(username, password) {
  const users = loadUsers();
  const { salt, hash } = hashPassword(password);
  const existing = users.find((u) => u.username === username);
  if (existing) {
    existing.salt = salt;
    existing.hash = hash;
  } else {
    users.push({ username, salt, hash });
  }
  saveUsers(users);
}

function login(username, password) {
  const user = findUser(username);
  if (!user) return null;
  if (!verifyPassword(password, user.salt, user.hash)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, expires: Date.now() + SESSION_TTL_MS });
  return token;
}

function logout(token) {
  sessions.delete(token);
}

function validateSession(token) {
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session.username;
}

// Express middleware: oturumu doğrular, yoksa 401 döner
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.admin_session;
  const username = token && validateSession(token);
  if (!username) return res.status(401).json({ error: 'Oturum gerekli' });
  req.adminUsername = username;
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  findUser,
  setUserPassword,
  login,
  logout,
  validateSession,
  requireAuth,
};
