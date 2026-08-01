const express = require('express');
const router = express.Router();
const adminAuth = require('../utils/adminAuth');
const orderStore = require('../utils/orderStore');
const settings = require('../utils/settings');
const integrations = require('../utils/integrations');
const rewardStore = require('../utils/rewardStore');
const redemptionStore = require('../utils/redemptionStore');
const campaignStore = require('../utils/campaignStore');
const aiAssistant = require('../utils/aiAssistant');
const whatsapp = require('../utils/whatsapp');
const customerAuth = require('../utils/customerAuth');
const crypto = require('crypto');

const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 gün
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

// Kampanya yönetimi
router.get('/campaigns', adminAuth.requireAuth, (req, res) => {
  res.json(campaignStore.loadCampaigns());
});
router.post('/campaigns', adminAuth.requireAuth, (req, res) => {
  const { title, description, type, value, startDate, endDate } = req.body;
  if (!title) return res.status(400).json({ error: 'Kampanya adı gerekli' });
  res.status(201).json(campaignStore.createCampaign({ title, description, type, value, startDate, endDate }));
});
router.put('/campaigns/:id', adminAuth.requireAuth, (req, res) => {
  const campaign = campaignStore.updateCampaign(req.params.id, req.body);
  if (!campaign) return res.status(404).json({ error: 'Kampanya bulunamadı' });
  res.json(campaign);
});
router.delete('/campaigns/:id', adminAuth.requireAuth, (req, res) => {
  const ok = campaignStore.deleteCampaign(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Kampanya bulunamadı' });
  res.json({ ok: true });
});

// AI ile personele duyuru mesajı taslağı oluştur (henüz göndermez, sadece metin döner)
router.post('/campaigns/:id/draft-message', adminAuth.requireAuth, async (req, res) => {
  const campaign = campaignStore.loadCampaigns().find((c) => c.id === req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Kampanya bulunamadı' });
  try {
    const message = await aiAssistant.draftStaffCampaignMessage(campaign);
    res.json({ message });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Onaylanan mesajı tüm personele WhatsApp'tan gönder
router.post('/campaigns/:id/notify-staff', adminAuth.requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Mesaj metni gerekli' });

  const campaign = campaignStore.loadCampaigns().find((c) => c.id === req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Kampanya bulunamadı' });

  const staffMembers = customerAuth.loadCustomers().filter((c) => c.isStaff);
  if (!staffMembers.length) return res.status(400).json({ error: 'Kayıtlı personel yok' });

  const results = [];
  for (const staff of staffMembers) {
    try {
      await whatsapp.sendTextMessage(staff.phone, message);
      results.push({ phone: staff.phone, ok: true });
    } catch (err) {
      results.push({ phone: staff.phone, ok: false, error: err.message });
    }
  }

  campaignStore.updateCampaign(campaign.id, { staffNotifiedAt: new Date().toISOString() });
  res.json({ results });
});

// Entegrasyon bağlantısını gerçekten test et (kaydedilmiş bilgilerle)
router.post('/integrations/:provider/test', adminAuth.requireAuth, async (req, res) => {
  const provider = req.params.provider;
  const testers = {
    netgsm: () => require('../utils/netgsm').testConnection(req.body.testPhone),
    whatsapp: () => require('../utils/whatsapp').testConnection(),
    anthropic: () => require('../utils/aiAssistant').testConnection(),
  };
  if (!testers[provider]) {
    return res.status(400).json({ error: 'Bu sağlayıcı için otomatik bağlantı testi henüz yok.' });
  }
  try {
    const result = await testers[provider]();
    res.json({ ok: true, message: typeof result === 'string' ? result : 'Bağlantı başarılı.' });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
