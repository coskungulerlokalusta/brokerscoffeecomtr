const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', '..', 'data', 'campaigns.json');

function loadCampaigns() {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
}

function saveCampaigns(campaigns) {
  fs.writeFileSync(FILE, JSON.stringify(campaigns, null, 2), 'utf-8');
}

function createCampaign({ title, description, type, value, startDate, endDate }) {
  const campaigns = loadCampaigns();
  const campaign = {
    id: crypto.randomUUID(),
    title,
    description: description || '',
    type: type || 'percentage', // 'percentage' | 'fixed_price_second_item' | 'other'
    value: Number(value) || 0,
    active: true,
    startDate: startDate || null,
    endDate: endDate || null,
    staffNotifiedAt: null,
    createdAt: new Date().toISOString(),
  };
  campaigns.unshift(campaign);
  saveCampaigns(campaigns);
  return campaign;
}

function updateCampaign(id, updates) {
  const campaigns = loadCampaigns();
  const campaign = campaigns.find((c) => c.id === id);
  if (!campaign) return null;
  Object.assign(campaign, updates);
  saveCampaigns(campaigns);
  return campaign;
}

function deleteCampaign(id) {
  const campaigns = loadCampaigns();
  const idx = campaigns.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  campaigns.splice(idx, 1);
  saveCampaigns(campaigns);
  return true;
}

module.exports = { loadCampaigns, saveCampaigns, createCampaign, updateCampaign, deleteCampaign };
