const crypto = require('crypto');
const kv = require('./kvStore');

const KEY = 'campaigns';

async function loadCampaigns() {
  return kv.getJSON(KEY, []);
}

async function saveCampaigns(campaigns) {
  return kv.setJSON(KEY, campaigns);
}

async function createCampaign({ title, description, type, value, startDate, endDate }) {
  const campaigns = await loadCampaigns();
  const campaign = {
    id: crypto.randomUUID(),
    title,
    description: description || '',
    type: type || 'percentage',
    value: Number(value) || 0,
    active: true,
    startDate: startDate || null,
    endDate: endDate || null,
    staffNotifiedAt: null,
    createdAt: new Date().toISOString(),
  };
  campaigns.unshift(campaign);
  await saveCampaigns(campaigns);
  return campaign;
}

async function updateCampaign(id, updates) {
  const campaigns = await loadCampaigns();
  const campaign = campaigns.find((c) => c.id === id);
  if (!campaign) return null;
  Object.assign(campaign, updates);
  await saveCampaigns(campaigns);
  return campaign;
}

async function deleteCampaign(id) {
  const campaigns = await loadCampaigns();
  const idx = campaigns.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  campaigns.splice(idx, 1);
  await saveCampaigns(campaigns);
  return true;
}

module.exports = { loadCampaigns, saveCampaigns, createCampaign, updateCampaign, deleteCampaign };
