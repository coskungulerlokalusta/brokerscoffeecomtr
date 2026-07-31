const express = require('express');
const router = express.Router();
const paynet = require('../utils/paynet');
const orderStore = require('../utils/orderStore');

const SITE_DOMAIN = process.env.SITE_DOMAIN || 'brokerscoffee.com.tr';
const SITE_BASE_URL = process.env.SITE_BASE_URL || `https://${SITE_DOMAIN}`;

// Sipariş oluştur + 3D ödeme başlat
router.post('/init', async (req, res) => {
  const { items, customerName, phone, deliveryType, address, total, cardHolder, pan, month, year, cvc } = req.body;

  if (!items || !items.length || !customerName || !phone || !deliveryType || !total) {
    return res.status(400).json({ error: 'Eksik sipariş bilgisi' });
  }
  if (!cardHolder || !pan || !month || !year || !cvc) {
    return res.status(400).json({ error: 'Eksik kart bilgisi' });
  }

  const order = orderStore.createOrder({ items, customerName, phone, deliveryType, address, total });

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
      orderStore.updateOrderStatus(orderId, success ? 'yeni' : 'iptal');
      // Ödeme durumunu da işaretle
      const orders = orderStore.loadOrders();
      const order = orders.find((o) => o.id === orderId);
      if (order) {
        order.paymentStatus = success ? 'odendi' : 'basarisiz';
        orderStore.saveOrders(orders);
      }
    }
    res.redirect(`/payment-result.html?status=${success ? 'success' : 'fail'}&orderId=${orderId || ''}&message=${encodeURIComponent(result.message || '')}`);
  } catch (err) {
    res.redirect(`/payment-result.html?status=fail&orderId=${orderId || ''}&message=${encodeURIComponent('Bağlantı hatası')}`);
  }
});

module.exports = router;
