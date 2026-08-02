const kv = require('./kvStore');

const KEY = 'integrations';

const DEFAULTS = {
  iyzico: { enabled: false, apiKey: '', secretKey: '', environment: 'sandbox' },
  whatsapp: { enabled: false, phoneNumberId: '', accessToken: '', verifyToken: '' },
  netgsm: { enabled: false, username: '', password: '', header: '' },
  anthropic: { enabled: false, apiKey: '' },
  instagram: { enabled: false, igBusinessAccountId: '', accessToken: '', verifyToken: '' },
  messenger: { enabled: false, pageAccessToken: '', verifyToken: '' },
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
  instagram: ['accessToken', 'verifyToken'],
  messenger: ['pageAccessToken', 'verifyToken'],
  multinet: ['apiKey'],
  pluxee: ['apiKey'],
  ticket: ['apiKey'],
  metropol: ['apiKey'],
};

// Ortam değişkeni eşlemesi — tanımlıysa panel/DB değerinin önüne geçer, deploy'lardan etkilenmez
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
  if (anyEnvSet) result.enabled = true;
  return result;
}

async function load() {
  const stored = (await kv.getJSON(KEY, null)) || {};
  const merged = {};
  Object.keys(DEFAULTS).forEach((provider) => {
    merged[provider] = { ...DEFAULTS[provider], ...(stored[provider] || {}) };
  });
  return merged;
}

async function save(data) {
  return kv.setJSON(KEY, data);
}

function mask(value) {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return '••••' + value.slice(-4);
}

async function loadMasked() {
  const data = await load();
  const masked = {};
  Object.keys(data).forEach((provider) => {
    const withEnv = applyEnvOverrides(provider, data[provider]);
    masked[provider] = { ...withEnv };
    (SECRET_FIELDS[provider] || []).forEach((field) => {
      masked[provider][field] = mask(withEnv[field]);
      masked[provider][field + 'Set'] = !!withEnv[field];
    });
    const envMap = ENV_MAP[provider] || {};
    masked[provider].envFields = Object.keys(envMap).filter((f) => !!process.env[envMap[f]]);
  });
  return masked;
}

async function updateProvider(provider, updates) {
  const data = await load();
  if (!data[provider]) throw new Error('Bilinmeyen entegrasyon: ' + provider);
  const secretFields = SECRET_FIELDS[provider] || [];
  Object.keys(updates).forEach((key) => {
    let value = updates[key];
    if (typeof value === 'string') value = value.trim(); // kopyala-yapıştırdan gelen görünmez boşluk/satır sonu karakterlerini temizle
    if (secretFields.includes(key)) {
      if (value && !value.startsWith('••••')) {
        data[provider][key] = value;
      }
    } else {
      data[provider][key] = value;
    }
  });
  await save(data);
  return data[provider];
}

async function getProviderCredentials(provider) {
  const data = await load();
  return applyEnvOverrides(provider, data[provider]);
}

module.exports = { load, loadMasked, updateProvider, getProviderCredentials };
