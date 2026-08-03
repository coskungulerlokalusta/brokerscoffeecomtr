const express = require('express');
const router = express.Router();
const paynet = require('../utils/paynet');
const orderStore = require('../utils/orderStore');
const customerAuth = require('../utils/customerAuth');
const settings = require('../utils/settings');
const productStore = require('../utils/productStore');
const { getGroupForProduct, DEFAULT_GROUP_KEY } = require('../utils/discountGroups');

const SITE_DOMAIN = process.env.SITE_DOMAIN || 'brokerscoffee.com.tr';
const SITE_BASE_URL = process.env.SITE_BASE_URL || `https://${SITE_DOMAIN}`;

// Sepetteki ürünleri gruplarına göre indirime tabi tutar (personel değilse indirim 0)
async function calculateDiscount(items, isStaff) {
  const subtotal = items.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
  let discountAmount = 0;
  let discountBreakdown = [];

  if (isStaff) {
    const currentSettings = await settings.loadSettings();
    const allProducts = await productStore.loadProducts();
    const groupTotals = {};

    for (const item of items) {
      const product = allProducts.find((p) => p.id === item.productId);
      const lineQty = Number(item.qty);
      const linePrice = Number(item.price);

      // Bu ürün/boyut için admin'in elle girdiği özel personel fiyatı var mı?
      const matchedSize = product && product.sizes.find((s) => (s.label || '') === (item.size || ''));
      if (matchedSize && matchedSize.staffPrice !== undefined && matchedSize.staffPrice !== null && matchedSize.staffPrice !== '') {
        const staffPrice = Number(matchedSize.staffPrice);
        const amount = Math.max(0, (linePrice - staffPrice)) * lineQty;
        discountAmount += amount;
        if (amount > 0) discountBreakdown.push({ group: 'ozel', percent: null, amount: Math.round(amount * 100) / 100 });
        continue;
      }

      const group = product ? getGroupForProduct(product) : DEFAULT_GROUP_KEY;
      const lineTotal = linePrice * lineQty;
      groupTotals[group] = (groupTotals[group] || 0) + lineTotal;
    }

    Object.keys(groupTotals).forEach((group) => {
      const pct = currentSettings.staffDiscountByGroup[group] ?? 0;
      const amount = groupTotals[group] * (pct / 100);
      discountAmount += amount;
      if (amount > 0) discountBreakdown.push({ group, percent: pct, amount: Math.round(amount * 100) / 100 });
    });
  }

  const total = Math.round((subtotal - discountAmount) * 100) / 100;
  return { subtotal, discountAmount: Math.round(discountAmount * 100) / 100, discountBreakdown, total };
}

// Ödeme sayfasında canlı önizleme için — sipariş oluşturmaz, ödeme başlatmaz
router.post('/preview-discount', customerAuth.attachCustomerIfPresent, async (req, res) => {
  const { items } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: 'Sepet boş' });
  const result = await calculateDiscount(items, !!(req.customer && req.customer.isStaff));
  res.json(result);
});

// Sipariş oluştur + 3D ödeme başlat
router.post('/init', customerAuth.attachCustomerIfPresent, async (req, res) => {
  const { items, customerName, phone, deliveryType, address, cardHolder, pan, month, year, cvc } = req.body;

  if (!items || !items.length || !customerName || !phone || !deliveryType) {
    return res.status(400).json({ error: 'Eksik sipariş bilgisi' });
  }
  if (!cardHolder || !pan || !month || !year || !cvc) {
    return res.status(400).json({ error: 'Eksik kart bilgisi' });
  }

  const { subtotal, discountAmount, discountBreakdown, total } = await calculateDiscount(
    items,
    !!(req.customer && req.customer.isStaff)
  );

  const order = await orderStore.createOrder({ items, customerName, phone, deliveryType, address, total });
  order.customerId = req.customer ? req.customer.id : null;
  if (discountAmount > 0) {
    order.staffDiscountBreakdown = discountBreakdown;
    order.subtotalBeforeDiscount = subtotal;
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
        }
      }
    }
    res.redirect(`/payment-result.html?status=${success ? 'success' : 'fail'}&orderId=${orderId || ''}&message=${encodeURIComponent(result.message || '')}`);
  } catch (err) {
    res.redirect(`/payment-result.html?status=fail&orderId=${orderId || ''}&message=${encodeURIComponent('Bağlantı hatası')}`);
  }
});

module.exports = router;
