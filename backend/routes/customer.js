const express = require('express');
const router = express.Router();
const customerAuth = require('../utils/customerAuth');
const settings = require('../utils/settings');
const otpStore = require('../utils/otpStore');
const netgsm = require('../utils/netgsm');

const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

// Adım 1: Telefona doğrulama kodu gönder
router.post('/request-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone || phone.replace(/\D/g, '').length < 10) {
    return res.status(400).json({ error: 'Geçerli bir telefon numarası girin' });
  }
  const normalized = customerAuth.normalizePhone(phone);
  const code = otpStore.setCode(normalized);

  try {
    await netgsm.sendSms(normalized, `Brokers Coffee dogrulama kodunuz: ${code}`);
    res.json({ ok: true });
  } catch (err) {
    // NetGSM henüz kurulmadıysa geliştirme/test amaçlı kodu response'ta döndürmeyiz;
    // ama admin'e net hata döneriz.
    res.status(502).json({ error: 'SMS gönderilemedi: ' + err.message });
  }
});

// Adım 2: Kodu doğrula, üye ol / giriş yap
router.post('/verify-otp', (req, res) => {
  const { phone, code, name, isStaff, staffCode } = req.body;
  if (!phone || !code) return res.status(400).json({ error: 'Telefon ve kod gerekli' });

  const normalized = customerAuth.normalizePhone(phone);
  const isValid = otpStore.verifyCode(normalized, code);
  if (!isValid) return res.status(400).json({ error: 'Kod hatalı veya süresi dolmuş' });

  const existing = customerAuth.findByPhone(normalized);
  let staffFlag = false;
  if (!existing && isStaff) {
    const currentSettings = settings.loadSettings();
    if (staffCode !== currentSettings.staffSignupCode) {
      return res.status(400).json({ error: 'Personel kodu hatalı' });
    }
    staffFlag = true;
  }

  try {
    const { token, customer } = customerAuth.registerOrLogin({ phone: normalized, name, isStaff: staffFlag });
    res.cookie('customer_session', token, COOKIE_OPTS);
    res.json({ id: customer.id, name: customer.name, isStaff: customer.isStaff, isNew: !existing });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/logout', (req, res) => {
  const token = req.cookies && req.cookies.customer_session;
  if (token) customerAuth.logout(token);
  res.clearCookie('customer_session');
  res.json({ ok: true });
});

router.get('/me', customerAuth.requireAuth, (req, res) => {
  const currentSettings = settings.loadSettings();
  res.json({
    id: req.customer.id,
    name: req.customer.name,
    phone: req.customer.phone,
    isStaff: req.customer.isStaff,
    loyaltyPoints: req.customer.loyaltyPoints || 0,
    staffDiscountPercent: req.customer.isStaff ? currentSettings.staffDiscountPercent : 0,
    staffBannerText: req.customer.isStaff
      ? currentSettings.staffBannerText.replace('{percent}', currentSettings.staffDiscountPercent)
      : null,
  });
});

module.exports = router;
