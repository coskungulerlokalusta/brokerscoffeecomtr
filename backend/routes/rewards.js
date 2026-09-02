const express = require('express');
const router = express.Router();
const rewardStore = require('../utils/rewardStore');
const redemptionStore = require('../utils/redemptionStore');
const customerAuth = require('../utils/customerAuth');

router.get('/', customerAuth.attachCustomerIfPresent, async (req, res) => {
  const isStaff = !!(req.customer && req.customer.isStaff);
  const audience = isStaff ? 'staff' : 'customer';
  const rewards = (await rewardStore.loadRewards()).filter(
    (r) => r.active && (!r.targetAudience || r.targetAudience === 'both' || r.targetAudience === audience)
  );
  res.json(rewards);
});

router.post('/:id/redeem', customerAuth.requireAuth, async (req, res) => {
  const rewards = await rewardStore.loadRewards();
  const reward = rewards.find((r) => r.id === req.params.id && r.active);
  if (!reward) return res.status(404).json({ error: 'Ödül bulunamadı' });

  const updatedCustomer = await customerAuth.deductPoints(req.customer.id, reward.pointsCost);
  if (!updatedCustomer) return res.status(400).json({ error: 'Yetersiz puan' });

  const redemption = await redemptionStore.createRedemption({
    customerId: req.customer.id,
    customerName: req.customer.name,
    rewardTitle: reward.title,
    pointsCost: reward.pointsCost,
  });
  res.status(201).json({ code: redemption.code, remainingPoints: updatedCustomer.loyaltyPoints });
});

module.exports = router;
