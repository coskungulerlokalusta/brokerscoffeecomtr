const crypto = require('crypto');
const kv = require('./kvStore');

const CUSTOMERS_KEY = 'customers';
const SESSIONS_KEY = 'customer_sessions';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 gün

async function loadCustomers() {
  return kv.getJSON(CUSTOMERS_KEY, []);
}

async function saveCustomers(customers) {
  return kv.setJSON(CUSTOMERS_KEY, customers);
}

async function loadSessions() {
  return kv.getJSON(SESSIONS_KEY, {});
}

async function saveSessions(sessions) {
  return kv.setJSON(SESSIONS_KEY, sessions);
}

function normalizePhone(phone) {
  return phone.replace(/\D/g, '');
}

async function findByPhone(phone) {
  const normalized = normalizePhone(phone);
  const customers = await loadCustomers();
  return customers.find((c) => c.phone === normalized);
}

async function findById(id) {
  const customers = await loadCustomers();
  return customers.find((c) => c.id === id);
}

async function registerOrLogin({ phone, name, isStaff }) {
  const normalized = normalizePhone(phone);
  const customers = await loadCustomers();
  let customer = customers.find((c) => c.phone === normalized);

  if (!customer) {
    if (!name) throw new Error('İlk kayıt için ad soyad gerekli');
    customer = {
      id: crypto.randomUUID(),
      name,
      phone: normalized,
      isStaff: !!isStaff,
      loyaltyPoints: 0,
      createdAt: new Date().toISOString(),
    };
    customers.push(customer);
    await saveCustomers(customers);
  }

  const token = crypto.randomBytes(32).toString('hex');
  const sessions = await loadSessions();
  sessions[token] = { customerId: customer.id, expires: Date.now() + SESSION_TTL_MS };
  await saveSessions(sessions);
  return { token, customer };
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
  return session.customerId;
}

async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.customer_session;
  const customerId = token && (await validateSession(token));
  if (!customerId) return res.status(401).json({ error: 'Oturum gerekli' });
  const customer = await findById(customerId);
  if (!customer) return res.status(401).json({ error: 'Oturum gerekli' });
  req.customer = customer;
  next();
}

async function attachCustomerIfPresent(req, res, next) {
  const token = req.cookies && req.cookies.customer_session;
  const customerId = token && (await validateSession(token));
  if (customerId) {
    req.customer = await findById(customerId);
  }
  next();
}

async function addPoints(customerId, points) {
  const customers = await loadCustomers();
  const customer = customers.find((c) => c.id === customerId);
  if (!customer) return null;
  customer.loyaltyPoints = (customer.loyaltyPoints || 0) + points;
  await saveCustomers(customers);
  return customer;
}

async function deductPoints(customerId, points) {
  const customers = await loadCustomers();
  const customer = customers.find((c) => c.id === customerId);
  if (!customer) return null;
  if ((customer.loyaltyPoints || 0) < points) return null;
  customer.loyaltyPoints -= points;
  await saveCustomers(customers);
  return customer;
}

module.exports = {
  registerOrLogin,
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
  normalizePhone,
};
