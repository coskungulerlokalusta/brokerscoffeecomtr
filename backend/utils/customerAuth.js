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

function normalizePhone(phone) {
  return phone.replace(/\D/g, '');
}

function findByPhone(phone) {
  const normalized = normalizePhone(phone);
  return loadCustomers().find((c) => c.phone === normalized);
}

function findById(id) {
  return loadCustomers().find((c) => c.id === id);
}

// Telefon doğrulandıktan sonra çağrılır: müşteri varsa girişini yapar, yoksa oluşturur
function registerOrLogin({ phone, name, isStaff }) {
  const normalized = normalizePhone(phone);
  const customers = loadCustomers();
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
    saveCustomers(customers);
  }

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
  if ((customer.loyaltyPoints || 0) < points) return null;
  customer.loyaltyPoints -= points;
  saveCustomers(customers);
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
