import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { checkTrialExpiry } from '../trialCheck.js';
import { runAutoDayCloseIfNeeded } from '../dayCloseAuto.js';
import { loginLimiter } from '../rateLimiters.js';

const router = express.Router();

const STATUS_MESSAGES = {
  past_due: 'Ödeme süreniz doldu — hesabınıza devam etmek için ödeme yapmanız gerekiyor.',
  suspended: 'Hesabınız askıya alınmış. Lütfen bizimle iletişime geçin.',
};

// Kasa girişi — şube kodu + personel + PIN
router.post('/pin-login', loginLimiter, async (req, res) => {
  const { tenantSlug, userId, pin } = req.body;
  try {
    const [tenants] = await pool.query('SELECT * FROM tenants WHERE slug = ?', [tenantSlug]);
    if (tenants.length === 0) return res.status(404).json({ error: 'Şube bulunamadı' });
    let tenant = tenants[0];
    tenant = await checkTrialExpiry(tenant);
    if (STATUS_MESSAGES[tenant.subscription_status]) {
      return res.status(402).json({ error: STATUS_MESSAGES[tenant.subscription_status], subscription_status: tenant.subscription_status });
    }

    const [users] = await pool.query(
      'SELECT * FROM users WHERE id = ? AND tenant_id = ? AND pin = ?',
      [userId, tenant.id, pin]
    );
    if (users.length === 0) return res.status(401).json({ error: 'Hatalı PIN' });
    const user = users[0];

    // Yetkileri belirle — sahip (owner) her zaman tam yetkili, diğerleri
    // atanmış rolden gelir, rol atanmamışsa hiçbir özel yetki yoktur (güvenli varsayılan)
    let permissions = {};
    if (user.role === 'owner') {
      const { PERMISSION_KEYS } = await import('./staff.js');
      PERMISSION_KEYS.forEach(p => { permissions[p.key] = true; });
    } else if (user.role_id) {
      const [[roleRow]] = await pool.query('SELECT permissions FROM roles WHERE id = ? AND tenant_id = ?', [user.role_id, tenant.id]);
      if (roleRow) permissions = typeof roleRow.permissions === 'string' ? JSON.parse(roleRow.permissions) : roleRow.permissions;
    }

    const token = jwt.sign(
      { tenantId: tenant.id, userId: user.id, role: user.role, permissions },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    const tenantFeatures = tenant.features ? (typeof tenant.features === 'string' ? JSON.parse(tenant.features) : tenant.features) : {};
    res.json({ token, tenant: { id: tenant.id, name: tenant.name, currency: tenant.currency, slug: tenant.slug, features: tenantFeatures, opening_time: tenant.opening_time, closing_time: tenant.closing_time, require_customer_name: !!tenant.require_customer_name, auto_print_receipt: tenant.auto_print_receipt === undefined ? true : !!tenant.auto_print_receipt, business_type: tenant.business_type }, user: { id: user.id, name: user.name, role: user.role, permissions } });

    // Giriş cevabı gönderildikten SONRA, arka planda kontrol ediyoruz — süresi
    // dolmuş bir iş günü varsa otomatik kapatılsın. Kasiyerin girişini
    // yavaşlatmasın diye "await" etmiyoruz, hatası da girişi etkilemesin.
    runAutoDayCloseIfNeeded(tenant.id).catch(e => console.error('Otomatik gün sonu başarısız:', e.message));
  } catch (e) {
    res.status(500).json({ error: 'Giriş hatası', detail: e.message });
  }
});

// Yönetim paneli / patron uygulaması girişi — e-posta + şifre
// Aynı e-posta/şifre birden fazla şubede (aynı markanın farklı şubeleri) kayıtlıysa,
// hepsini "branches" listesinde döner — panel/patron arasında şube geçişi yapılabilir.
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    const [candidates] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (candidates.length === 0) return res.status(401).json({ error: 'E-posta veya şifre hatalı' });

    const matched = [];
    for (const u of candidates) {
      const valid = await bcrypt.compare(password, u.password_hash || '');
      if (valid) matched.push(u);
    }
    if (matched.length === 0) return res.status(401).json({ error: 'E-posta veya şifre hatalı' });

    const user = matched[0];
    const [tenants] = await pool.query('SELECT * FROM tenants WHERE id = ?', [user.tenant_id]);
    let tenant = tenants[0];
    tenant = await checkTrialExpiry(tenant);
    if (STATUS_MESSAGES[tenant.subscription_status]) {
      return res.status(402).json({ error: STATUS_MESSAGES[tenant.subscription_status], subscription_status: tenant.subscription_status });
    }

    // Birden fazla şubeye eşleşme varsa hepsinin adını/id'sini de döndür (şube seçici için)
    let branches = [];
    if (matched.length > 1) {
      const tenantIds = matched.map(m => m.tenant_id);
      const [branchTenants] = await pool.query(`SELECT id, name FROM tenants WHERE id IN (?)`, [tenantIds]);
      branches = branchTenants.map(t => ({ tenantId: t.id, name: t.name }));
    }

    const token = jwt.sign(
      { tenantId: user.tenant_id, userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, tenant, user: { id: user.id, name: user.name, role: user.role }, branches });
  } catch (e) {
    res.status(500).json({ error: 'Giriş hatası', detail: e.message });
  }
});

// Kasa giriş ekranının personel listesini göstermesi için — PIN olmadan sadece isim/id döner
router.get('/staff', async (req, res) => {
  const { tenantSlug } = req.query;
  try {
    const [tenants] = await pool.query('SELECT * FROM tenants WHERE slug = ?', [tenantSlug]);
    if (tenants.length === 0) return res.status(404).json({ error: 'Şube bulunamadı' });
    const [users] = await pool.query(
      'SELECT id, name, role FROM users WHERE tenant_id = ?',
      [tenants[0].id]
    );
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: 'Personel listesi alınamadı', detail: e.message });
  }
});

// Yönetim paneli (web) için e-posta/şifre belirleme — güvenlik amacıyla mevcut kasa PIN'ini doğrular.
// Sadece bir kez, panel için ilk hesabınızı kurarken kullanılır.
router.post('/set-password', async (req, res) => {
  const { tenantSlug, userId, pin, email, newPassword } = req.body;
  try {
    const [tenants] = await pool.query('SELECT * FROM tenants WHERE slug = ?', [tenantSlug]);
    if (tenants.length === 0) return res.status(404).json({ error: 'Şube bulunamadı' });
    const tenant = tenants[0];

    const [users] = await pool.query(
      'SELECT * FROM users WHERE id = ? AND tenant_id = ? AND pin = ?',
      [userId, tenant.id, pin]
    );
    if (users.length === 0) return res.status(401).json({ error: 'PIN doğrulanamadı — panel şifresi ayarlanamadı.' });

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET email = ?, password_hash = ? WHERE id = ?', [email, hash, userId]);
    res.json({ ok: true, message: 'Panel giriş bilgileri ayarlandı. Artık bu e-posta/şifre ile durakpos.com üzerinden giriş yapabilirsiniz.' });
  } catch (e) {
    res.status(500).json({ error: 'Şifre ayarlanamadı', detail: e.message });
  }
});

// Aynı e-posta ile bağlı başka bir şubeye geçiş — şifre tekrar sorulmaz,
// mevcut geçerli token'daki e-posta ile hedef şubede eşleşen hesap doğrulanır
router.post('/switch-branch', async (req, res) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Giriş gerekli' });
  const { targetTenantId } = req.body;
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    const [[currentUser]] = await pool.query('SELECT email FROM users WHERE id = ?', [payload.userId]);
    if (!currentUser || !currentUser.email) return res.status(403).json({ error: 'Şube değiştirilemez' });

    const [[targetUser]] = await pool.query(
      'SELECT * FROM users WHERE tenant_id = ? AND email = ?',
      [targetTenantId, currentUser.email]
    );
    if (!targetUser) return res.status(403).json({ error: 'Bu şubeye erişiminiz yok' });

    const [[tenant]] = await pool.query('SELECT * FROM tenants WHERE id = ?', [targetTenantId]);
    if (!tenant) return res.status(404).json({ error: 'Şube bulunamadı' });

    const token = jwt.sign(
      { tenantId: targetUser.tenant_id, userId: targetUser.id, role: targetUser.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, tenant, user: { id: targetUser.id, name: targetUser.name, role: targetUser.role } });
  } catch (e) {
    res.status(401).json({ error: 'Geçersiz oturum' });
  }
});

export default router;
