const express = require('express');
const router = express.Router();
const paynet = require('../utils/paynet');
const orderStore = require('../utils/orderStore');
const customerAuth = require('../utils/customerAuth');
const settings = require('../utils/settings');
const orderNotify = require('../utils/orderNotify');
const monthlyTiers = require('../utils/monthlyTiers');
const multinet = require('../utils/multinet');
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

// Sipariş oluştur + 3D ödeme başlat
router.post('/init', customerAuth.attachCustomerIfPresent, async (req, res) => {
  const { items, customerName, phone, deliveryType, address, cardHolder, pan, month, year, cvc, orderIntensity, orderExtraShot, orderNote, useMonthlyTier } = req.body;

  if (!items || !items.length || !customerName || !phone || !deliveryType) {
    return res.status(400).json({ error: 'Eksik sipariş bilgisi' });
  }
  if (!cardHolder || !pan || !month || !year || !cvc) {
    return res.status(400).json({ error: 'Eksik kart bilgisi' });
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

  try {
    const result = await paynet.initiateTdsPayment({
      amount: total,
      referenceNo: order.id,
      returnUrl: `${SITE_BASE_URL}/api/payment/callback?orderId=${order.id}`,
      domain: SITE_DOMAIN,
      cardHolder,
      pan,
      month,
      year,
      cvc,
      description: `Brokers Coffee Sipariş #${order.id.slice(0, 8)}`,
    });

    if (result.code !== 0) {
      return res.status(402).json({ error: result.message || 'Ödeme başlatılamadı', orderId: order.id });
    }

    res.json({
      orderId: order.id,
      postUrl: result.post_url,
      htmlContent: result.html_content,
    });
  } catch (err) {
    res.status(500).json({ error: 'Paynet bağlantı hatası: ' + err.message, orderId: order.id });
  }
});

// Bankanın 3D doğrulama sonrası post ettiği geri dönüş adresi
router.post('/callback', async (req, res) => {
  const { session_id, token_id } = req.body;
  const orderId = req.query.orderId;

  try {
    const result = await paynet.completeTdsPayment({ sessionId: session_id, tokenId: token_id });
    const success = result.is_succeed === true;
    if (orderId) {
      const orders = await orderStore.loadOrders();
      const order = orders.find((o) => o.id === orderId);
      if (order) {
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
    }
    res.redirect(`/payment-result.html?status=${success ? 'success' : 'fail'}&orderId=${orderId || ''}&message=${encodeURIComponent(result.message || '')}`);
  } catch (err) {
    res.redirect(`/payment-result.html?status=fail&orderId=${orderId || ''}&message=${encodeURIComponent('Bağlantı hatası')}`);
  }
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

module.exports = router;
