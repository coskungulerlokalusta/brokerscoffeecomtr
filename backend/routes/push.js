const express = require('express');
const router = express.Router();
const pushNotifications = require('../utils/pushNotifications');
const customerAuth = require('../utils/customerAuth');

router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: pushNotifications.VAPID_PUBLIC });
});

router.post('/subscribe', customerAuth.attachCustomerIfPresent, async (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Geçersiz abonelik bilgisi' });
  }
  await pushNotifications.addSubscription(subscription, req.customer ? req.customer.id : null);
  res.status(201).json({ ok: true });
});

router.post('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Endpoint gerekli' });
  await pushNotifications.removeSubscription(endpoint);
  res.json({ ok: true });
});

module.exports = router;
