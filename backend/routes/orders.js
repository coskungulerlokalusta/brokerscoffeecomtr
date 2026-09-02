const express = require('express');
const router = express.Router();
const orderStore = require('../utils/orderStore');
const customerAuth = require('../utils/customerAuth');
const settings = require('../utils/settings');
const orderNotify = require('../utils/orderNotify');
const monthlyTiers = require('../utils/monthlyTiers');
const { calculateDiscount } = require('../utils/discountCalc');

// Yeni sipariş oluştur — "Mağazada Öde" akışı için (kart bilgisi gerekmez, ödeme alınmış gibi hazırlanır)
router.post('/', customerAuth.attachCustomerIfPresent, async (req, res) => {
  const { items, customerName, phone, deliveryType, address, orderIntensity, orderExtraShot, orderNote, useMonthlyTier } = req.body;
  if (!items || !items.length || !customerName || !phone || !deliveryType) {
    return res.status(400).json({ error: 'Eksik sipariş bilgisi' });
  }

  const isStaff = !!(req.customer && req.customer.isStaff);
  const customerId = req.customer ? req.customer.id : null;
  const { total: itemsTotal, discountAmount, discountBreakdown, subtotal, appliedTier } = await calculateDiscount(
    items, isStaff, { customerId, useMonthlyTier }
  );
  const currentSettings = await settings.loadSettings();
  const extraShotSurcharge = orderExtraShot ? (currentSettings.extraShotPrice || 0) : 0;
  const deliveryFee = settings.calculateDeliveryFee(itemsTotal, deliveryType, currentSettings);
  const total = Math.round((itemsTotal + extraShotSurcharge + deliveryFee) * 100) / 100;

  const order = await orderStore.createOrder({
    items, customerName, phone, deliveryType, address, total, paymentMethod: 'store', orderIntensity, orderExtraShot, orderNote,
  });
  order.customerId = customerId;
  if (deliveryFee > 0) order.deliveryFee = deliveryFee;
  if (discountAmount > 0) {
    order.staffDiscountBreakdown = discountBreakdown;
    order.subtotalBeforeDiscount = subtotal;
  }

  {
    const orders = await orderStore.loadOrders();
    const idx = orders.findIndex((o) => o.id === order.id);
    if (idx !== -1) { orders[idx] = order; await orderStore.saveOrders(orders); }
  }

  if (appliedTier) {
    await monthlyTiers.claimTier(customerId, appliedTier.threshold);
  }

  orderNotify.notifyNewOrder(order);
  res.status(201).json(order);
});

module.exports = router;
