const express = require('express');
const router = express.Router();
const orderStore = require('../utils/orderStore');

// Yeni sipariş oluştur (müşteri tarafı - sepet/ödeme sayfası kullanacak)
router.post('/', async (req, res) => {
  const { items, customerName, phone, deliveryType, address, total } = req.body;
  if (!items || !items.length || !customerName || !phone || !deliveryType || !total) {
    return res.status(400).json({ error: 'Eksik sipariş bilgisi' });
  }
  const order = await orderStore.createOrder({ items, customerName, phone, deliveryType, address, total });
  res.status(201).json(order);
});

module.exports = router;
