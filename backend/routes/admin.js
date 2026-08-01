const express = require('express');
const router = express.Router();
const adminAuth = require('../utils/adminAuth');
const orderStore = require('../utils/orderStore');
const settings = require('../utils/settings');
const integrations = require('../utils/integrations');
const rewardStore = require('../utils/rewardStore');
const redemptionStore = require('../utils/redemptionStore');
const crypto = require('crypto');

const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: 12 * 60 * 60 * 1000,
};

// Giriş
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
  }
  const token = adminAuth.login(username, password);
  if (!token) return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
  res.cookie('admin_session', token, COOKIE_OPTS);
  res.json({ ok: true, username });
});

// Çıkış
router.post('/logout', (req, res) => {
  const token = req.cookies && req.cookies.admin_session;
  if (token) adminAuth.logout(token);
  res.clearCookie('admin_session');
  res.json({ ok: true });
});

// Oturum kontrolü
router.get('/me', adminAuth.requireAuth, (req, res) => {
  res.json({ username: req.adminUsername });
});

// Şifre değiştir
router.post('/change-password', adminAuth.requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = adminAuth.findUser(req.adminUsername);
  if (!user || !adminAuth.verifyPassword(currentPassword, user.salt, user.hash)) {
    return res.status(401).json({ error: 'Mevcut şifre hatalı' });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Yeni şifre en az 8 karakter olmalı' });
  }
  adminAuth.setUserPassword(req.adminUsername, newPassword);
  res.json({ ok: true });
});

// Siparişleri listele
router.get('/orders', adminAuth.requireAuth, (req, res) => {
  res.json(orderStore.loadOrders());
});

// Sipariş durumu güncelle
router.patch('/orders/:id/status', adminAuth.requireAuth, (req, res) => {
  const { orderStatus } = req.body;
  const valid = ['yeni', 'hazirlaniyor', 'hazir', 'teslim-edildi', 'iptal'];
  if (!valid.includes(orderStatus)) {
    return res.status(400).json({ error: 'Geçersiz durum' });
  }
  const order = orderStore.updateOrderStatus(req.params.id, orderStatus);
  if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
  res.json(order);
});

// Personel/site ayarlarını getir
router.get('/settings', adminAuth.requireAuth, (req, res) => {
  res.json(settings.loadSettings());
});

// Personel indirim oranı / banner metnini güncelle
router.post('/settings', adminAuth.requireAuth, (req, res) => {
  const { staffDiscountPercent, staffBannerText } = req.body;
  const updates = {};
  if (staffDiscountPercent !== undefined) {
    const pct = Number(staffDiscountPercent);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ error: 'İndirim oranı 0-100 arası olmalı' });
    }
    updates.staffDiscountPercent = pct;
  }
  if (staffBannerText !== undefined) {
    updates.staffBannerText = staffBannerText;
  }
  res.json(settings.updateSettings(updates));
});

// Personel kayıt kodunu yenile
router.post('/settings/regenerate-staff-code', adminAuth.requireAuth, (req, res) => {
  const newCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  res.json(settings.updateSettings({ staffSignupCode: newCode }));
});

// Kayıtlı müşteri/personel listesi
router.get('/customers', adminAuth.requireAuth, (req, res) => {
  const customerAuth = require('../utils/customerAuth');
  const customers = customerAuth.loadCustomers().map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    isStaff: c.isStaff,
    createdAt: c.createdAt,
  }));
  res.json(customers);
});

// Entegrasyon ayarlarını getir (secret alanlar maskeli döner)
router.get('/integrations', adminAuth.requireAuth, (req, res) => {
  res.json(integrations.loadMasked());
});

// Bir entegrasyonun ayarlarını güncelle (örn. provider = 'iyzico')
router.post('/integrations/:provider', adminAuth.requireAuth, (req, res) => {
  try {
    const updated = integrations.updateProvider(req.params.provider, req.body);
    // Yanıtta secret'ları geri gönderme, maskeli haliyle döndür
    res.json(integrations.loadMasked()[req.params.provider]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Ödül kataloğu yönetimi
router.get('/rewards', adminAuth.requireAuth, (req, res) => {
  res.json(rewardStore.loadRewards());
});
router.post('/rewards', adminAuth.requireAuth, (req, res) => {
  const { title, pointsCost, description } = req.body;
  if (!title || !pointsCost) return res.status(400).json({ error: 'Başlık ve puan gerekli' });
  res.status(201).json(rewardStore.createReward({ title, pointsCost, description }));
});
router.put('/rewards/:id', adminAuth.requireAuth, (req, res) => {
  const reward = rewardStore.updateReward(req.params.id, req.body);
  if (!reward) return res.status(404).json({ error: 'Ödül bulunamadı' });
  res.json(reward);
});
router.delete('/rewards/:id', adminAuth.requireAuth, (req, res) => {
  const ok = rewardStore.deleteReward(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Ödül bulunamadı' });
  res.json({ ok: true });
});

// Kullanılan ödüller (barista kod ile teslim edip işaretler)
router.get('/redemptions', adminAuth.requireAuth, (req, res) => {
  res.json(redemptionStore.loadRedemptions());
});
router.post('/redemptions/:id/fulfill', adminAuth.requireAuth, (req, res) => {
  const r = redemptionStore.markFulfilled(req.params.id);
  if (!r) return res.status(404).json({ error: 'Kayıt bulunamadı' });
  res.json(r);
});

module.exports = router;
