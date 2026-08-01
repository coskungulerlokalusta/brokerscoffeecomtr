const express = require('express');
const router = express.Router();
const customerAuth = require('../utils/customerAuth');
const settings = require('../utils/settings');

const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

router.post('/register', (req, res) => {
  const { name, phone, password, staffCode } = req.body;
  if (!name || !phone || !password) {
    return res.status(400).json({ error: 'Ad, telefon ve şifre gerekli' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });
  }

  let isStaff = false;
  if (staffCode) {
    const currentSettings = settings.loadSettings();
    if (staffCode !== currentSettings.staffSignupCode) {
      return res.status(400).json({ error: 'Personel kodu hatalı' });
    }
    isStaff = true;
  }

  try {
    const customer = customerAuth.register({ name, phone, password, isStaff });
    const { token } = customerAuth.login(phone, password);
    res.cookie('customer_session', token, COOKIE_OPTS);
    res.status(201).json({ id: customer.id, name: customer.name, isStaff: customer.isStaff });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'Telefon ve şifre gerekli' });

  const result = customerAuth.login(phone, password);
  if (!result) return res.status(401).json({ error: 'Telefon veya şifre hatalı' });

  res.cookie('customer_session', result.token, COOKIE_OPTS);
  res.json({ id: result.customer.id, name: result.customer.name, isStaff: result.customer.isStaff });
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
