const express = require('express');
const router = express.Router();
const adminAuth = require('../utils/adminAuth');
const orderStore = require('../utils/orderStore');

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

module.exports = router;
