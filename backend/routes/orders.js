const express = require('express');
const router = express.Router();
const orderStore = require('../utils/orderStore');
const customerAuth = require('../utils/customerAuth');
const settings = require('../utils/settings');
const orderNotify = require('../utils/orderNotify');
const { calculateDiscount } = require('../utils/discountCalc');

// Yeni sipariş oluştur — "Mağazada Öde" akışı için (kart bilgisi gerekmez, ödeme alınmış gibi hazırlanır)
router.post('/', customerAuth.attachCustomerIfPresent, async (req, res) => {
  const { items, customerName, phone, deliveryType, address } = req.body;
  if (!items || !items.length || !customerName || !phone || !deliveryType) {
    return res.status(400).json({ error: 'Eksik sipariş bilgisi' });
  }

  const isStaff = !!(req.customer && req.customer.isStaff);
  const { total } = await calculateDiscount(items, isStaff);

  const order = await orderStore.createOrder({
    items, customerName, phone, deliveryType, address, total, paymentMethod: 'store',
  });
  order.customerId = req.customer ? req.customer.id : null;

  if (isStaff && req.customer) {
    const orders = await orderStore.loadOrders();
    const idx = orders.findIndex((o) => o.id === order.id);
    if (idx !== -1) { orders[idx].customerId = req.customer.id; await orderStore.saveOrders(orders); }
  }

  orderNotify.notifyNewOrder(order);
  res.status(201).json(order);
});

module.exports = router;
