// Paynet ödeme entegrasyonu — "Hazır Form" (Paynet.js widget) akışı.
// Not: Paynet 1 Ocak 2026'da iyzico'ya birleşti ama kendi ödeme widget'ı hâlâ
// çalışıyor, klasik iyzico API'sinden tamamen farklı bir sistem.
//
// Akış: checkout -> createCheckoutToken() ile güvenli bir token üretilir (istemciden
// gelen tutar/sipariş bilgisine ASLA güvenilmez) -> müşteri Paynet'in kendi widget'ında
// kart bilgilerini girer -> Paynet, session_id+token_id ile callback'imizi çağırır ->
// consumeCheckoutToken() + chargeTransaction() ile ödeme sunucu tarafında onaylanır.
const https = require('https');
const integrations = require('./integrations');

const LIVE_BASE = 'https://api.paynet.com.tr';
const TEST_BASE = 'https://pts-api.paynet.com.tr';

function baseUrlFor(environment) {
  return environment === 'live' ? LIVE_BASE : TEST_BASE;
}

function postJson(baseUrl, path, secretKey, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'Accept': 'application/json; charset=UTF-8',
          // Paynet'in kendine has kimlik doğrulaması: standart base64 Basic Auth DEĞİL,
          // secret key doğrudan "Basic " önekiyle yazılıyor.
          'Authorization': 'Basic ' + secretKey,
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 15000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch (e) {}
          resolve({ statusCode: res.statusCode, raw, json });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Paynet sunucusuna bağlanılamadı (zaman aşımı)')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getConfig() {
  const creds = await integrations.getProviderCredentials('paynet');
  if (!creds || !creds.enabled || !creds.secretKey) return null;
  return creds;
}

async function isConfigured() {
  return !!(await getConfig());
}

async function getPublishableKey() {
  const config = await getConfig();
  return config ? config.publishableKey || null : null;
}

// Bağlantı testi — var olmayan bir işlem sorgulanır, gerçek işlem yaratmaz.
// 401/403 dönmüyorsa Secret Key doğru demektir.
async function testConnection() {
  const config = await getConfig();
  if (!config) throw new Error('Paynet bilgileri eksik (Secret Key girilmemiş / aktif değil)');

  const res = await postJson(baseUrlFor(config.environment), '/v1/transaction/check', config.secretKey, {
    reference_no: 'baglanti-testi-' + Date.now(),
  });

  if (res.statusCode === 401 || res.statusCode === 403) {
    throw new Error('Secret Key geçersiz (yetkisiz).');
  }
  if (res.raw.includes('<html')) {
    throw new Error("Paynet API adresine ulaşılamadı — hesap iyzico'ya taşınmış olabilir, güncel adresi teyit et.");
  }
  return `Bağlantı doğrulandı (${config.environment === 'live' ? 'CANLI' : 'TEST'} ortam).`;
}

// Güvenli checkout token sistemi — istemciden gelen sipariş/tutar bilgisine
// asla güvenilmez, ödeme başlarken sunucu hafızasında tahmin edilemez bir
// token üretilir, gerçek sipariş/tutar sadece bu token üzerinden eşleştirilir.
const pendingCheckouts = new Map();
const CHECKOUT_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 dakika

function createCheckoutToken(data) {
  const token = 'ck_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
  pendingCheckouts.set(token, { ...data, expiresAt: Date.now() + CHECKOUT_TOKEN_TTL_MS });
  return token;
}

function consumeCheckoutToken(token) {
  const data = pendingCheckouts.get(token);
  if (!data) return null;
  pendingCheckouts.delete(token); // tek kullanımlık
  if (data.expiresAt < Date.now()) return null;
  return data;
}

setInterval(() => {
  const now = Date.now();
  for (const [token, data] of pendingCheckouts) {
    if (data.expiresAt < now) pendingCheckouts.delete(token);
  }
}, 5 * 60 * 1000);

// Ödeme onaylama — Paynet.js widget'ının POST ettiği session_id + token_id ile.
async function chargeTransaction({ sessionId, tokenId, referenceNo, amount }) {
  const config = await getConfig();
  if (!config) return { ok: false, error: 'Paynet henüz yapılandırılmadı.' };

  try {
    const res = await postJson(baseUrlFor(config.environment), '/v1/transaction/charge', config.secretKey, {
      session_id: sessionId,
      token_id: tokenId,
      reference_no: referenceNo || ('siparis-' + Date.now()),
      transaction_type: 1,
      amount: Math.round(Number(amount) * 100), // KURUŞ cinsinden!
      add_comission_amount: false,
      no_instalment: false,
      tds_required: true,
      installments: '',
      ratio_code: '',
    });

    if (!res.json || res.json.is_succeed !== true) {
      const msg = res.json && (res.json.error_message || res.json.result_msg || res.json.message);
      return { ok: false, error: msg || 'Ödeme onaylanamadı.' };
    }
    return { ok: true, data: res.json };
  } catch (err) {
    return { ok: false, error: 'Paynet bağlantı hatası: ' + err.message };
  }
}

module.exports = {
  isConfigured,
  getPublishableKey,
  testConnection,
  createCheckoutToken,
  consumeCheckoutToken,
  chargeTransaction,
};
