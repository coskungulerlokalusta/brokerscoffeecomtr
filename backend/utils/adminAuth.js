const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, '..', '..', 'data', 'admin-users.json');
const SESSIONS_FILE = path.join(__dirname, '..', '..', 'data', 'admin-sessions.json');
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 gün

// Oturumlar diske kaydedilir — sunucu yeniden başlasa bile (her deploy'da olduğu gibi)
// giriş yapmış kullanıcılar dışarı atılmaz.
function loadSessions() {
  if (!fs.existsSync(SESSIONS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSessions(sessions) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf-8');
}

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
  const sessions = loadSessions();
  sessions[token] = { username, expires: Date.now() + SESSION_TTL_MS };
  saveSessions(sessions);
  return token;
}

function logout(token) {
  const sessions = loadSessions();
  delete sessions[token];
  saveSessions(sessions);
}

function validateSession(token) {
  const sessions = loadSessions();
  const session = sessions[token];
  if (!session) return null;
  if (session.expires < Date.now()) {
    delete sessions[token];
    saveSessions(sessions);
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
