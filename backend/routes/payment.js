const express = require('express');
const router = express.Router();
const paynet = require('../utils/paynet');
const orderStore = require('../utils/orderStore');
const customerAuth = require('../utils/customerAuth');
const settings = require('../utils/settings');
const orderNotify = require('../utils/orderNotify');
const monthlyTiers = require('../utils/monthlyTiers');
const multinet = require('../utils/multinet');
const pluxee = require('../utils/pluxee');
const crypto = require('crypto');
const { calculateDiscount } = require('../utils/discountCalc');

const SITE_DOMAIN = process.env.SITE_DOMAIN || 'brokerscoffee.com.tr';
const SITE_BASE_URL = process.env.SITE_BASE_URL || `https://${SITE_DOMAIN}`;

// Ödeme sayfasında canlı önizleme için — sipariş oluşturmaz, ödeme başlatmaz
router.post('/preview-discount', customerAuth.attachCustomerIfPresent, async (req, res) => {
  const { items, useMonthlyTier } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: 'Sepet boş' });
  const customerId = req.customer ? req.customer.id : null;
  const result = await calculateDiscount(items, !!(req.customer && req.customer.isStaff), { customerId, useMonthlyTier });
  res.json(result);
});

// Sipariş oluştur + Paynet ödemesi başlat (güvenli checkout token akışı)
router.post('/init', customerAuth.attachCustomerIfPresent, async (req, res) => {
  const { items, customerName, phone, deliveryType, address, orderIntensity, orderExtraShot, orderNote, useMonthlyTier } = req.body;

  if (!items || !items.length || !customerName || !phone || !deliveryType) {
    return res.status(400).json({ error: 'Eksik sipariş bilgisi' });
  }

  const publishableKey = await paynet.getPublishableKey();
  if (!publishableKey) {
    return res.status(400).json({ error: 'Ödeme sistemi henüz yapılandırılmadı.' });
  }

  const customerId = req.customer ? req.customer.id : null;
  const { subtotal, discountAmount, discountBreakdown, total: itemsTotal, appliedTier } = await calculateDiscount(
    items,
    !!(req.customer && req.customer.isStaff),
    { customerId, useMonthlyTier }
  );
  const currentSettings = await settings.loadSettings();
  const extraShotSurcharge = orderExtraShot ? (currentSettings.extraShotPrice || 0) : 0;
  const total = Math.round((itemsTotal + extraShotSurcharge) * 100) / 100;

  const order = await orderStore.createOrder({ items, customerName, phone, deliveryType, address, total, orderIntensity, orderExtraShot, orderNote });
  order.customerId = customerId;
  if (discountAmount > 0) {
    order.staffDiscountBreakdown = discountBreakdown;
    order.subtotalBeforeDiscount = subtotal;
  }
  if (appliedTier) {
    order.monthlyTierApplied = appliedTier.threshold;
  }
  {
    const orders = await orderStore.loadOrders();
    const idx = orders.findIndex((o) => o.id === order.id);
    if (idx !== -1) { orders[idx] = order; await orderStore.saveOrders(orders); }
  }

  // İstemciden gelen tutara güvenmiyoruz — token'ın içine sunucuda hesapladığımız
  // gerçek tutarı ve sipariş id'sini koyuyoruz, callback'te sadece bu eşleşir.
  const checkoutToken = paynet.createCheckoutToken({ orderId: order.id, amount: total });

  res.json({
    orderId: order.id,
    publishableKey,
    amount: total,
    checkoutToken,
    callbackUrl: `${SITE_BASE_URL}/api/payment/callback`,
  });
});

// Paynet.js widget'ının, müşteri kart bilgilerini onayladıktan sonra post ettiği
// geri dönüş adresi. GİRİŞ GEREKTİRMEZ — Paynet bizim sitemize kimlik bilgisiyle gelmez.
router.post('/callback', async (req, res) => {
  const { session_id: sessionId, token_id: tokenId, checkout_token: checkoutToken } = req.body;

  const pending = checkoutToken ? paynet.consumeCheckoutToken(checkoutToken) : null;
  if (!pending) {
    return res.redirect(`/payment-result.html?status=fail&message=${encodeURIComponent('Oturum geçersiz veya süresi dolmuş.')}`);
  }
  if (!sessionId || !tokenId) {
    return res.redirect(`/payment-result.html?status=fail&orderId=${pending.orderId}&message=${encodeURIComponent('Kart bilgisi alınamadı.')}`);
  }

  const chargeResult = await paynet.chargeTransaction({
    sessionId,
    tokenId,
    amount: pending.amount,
    referenceNo: pending.orderId,
  });

  try {
    const orders = await orderStore.loadOrders();
    const order = orders.find((o) => o.id === pending.orderId);
    if (order) {
      const success = chargeResult.ok;
      order.orderStatus = success ? 'yeni' : 'iptal';
      order.paymentStatus = success ? 'odendi' : 'basarisiz';
      await orderStore.saveOrders(orders);
      if (success && order.customerId) {
        const currentSettings = await settings.loadSettings();
        const earned = Math.floor(order.total / currentSettings.pointsPerTL);
        if (earned > 0) await customerAuth.addPoints(order.customerId, earned);
        if (order.monthlyTierApplied) await monthlyTiers.claimTier(order.customerId, order.monthlyTierApplied);
      }
      if (success) orderNotify.notifyNewOrder(order);
    }
  } catch (err) {
    console.error('Paynet callback sipariş güncelleme hatası:', err.message);
  }

  if (!chargeResult.ok) {
    return res.redirect(`/payment-result.html?status=fail&orderId=${pending.orderId}&message=${encodeURIComponent(chargeResult.error)}`);
  }
  res.redirect(`/payment-result.html?status=success&orderId=${pending.orderId}`);
});

// Sipariş oluştur + Multinet 3D ödeme başlat
router.post('/multinet/init', customerAuth.attachCustomerIfPresent, async (req, res) => {
  const { items, customerName, phone, deliveryType, address, orderIntensity, orderExtraShot, orderNote, useMonthlyTier } = req.body;

  if (!items || !items.length || !customerName || !phone || !deliveryType) {
    return res.status(400).json({ error: 'Eksik sipariş bilgisi' });
  }

  const customerId = req.customer ? req.customer.id : null;
  const { subtotal, discountAmount, discountBreakdown, total: itemsTotal, appliedTier } = await calculateDiscount(
    items,
    !!(req.customer && req.customer.isStaff),
    { customerId, useMonthlyTier }
  );
  const currentSettings = await settings.loadSettings();
  const extraShotSurcharge = orderExtraShot ? (currentSettings.extraShotPrice || 0) : 0;
  const total = Math.round((itemsTotal + extraShotSurcharge) * 100) / 100;

  const order = await orderStore.createOrder({ items, customerName, phone, deliveryType, address, total, orderIntensity, orderExtraShot, orderNote, paymentMethod: 'multinet' });
  order.customerId = customerId;
  if (discountAmount > 0) {
    order.staffDiscountBreakdown = discountBreakdown;
    order.subtotalBeforeDiscount = subtotal;
  }
  if (appliedTier) order.monthlyTierApplied = appliedTier.threshold;

  const requestId = crypto.randomUUID();
  order.multinetRequestId = requestId;

  {
    const orders = await orderStore.loadOrders();
    const idx = orders.findIndex((o) => o.id === order.id);
    if (idx !== -1) { orders[idx] = order; await orderStore.saveOrders(orders); }
  }

  try {
    const htmlContent = await multinet.build3DPaymentForm({
      amount: total,
      transferClientRequestRefNo: order.id,
      requestId,
      responseSuccessUrl: `${SITE_BASE_URL}/api/payment/multinet/callback?orderId=${order.id}&status=success`,
      responseErrorUrl: `${SITE_BASE_URL}/api/payment/multinet/callback?orderId=${order.id}&status=fail`,
    });
    res.json({ orderId: order.id, htmlContent });
  } catch (err) {
    res.status(400).json({ error: err.message, orderId: order.id });
  }
});

// Multinet'in 3D ödeme sonrası tarayıcıyı yönlendirdiği geri dönüş adresi
router.get('/multinet/callback', async (req, res) => {
  const { orderId, status, transferServerRefNo, responseSign, requestId, resultMessage } = req.query;
  const hasError = req.query.hasError === 'True' || status === 'fail';

  try {
    const orders = await orderStore.loadOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) {
      return res.redirect(`/payment-result.html?status=fail&message=${encodeURIComponent('Sipariş bulunamadı')}`);
    }

    const creds = await require('../utils/integrations').getProviderCredentials('multinet');
    const signValid = !hasError && multinet.verifyResponseSign({
      saltKey: creds.saltKey,
      transferServerRefNo,
      requestId: requestId || order.multinetRequestId,
      responseSign,
    });

    const success = !hasError && signValid;
    order.orderStatus = success ? 'yeni' : 'iptal';
    order.paymentStatus = success ? 'odendi' : 'basarisiz';
    await orderStore.saveOrders(orders);

    if (success) {
      if (order.customerId) {
        const currentSettings = await settings.loadSettings();
        const earned = Math.floor(order.total / currentSettings.pointsPerTL);
        if (earned > 0) await customerAuth.addPoints(order.customerId, earned);
        if (order.monthlyTierApplied) await monthlyTiers.claimTier(order.customerId, order.monthlyTierApplied);
      }
      orderNotify.notifyNewOrder(order);
    }

    const msg = success ? '' : (resultMessage || (hasError ? 'Ödeme başarısız veya iptal edildi' : 'İmza doğrulanamadı'));
    res.redirect(`/payment-result.html?status=${success ? 'success' : 'fail'}&orderId=${orderId}&message=${encodeURIComponent(msg)}`);
  } catch (err) {
    res.redirect(`/payment-result.html?status=fail&message=${encodeURIComponent('Bağlantı hatası')}`);
  }
});

// Pluxee ödemesi — 3D yönlendirmesi yok, müşteri telefon + Pluxee uygulamasından aldığı
// OTP kodunu doğrudan sitede girer, ödeme senkron olarak burada tamamlanır.
router.post('/pluxee/init', customerAuth.attachCustomerIfPresent, async (req, res) => {
  const { items, customerName, phone, deliveryType, address, orderIntensity, orderExtraShot, orderNote, useMonthlyTier, pluxeeGsm, pluxeeOtp } = req.body;

  if (!items || !items.length || !customerName || !phone || !deliveryType) {
    return res.status(400).json({ error: 'Eksik sipariş bilgisi' });
  }
  if (!pluxeeGsm || !pluxeeOtp) {
    return res.status(400).json({ error: 'Pluxee telefon numarası ve kodu gerekli' });
  }

  const customerId = req.customer ? req.customer.id : null;
  const { subtotal, discountAmount, discountBreakdown, total: itemsTotal, appliedTier } = await calculateDiscount(
    items,
    !!(req.customer && req.customer.isStaff),
    { customerId, useMonthlyTier }
  );
  const currentSettings = await settings.loadSettings();
  const extraShotSurcharge = orderExtraShot ? (currentSettings.extraShotPrice || 0) : 0;
  const total = Math.round((itemsTotal + extraShotSurcharge) * 100) / 100;

  const order = await orderStore.createOrder({ items, customerName, phone, deliveryType, address, total, orderIntensity, orderExtraShot, orderNote, paymentMethod: 'pluxee' });
  order.customerId = customerId;
  if (discountAmount > 0) {
    order.staffDiscountBreakdown = discountBreakdown;
    order.subtotalBeforeDiscount = subtotal;
  }

  try {
    const result = await pluxee.makePayment({
      gsm: pluxeeGsm,
      otp: pluxeeOtp,
      amount: total,
      externalRrn: order.id,
      externalInfo: 'Brokers Coffee',
    });

    const orders = await orderStore.loadOrders();
    const idx = orders.findIndex((o) => o.id === order.id);

    if (!result.success) {
      if (idx !== -1) { orders[idx].orderStatus = 'iptal'; orders[idx].paymentStatus = 'basarisiz'; await orderStore.saveOrders(orders); }
      return res.status(400).json({ error: result.resultMessage || 'Pluxee ödemesi başarısız' });
    }

    order.paymentStatus = 'odendi';
    order.pluxeeRrn = result.rrn;
    if (idx !== -1) { orders[idx] = order; await orderStore.saveOrders(orders); }

    if (customerId) {
      const earned = Math.floor(total / currentSettings.pointsPerTL);
      if (earned > 0) await customerAuth.addPoints(customerId, earned);
      if (appliedTier) await monthlyTiers.claimTier(customerId, appliedTier.threshold);
    }
    orderNotify.notifyNewOrder(order);

    res.json({ id: order.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
