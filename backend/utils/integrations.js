const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'data', 'integrations.json');

const DEFAULTS = {
  iyzico: { enabled: false, apiKey: '', secretKey: '', environment: 'sandbox' },
  whatsapp: { enabled: false, phoneNumberId: '', accessToken: '', verifyToken: '' },
  netgsm: { enabled: false, username: '', password: '', header: '' },
  anthropic: { enabled: false, apiKey: '' },
  multinet: { enabled: false, merchantId: '', apiKey: '' },
  pluxee: { enabled: false, merchantId: '', apiKey: '' },
  ticket: { enabled: false, merchantId: '', apiKey: '' },
  metropol: { enabled: false, merchantId: '', apiKey: '' },
};

const SECRET_FIELDS = {
  iyzico: ['apiKey', 'secretKey'],
  whatsapp: ['accessToken', 'verifyToken'],
  netgsm: ['password'],
  anthropic: ['apiKey'],
  multinet: ['apiKey'],
  pluxee: ['apiKey'],
  ticket: ['apiKey'],
  metropol: ['apiKey'],
};

// Ortam değişkeni (environment variable) eşlemesi — Hostinger panelinden girilenler
// hiçbir zaman silinmez (dosya tabanlı depolamanın aksine, deploy'lardan etkilenmez).
// Bir alan için ortam değişkeni tanımlıysa, panel/dosya değerinin ÖNÜNE geçer.
const ENV_MAP = {
  iyzico: { apiKey: 'IYZICO_API_KEY', secretKey: 'IYZICO_SECRET_KEY' },
  whatsapp: { phoneNumberId: 'WHATSAPP_PHONE_NUMBER_ID', accessToken: 'WHATSAPP_ACCESS_TOKEN', verifyToken: 'WHATSAPP_VERIFY_TOKEN' },
  netgsm: { username: 'NETGSM_USERNAME', password: 'NETGSM_PASSWORD', header: 'NETGSM_HEADER' },
  anthropic: { apiKey: 'ANTHROPIC_API_KEY' },
  multinet: { merchantId: 'MULTINET_MERCHANT_ID', apiKey: 'MULTINET_API_KEY' },
  pluxee: { merchantId: 'PLUXEE_MERCHANT_ID', apiKey: 'PLUXEE_API_KEY' },
  ticket: { merchantId: 'TICKET_MERCHANT_ID', apiKey: 'TICKET_API_KEY' },
  metropol: { merchantId: 'METROPOL_MERCHANT_ID', apiKey: 'METROPOL_API_KEY' },
};

function applyEnvOverrides(provider, config) {
  const map = ENV_MAP[provider] || {};
  const result = { ...config };
  let anyEnvSet = false;
  Object.keys(map).forEach((field) => {
    const envVal = process.env[map[field]];
    if (envVal) {
      result[field] = envVal;
      anyEnvSet = true;
    }
  });
  // Bir sağlayıcı için ortam değişkeni tanımlıysa, panelde ayrıca "Aktif" işaretlenmese bile aktif say
  if (anyEnvSet) result.enabled = true;
  return result;
}

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
    const withEnv = applyEnvOverrides(provider, data[provider]);
    masked[provider] = { ...withEnv };
    (SECRET_FIELDS[provider] || []).forEach((field) => {
      masked[provider][field] = mask(withEnv[field]);
      masked[provider][field + 'Set'] = !!withEnv[field];
    });
    // Ortam değişkeninden gelen alanları işaretle (panelde "salt okunur" göstermek için)
    const envMap = ENV_MAP[provider] || {};
    masked[provider].envFields = Object.keys(envMap).filter((f) => !!process.env[envMap[f]]);
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
  return applyEnvOverrides(provider, load()[provider]);
}

module.exports = { load, loadMasked, updateProvider, getProviderCredentials };
