const express = require('express');
const router = express.Router();
const rewardStore = require('../utils/rewardStore');
const redemptionStore = require('../utils/redemptionStore');
const customerAuth = require('../utils/customerAuth');

// Aktif ödül kataloğunu getir (herkese açık)
router.get('/', (req, res) => {
  const rewards = rewardStore.loadRewards().filter((r) => r.active);
  res.json(rewards);
});

// Puan harca / ödül kullan (giriş gerektirir)
router.post('/:id/redeem', customerAuth.requireAuth, (req, res) => {
  const reward = rewardStore.loadRewards().find((r) => r.id === req.params.id && r.active);
  if (!reward) return res.status(404).json({ error: 'Ödül bulunamadı' });

  const updatedCustomer = customerAuth.deductPoints(req.customer.id, reward.pointsCost);
  if (!updatedCustomer) return res.status(400).json({ error: 'Yetersiz puan' });

  const redemption = redemptionStore.createRedemption({
    customerId: req.customer.id,
    customerName: req.customer.name,
    rewardTitle: reward.title,
    pointsCost: reward.pointsCost,
  });
  res.status(201).json({ code: redemption.code, remainingPoints: updatedCustomer.loyaltyPoints });
});

module.exports = router;
