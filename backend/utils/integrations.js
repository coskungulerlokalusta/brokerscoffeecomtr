const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'data', 'integrations.json');

const DEFAULTS = {
  iyzico: { enabled: false, apiKey: '', secretKey: '', environment: 'sandbox' },
  whatsapp: { enabled: false, phoneNumberId: '', accessToken: '', verifyToken: '' },
  multinet: { enabled: false, merchantId: '', apiKey: '' },
  pluxee: { enabled: false, merchantId: '', apiKey: '' },
  ticket: { enabled: false, merchantId: '', apiKey: '' },
  metropol: { enabled: false, merchantId: '', apiKey: '' },
};

const SECRET_FIELDS = {
  iyzico: ['apiKey', 'secretKey'],
  whatsapp: ['accessToken', 'verifyToken'],
  multinet: ['apiKey'],
  pluxee: ['apiKey'],
  ticket: ['apiKey'],
  metropol: ['apiKey'],
};

function load() {
  if (!fs.existsSync(FILE)) {
    save(DEFAULTS);
    return DEFAULTS;
  }
  const stored = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  const merged = {};
  Object.keys(DEFAULTS).forEach((provider) => {
    merged[provider] = { ...DEFAULTS[provider], ...(stored[provider] || {}) };
  });
  return merged;
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function mask(value) {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return '••••' + value.slice(-4);
}

// Admin panelde göstermek için: gerçek değerleri değil, maskelenmiş halini döner
function loadMasked() {
  const data = load();
  const masked = {};
  Object.keys(data).forEach((provider) => {
    masked[provider] = { ...data[provider] };
    (SECRET_FIELDS[provider] || []).forEach((field) => {
      masked[provider][field] = mask(data[provider][field]);
      masked[provider][field + 'Set'] = !!data[provider][field];
    });
  });
  return masked;
}

// Güncelleme: boş/maskeli gönderilen alanlar mevcut değeri korur, sadece yeni girilenler değişir
function updateProvider(provider, updates) {
  const data = load();
  if (!data[provider]) throw new Error('Bilinmeyen entegrasyon: ' + provider);
  const secretFields = SECRET_FIELDS[provider] || [];
  Object.keys(updates).forEach((key) => {
    if (secretFields.includes(key)) {
      // Maskeli/boş değer geldiyse mevcut secret'ı koru
      if (updates[key] && !updates[key].startsWith('••••')) {
        data[provider][key] = updates[key];
      }
    } else {
      data[provider][key] = updates[key];
    }
  });
  save(data);
  return data[provider];
}

// Gerçek (maskelenmemiş) değerleri sadece sunucu içi kullanım için döner — asla API response'ta göndermeyin
function getProviderCredentials(provider) {
  return load()[provider];
}

module.exports = { load, loadMasked, updateProvider, getProviderCredentials };
