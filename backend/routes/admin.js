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
const messageQueue = require('../utils/messageQueue');
const pushNotifications = require('../utils/pushNotifications');
const whatsappConversations = require('../utils/whatsappConversations');
const instagram = require('../utils/instagram');
const instagramConversations = require('../utils/instagramConversations');
const messenger = require('../utils/messenger');
const messengerConversations = require('../utils/messengerConversations');
const crypto = require('crypto');

const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
  }
  const token = await adminAuth.login(username, password);
  if (!token) return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
  res.cookie('admin_session', token, COOKIE_OPTS);
  res.json({ ok: true, username });
});

router.post('/logout', async (req, res) => {
  const token = req.cookies && req.cookies.admin_session;
  if (token) await adminAuth.logout(token);
  res.clearCookie('admin_session');
  res.json({ ok: true });
});

router.get('/me', adminAuth.requireAuth, (req, res) => {
  res.json({ username: req.adminUsername });
});

router.post('/change-password', adminAuth.requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await adminAuth.findUser(req.adminUsername);
  if (!user || !adminAuth.verifyPassword(currentPassword, user.salt, user.hash)) {
    return res.status(401).json({ error: 'Mevcut şifre hatalı' });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Yeni şifre en az 8 karakter olmalı' });
  }
  await adminAuth.setUserPassword(req.adminUsername, newPassword);
  res.json({ ok: true });
});

router.get('/orders', adminAuth.requireAuth, async (req, res) => {
  res.json(await orderStore.loadOrders());
});

router.patch('/orders/:id/status', adminAuth.requireAuth, async (req, res) => {
  const { orderStatus } = req.body;
  const valid = ['yeni', 'hazirlaniyor', 'hazir', 'teslim-edildi', 'iptal'];
  if (!valid.includes(orderStatus)) {
    return res.status(400).json({ error: 'Geçersiz durum' });
  }
  const order = await orderStore.updateOrderStatus(req.params.id, orderStatus);
  if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
  res.json(order);
});

router.get('/settings', adminAuth.requireAuth, async (req, res) => {
  res.json(await settings.loadSettings());
});

router.post('/settings', adminAuth.requireAuth, async (req, res) => {
  const {
    staffDiscountByGroup, staffBannerText, aiAutoReplyEnabled, aiInstructions,
    extraShotPrice, deliveryFeeThreshold, deliveryFee, orderNotifyPhone1, orderNotifyPhone2, orderNotifySmsPhones, categoryOrder,
    audience, audienceView,
  } = req.body;
  const updates = {};
  if (aiAutoReplyEnabled !== undefined) updates.aiAutoReplyEnabled = !!aiAutoReplyEnabled;
  if (aiInstructions !== undefined) updates.aiInstructions = aiInstructions;
  if (categoryOrder !== undefined) {
    updates.categoryOrder = categoryOrder.filter(Boolean);
  }
  if (extraShotPrice !== undefined) updates.extraShotPrice = Number(extraShotPrice) || 0;
  if (deliveryFeeThreshold !== undefined) updates.deliveryFeeThreshold = Number(deliveryFeeThreshold) || 0;
  if (deliveryFee !== undefined) updates.deliveryFee = Number(deliveryFee) || 0;
  if (orderNotifyPhone1 !== undefined) updates.orderNotifyPhone1 = orderNotifyPhone1;
  if (orderNotifyPhone2 !== undefined) updates.orderNotifyPhone2 = orderNotifyPhone2;
  if (orderNotifySmsPhones !== undefined) {
    updates.orderNotifySmsPhones = orderNotifySmsPhones.filter((p) => p && p.trim());
  }
  if (staffDiscountByGroup !== undefined) {
    const cleaned = {};
    for (const key of Object.keys(staffDiscountByGroup)) {
      const pct = Number(staffDiscountByGroup[key]);
      if (isNaN(pct) || pct < 0 || pct > 100) {
        return res.status(400).json({ error: `İndirim oranı 0-100 arası olmalı (${key})` });
      }
      cleaned[key] = pct;
    }
    updates.staffDiscountByGroup = cleaned;
  }
  if (staffBannerText !== undefined) {
    updates.staffBannerText = staffBannerText;
  }

  // Personel/Müşteri için ayrı ayrı görünüm ayarları — sadece belirtilen taraf, ve sadece
  // gönderilen alanlar güncellenir (farklı bölümlerdeki kaydet butonları birbirini ezmesin diye).
  if (audience === 'customer' || audience === 'staff') {
    const current = await settings.loadSettings();
    const existing = current.audienceSettings[audience];
    const next = { ...existing };

    if (audienceView.showPaymentMethodSelector !== undefined) next.showPaymentMethodSelector = !!audienceView.showPaymentMethodSelector;
    if (audienceView.paymentMethodsEnabled !== undefined) {
      const cleanedPayment = {};
      for (const key of Object.keys(audienceView.paymentMethodsEnabled)) {
        cleanedPayment[key] = !!audienceView.paymentMethodsEnabled[key];
      }
      next.paymentMethodsEnabled = { ...existing.paymentMethodsEnabled, ...cleanedPayment };
    }
    if (audienceView.showOrderPreferences !== undefined) next.showOrderPreferences = !!audienceView.showOrderPreferences;
    if (audienceView.showDeliveryInfo !== undefined) next.showDeliveryInfo = !!audienceView.showDeliveryInfo;
    if (audienceView.requireAddress !== undefined) next.requireAddress = !!audienceView.requireAddress;
    if (audienceView.hiddenCategories !== undefined) next.hiddenCategories = audienceView.hiddenCategories.filter(Boolean);
    if (audienceView.hideCustomizationForCategories !== undefined) next.hideCustomizationForCategories = audienceView.hideCustomizationForCategories.filter(Boolean);
    if (audienceView.monthlySpendTiers !== undefined) {
      next.monthlySpendTiers = audienceView.monthlySpendTiers
        .map((t) => ({ threshold: Number(t.threshold) || 0, discount: Number(t.discount) || 0 }))
        .filter((t) => t.threshold > 0 && t.discount > 0);
    }

    updates.audienceSettings = { ...current.audienceSettings, [audience]: next };
  }

  res.json(await settings.updateSettings(updates));
});

router.post('/settings/regenerate-staff-code', adminAuth.requireAuth, async (req, res) => {
  const newCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  res.json(await settings.updateSettings({ staffSignupCode: newCode }));
});

router.get('/customers', adminAuth.requireAuth, async (req, res) => {
  const customers = (await customerAuth.loadCustomers()).map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    isStaff: c.isStaff,
    storeName: c.storeName || null,
    loyaltyPoints: c.loyaltyPoints || 0,
    createdAt: c.createdAt,
  }));
  res.json(customers);
});

// Genel mesaj taslağı oluştur (kampanya dışı)
router.post('/messages/draft', adminAuth.requireAuth, async (req, res) => {
  const { context } = req.body;
  if (!context) return res.status(400).json({ error: 'Bağlam metni gerekli' });
  try {
    const message = await aiAssistant.draftGenericMessage(context);
    res.json({ message });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Seçilen üyelere mesaj gönder — hemen veya bir zaman aralığına yayarak
router.post('/messages/send', adminAuth.requireAuth, async (req, res) => {
  const { recipientIds, message, channel, windowMinutes } = req.body;
  if (!recipientIds || !recipientIds.length || !message) {
    return res.status(400).json({ error: 'Alıcı ve mesaj gerekli' });
  }
  const allCustomers = await customerAuth.loadCustomers();
  const recipients = allCustomers.filter((c) => recipientIds.includes(c.id));
  if (!recipients.length) return res.status(400).json({ error: 'Alıcı bulunamadı' });

  const items = await messageQueue.enqueueBatch({
    recipients,
    message,
    channel: channel === 'sms' ? 'sms' : 'whatsapp',
    windowMinutes: Number(windowMinutes) || 0,
  });
  res.status(201).json({ queued: items.length });
});

// Mesaj kuyruğunu görüntüle (son gönderilenler/bekleyenler)
router.get('/messages/queue', adminAuth.requireAuth, async (req, res) => {
  res.json(await messageQueue.loadRecent());
});

router.get('/integrations', adminAuth.requireAuth, async (req, res) => {
  const data = await integrations.loadMasked();
  res.json(data);
});

router.post('/integrations/:provider', adminAuth.requireAuth, async (req, res) => {
  try {
    await integrations.updateProvider(req.params.provider, req.body);
    const masked = await integrations.loadMasked();
    res.json(masked[req.params.provider]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/integrations/:provider/test', adminAuth.requireAuth, async (req, res) => {
  const provider = req.params.provider;
  const testers = {
    netgsm: () => require('../utils/netgsm').testConnection(req.body.testPhone),
    whatsapp: () => require('../utils/whatsapp').testConnection(),
    anthropic: () => require('../utils/aiAssistant').testConnection(),
    instagram: () => require('../utils/instagram').testConnection(),
    messenger: () => require('../utils/messenger').testConnection(),
    multinet: () => require('../utils/multinet').testConnection(),
    pluxee: () => require('../utils/pluxee').testConnection(),
    paynet: () => require('../utils/paynet').testConnection(),
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

router.get('/rewards', adminAuth.requireAuth, async (req, res) => {
  res.json(await rewardStore.loadRewards());
});
router.post('/rewards', adminAuth.requireAuth, async (req, res) => {
  const { title, pointsCost, description, targetAudience } = req.body;
  if (!title || !pointsCost) return res.status(400).json({ error: 'Başlık ve puan gerekli' });
  res.status(201).json(await rewardStore.createReward({ title, pointsCost, description, targetAudience }));
});
router.put('/rewards/:id', adminAuth.requireAuth, async (req, res) => {
  const reward = await rewardStore.updateReward(req.params.id, req.body);
  if (!reward) return res.status(404).json({ error: 'Ödül bulunamadı' });
  res.json(reward);
});
router.delete('/rewards/:id', adminAuth.requireAuth, async (req, res) => {
  const ok = await rewardStore.deleteReward(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Ödül bulunamadı' });
  res.json({ ok: true });
});

router.get('/redemptions', adminAuth.requireAuth, async (req, res) => {
  res.json(await redemptionStore.loadRedemptions());
});
router.post('/redemptions/:id/fulfill', adminAuth.requireAuth, async (req, res) => {
  const r = await redemptionStore.markFulfilled(req.params.id);
  if (!r) return res.status(404).json({ error: 'Kayıt bulunamadı' });
  res.json(r);
});

router.get('/campaigns', adminAuth.requireAuth, async (req, res) => {
  res.json(await campaignStore.loadCampaigns());
});
router.post('/campaigns', adminAuth.requireAuth, async (req, res) => {
  const { title, description, type, value, startDate, endDate } = req.body;
  if (!title) return res.status(400).json({ error: 'Kampanya adı gerekli' });
  res.status(201).json(await campaignStore.createCampaign({ title, description, type, value, startDate, endDate }));
});
router.put('/campaigns/:id', adminAuth.requireAuth, async (req, res) => {
  const campaign = await campaignStore.updateCampaign(req.params.id, req.body);
  if (!campaign) return res.status(404).json({ error: 'Kampanya bulunamadı' });
  res.json(campaign);
});
router.delete('/campaigns/:id', adminAuth.requireAuth, async (req, res) => {
  const ok = await campaignStore.deleteCampaign(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Kampanya bulunamadı' });
  res.json({ ok: true });
});

router.post('/campaigns/:id/draft-message', adminAuth.requireAuth, async (req, res) => {
  const campaigns = await campaignStore.loadCampaigns();
  const campaign = campaigns.find((c) => c.id === req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Kampanya bulunamadı' });
  try {
    const message = await aiAssistant.draftStaffCampaignMessage(campaign);
    res.json({ message });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/campaigns/:id/notify-staff', adminAuth.requireAuth, async (req, res) => {
  const { message, channel } = req.body; // channel: 'whatsapp' | 'sms'
  if (!message) return res.status(400).json({ error: 'Mesaj metni gerekli' });

  const campaigns = await campaignStore.loadCampaigns();
  const campaign = campaigns.find((c) => c.id === req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Kampanya bulunamadı' });

  const allCustomers = await customerAuth.loadCustomers();
  const staffMembers = allCustomers.filter((c) => c.isStaff);
  if (!staffMembers.length) return res.status(400).json({ error: 'Kayıtlı personel yok' });

  const netgsm = require('../utils/netgsm');
  const results = [];
  for (const staff of staffMembers) {
    try {
      if (channel === 'sms') {
        await netgsm.sendSms(staff.phone, message);
      } else {
        await whatsapp.sendTextMessage(staff.phone, message);
      }
      results.push({ phone: staff.phone, ok: true });
    } catch (err) {
      results.push({ phone: staff.phone, ok: false, error: err.message });
    }
  }

  await campaignStore.updateCampaign(campaign.id, { staffNotifiedAt: new Date().toISOString() });
  res.json({ results });
});

// Push bildirim: kaç kişi abone, listesi
router.get('/push/subscribers', adminAuth.requireAuth, async (req, res) => {
  const subs = await pushNotifications.loadSubscriptions();
  res.json({ count: subs.length });
});

// Push bildirim gönder — recipientIds boşsa tüm abonelere gider
router.post('/push/send', adminAuth.requireAuth, async (req, res) => {
  const { title, body, url, recipientIds } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Başlık ve mesaj gerekli' });
  const result = await pushNotifications.sendToAll({ title, body, url }, recipientIds);
  res.json(result);
});

// WhatsApp Gelen Kutusu — sohbet listesi
router.get('/whatsapp/conversations', adminAuth.requireAuth, async (req, res) => {
  res.json(await whatsappConversations.listConversations());
});

// Tek bir sohbetin tüm mesajları
router.get('/whatsapp/conversations/:phone', adminAuth.requireAuth, async (req, res) => {
  const convo = await whatsappConversations.getConversation(req.params.phone);
  if (!convo) return res.status(404).json({ error: 'Sohbet bulunamadı' });
  res.json(convo);
});

// Bir sohbete cevap gönder
router.post('/whatsapp/conversations/:phone/reply', adminAuth.requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Mesaj metni gerekli' });
  try {
    await whatsapp.sendTextMessage(req.params.phone, text);
    await whatsappConversations.addMessage(req.params.phone, { direction: 'out', text });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Instagram Gelen Kutusu — sohbet listesi
router.get('/instagram/conversations', adminAuth.requireAuth, async (req, res) => {
  res.json(await instagramConversations.listConversations());
});

router.get('/instagram/conversations/:igsid', adminAuth.requireAuth, async (req, res) => {
  const convo = await instagramConversations.getConversation(req.params.igsid);
  if (!convo) return res.status(404).json({ error: 'Sohbet bulunamadı' });
  res.json(convo);
});

router.post('/instagram/conversations/:igsid/reply', adminAuth.requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Mesaj metni gerekli' });
  try {
    await instagram.sendMessage(req.params.igsid, text);
    await instagramConversations.addMessage(req.params.igsid, { direction: 'out', text });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Messenger Gelen Kutusu — sohbet listesi
router.get('/messenger/conversations', adminAuth.requireAuth, async (req, res) => {
  res.json(await messengerConversations.listConversations());
});

router.get('/messenger/conversations/:psid', adminAuth.requireAuth, async (req, res) => {
  const convo = await messengerConversations.getConversation(req.params.psid);
  if (!convo) return res.status(404).json({ error: 'Sohbet bulunamadı' });
  res.json(convo);
});

router.post('/messenger/conversations/:psid/reply', adminAuth.requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Mesaj metni gerekli' });
  try {
    await messenger.sendMessage(req.params.psid, text);
    await messengerConversations.addMessage(req.params.psid, { direction: 'out', text });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
