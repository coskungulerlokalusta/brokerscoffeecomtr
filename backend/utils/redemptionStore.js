const crypto = require('crypto');
const kv = require('./kvStore');

const KEY = 'redemptions';

async function loadRedemptions() {
  return kv.getJSON(KEY, []);
}

async function saveRedemptions(redemptions) {
  return kv.setJSON(KEY, redemptions);
}

async function createRedemption({ customerId, customerName, rewardTitle, pointsCost }) {
  const redemptions = await loadRedemptions();
  const redemption = {
    id: crypto.randomUUID(),
    code: crypto.randomBytes(3).toString('hex').toUpperCase(),
    customerId,
    customerName,
    rewardTitle,
    pointsCost,
    fulfilled: false,
    createdAt: new Date().toISOString(),
  };
  redemptions.unshift(redemption);
  await saveRedemptions(redemptions);
  return redemption;
}

async function markFulfilled(id) {
  const redemptions = await loadRedemptions();
  const r = redemptions.find((x) => x.id === id);
  if (!r) return null;
  r.fulfilled = true;
  await saveRedemptions(redemptions);
  return r;
}

module.exports = { loadRedemptions, saveRedemptions, createRedemption, markFulfilled };
