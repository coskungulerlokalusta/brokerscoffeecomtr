const crypto = require('crypto');
const kv = require('./kvStore');

const CUSTOMERS_KEY = 'customers';
const SESSIONS_KEY = 'customer_sessions';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 gün (varsayılan / "beni hatırla" kapalıyken)
const SESSION_TTL_LONG_MS = 365 * 24 * 60 * 60 * 1000; // 1 yıl ("beni hatırla" açıkken — uygulama gibi sürekli girişli kalır)

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

// E-posta isteğe bağlıdır; geçersizse boş bırakılır
function cleanEmail(email) {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return e && e.length <= 190 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
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

async function registerOrLogin({ phone, name, isStaff, storeName, keepLoggedIn, email, marketingConsent }) {
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
      storeName: isStaff ? (storeName || null) : null,
      loyaltyPoints: 0,
      email: cleanEmail(email),
      marketingConsentAt: cleanEmail(email) && marketingConsent ? new Date().toISOString() : null,
      createdAt: new Date().toISOString(),
    };
    customers.push(customer);
    await saveCustomers(customers);
  }

  const token = crypto.randomBytes(32).toString('hex');
  const sessions = await loadSessions();
  const ttl = keepLoggedIn === false ? SESSION_TTL_MS : SESSION_TTL_LONG_MS;
  sessions[token] = { customerId: customer.id, expires: Date.now() + ttl };
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
  if (customer.active === false) return res.status(403).json({ error: 'Hesabınız pasif durumda, mağazayla iletişime geçin.' });
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

// Üyeyi pasife al/aktif et — pasif üyelere kampanya/toplu mesaj gönderilmez,
// ayrıca giriş yapamaz hale gelir.
async function setCustomerActive(customerId, active) {
  const customers = await loadCustomers();
  const customer = customers.find((c) => c.id === customerId);
  if (!customer) return null;
  customer.active = !!active;
  await saveCustomers(customers);
  return customer;
}

// Üyenin e-posta adresini ve kampanya e-postası iznini günceller.
// Dönüş: { customer, emailAdded } — emailAdded: daha önce e-postası yokken ilk kez eklendi mi
async function updateProfile(customerId, { email, marketingConsent }) {
  const customers = await loadCustomers();
  const customer = customers.find((c) => c.id === customerId);
  if (!customer) return null;
  const hadEmail = !!customer.email;
  if (email !== undefined) {
    const e = cleanEmail(email);
    if (email && !e) throw new Error('Geçerli bir e-posta adresi girin');
    if (e !== customer.email) customer.marketingConsentAt = null; // adres değişince izin yeniden alınır
    customer.email = e;
  }
  if (marketingConsent !== undefined) {
    customer.marketingConsentAt = customer.email && marketingConsent ? (customer.marketingConsentAt || new Date().toISOString()) : null;
  }
  await saveCustomers(customers);
  return { customer, emailAdded: !hadEmail && !!customer.email };
}

// Üyeyi tamamen siler — geri alınamaz.
async function deleteCustomer(customerId) {
  const customers = await loadCustomers();
  const filtered = customers.filter((c) => c.id !== customerId);
  if (filtered.length === customers.length) return false;
  await saveCustomers(filtered);
  return true;
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
  setCustomerActive,
  deleteCustomer,
  normalizePhone,
  cleanEmail,
  updateProfile,
};
