const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', '..', 'data', 'redemptions.json');

function loadRedemptions() {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
}

function saveRedemptions(redemptions) {
  fs.writeFileSync(FILE, JSON.stringify(redemptions, null, 2), 'utf-8');
}

function createRedemption({ customerId, customerName, rewardTitle, pointsCost }) {
  const redemptions = loadRedemptions();
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
  saveRedemptions(redemptions);
  return redemption;
}

function markFulfilled(id) {
  const redemptions = loadRedemptions();
  const r = redemptions.find((x) => x.id === id);
  if (!r) return null;
  r.fulfilled = true;
  saveRedemptions(redemptions);
  return r;
}

module.exports = { loadRedemptions, saveRedemptions, createRedemption, markFulfilled };
