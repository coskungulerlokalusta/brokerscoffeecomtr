const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SETTINGS_FILE = path.join(__dirname, '..', '..', 'data', 'settings.json');

const DEFAULTS = {
  staffDiscountPercent: 20,
  staffBannerText: 'Personel indirimi: Aldığınız ürünler %{percent} indirimli.',
  staffSignupCode: crypto.randomBytes(4).toString('hex').toUpperCase(),
  pointsPerTL: 10, // Her X TL harcamada 1 puan kazanılır
};

function loadSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) {
    saveSettings(DEFAULTS);
    return DEFAULTS;
  }
  const stored = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  return { ...DEFAULTS, ...stored };
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

function updateSettings(partial) {
  const current = loadSettings();
  const updated = { ...current, ...partial };
  saveSettings(updated);
  return updated;
}

module.exports = { loadSettings, saveSettings, updateSettings };
