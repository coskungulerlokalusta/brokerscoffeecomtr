const crypto = require('crypto');
const kv = require('./kvStore');

const USERS_KEY = 'admin_users';
const SESSIONS_KEY = 'admin_sessions';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 gün

async function loadUsers() {
  return kv.getJSON(USERS_KEY, []);
}

async function saveUsers(users) {
  return kv.setJSON(USERS_KEY, users);
}

async function loadSessions() {
  return kv.getJSON(SESSIONS_KEY, {});
}

async function saveSessions(sessions) {
  return kv.setJSON(SESSIONS_KEY, sessions);
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

async function findUser(username) {
  const users = await loadUsers();
  return users.find((u) => u.username === username);
}

async function setUserPassword(username, password) {
  const users = await loadUsers();
  const { salt, hash } = hashPassword(password);
  const existing = users.find((u) => u.username === username);
  if (existing) {
    existing.salt = salt;
    existing.hash = hash;
  } else {
    users.push({ username, salt, hash });
  }
  await saveUsers(users);
}

async function login(username, password) {
  const user = await findUser(username);
  if (!user) return null;
  if (!verifyPassword(password, user.salt, user.hash)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const sessions = await loadSessions();
  sessions[token] = { username, expires: Date.now() + SESSION_TTL_MS };
  await saveSessions(sessions);
  return token;
}

async function logout(token) {
  const sessions = await loadSessions();
  delete sessions[token];
  await saveSessions(sessions);
}

async function validateSession(token) {
  const sessions = await loadSessions();
  const session = sessions[token];
  if (!session) return null;
  if (session.expires < Date.now()) {
    delete sessions[token];
    await saveSessions(sessions);
    return null;
  }
  return session.username;
}

async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.admin_session;
  const username = token && (await validateSession(token));
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
