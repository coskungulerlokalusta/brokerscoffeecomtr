const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CUSTOMERS_FILE = path.join(__dirname, '..', '..', 'data', 'customers.json');
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 gün

const sessions = new Map();

function loadCustomers() {
  if (!fs.existsSync(CUSTOMERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf-8'));
}

function saveCustomers(customers) {
  fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(customers, null, 2), 'utf-8');
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

function findByPhone(phone) {
  return loadCustomers().find((c) => c.phone === phone);
}

function findById(id) {
  return loadCustomers().find((c) => c.id === id);
}

function register({ name, phone, password, isStaff }) {
  const customers = loadCustomers();
  if (customers.find((c) => c.phone === phone)) {
    throw new Error('Bu telefon numarasıyla zaten bir hesap var');
  }
  const { salt, hash } = hashPassword(password);
  const customer = {
    id: crypto.randomUUID(),
    name,
    phone,
    salt,
    hash,
    isStaff: !!isStaff,
    loyaltyPoints: 0,
    createdAt: new Date().toISOString(),
  };
  customers.push(customer);
  saveCustomers(customers);
  return customer;
}

function login(phone, password) {
  const customer = findByPhone(phone);
  if (!customer) return null;
  if (!verifyPassword(password, customer.salt, customer.hash)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { customerId: customer.id, expires: Date.now() + SESSION_TTL_MS });
  return { token, customer };
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
  return session.customerId;
}

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.customer_session;
  const customerId = token && validateSession(token);
  if (!customerId) return res.status(401).json({ error: 'Oturum gerekli' });
  const customer = findById(customerId);
  if (!customer) return res.status(401).json({ error: 'Oturum gerekli' });
  req.customer = customer;
  next();
}

// Oturum varsa müşteriyi req'e ekler ama zorunlu kılmaz (opsiyonel giriş)
function attachCustomerIfPresent(req, res, next) {
  const token = req.cookies && req.cookies.customer_session;
  const customerId = token && validateSession(token);
  if (customerId) {
    req.customer = findById(customerId);
  }
  next();
}

function addPoints(customerId, points) {
  const customers = loadCustomers();
  const customer = customers.find((c) => c.id === customerId);
  if (!customer) return null;
  customer.loyaltyPoints = (customer.loyaltyPoints || 0) + points;
  saveCustomers(customers);
  return customer;
}

function deductPoints(customerId, points) {
  const customers = loadCustomers();
  const customer = customers.find((c) => c.id === customerId);
  if (!customer) return null;
  if ((customer.loyaltyPoints || 0) < points) return null; // yetersiz puan
  customer.loyaltyPoints -= points;
  saveCustomers(customers);
  return customer;
}

module.exports = {
  register,
  login,
  logout,
  validateSession,
  requireAuth,
  attachCustomerIfPresent,
  findByPhone,
  findById,
  loadCustomers,
  saveCustomers,
  addPoints,
  deductPoints,
};
