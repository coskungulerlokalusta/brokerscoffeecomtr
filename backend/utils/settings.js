const crypto = require('crypto');
const kv = require('./kvStore');

const KEY = 'settings';

const DEFAULTS = {
  staffDiscountPercent: 20,
  staffBannerText: 'Personel indirimi: Aldığınız ürünler %{percent} indirimli.',
  staffSignupCode: crypto.randomBytes(4).toString('hex').toUpperCase(),
  pointsPerTL: 10,
};

async function loadSettings() {
  const stored = await kv.getJSON(KEY, null);
  if (!stored) {
    await kv.setJSON(KEY, DEFAULTS);
    return DEFAULTS;
  }
  return { ...DEFAULTS, ...stored };
}

async function saveSettings(settings) {
  return kv.setJSON(KEY, settings);
}

async function updateSettings(partial) {
  const current = await loadSettings();
  const updated = { ...current, ...partial };
  await saveSettings(updated);
  return updated;
}

module.exports = { loadSettings, saveSettings, updateSettings };
