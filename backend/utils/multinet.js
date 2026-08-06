// Multinet 3D Secure ödeme entegrasyonu.
// Gerçek akış (Multinet'in bize ilettiği bilgilere göre, resmi dokümanı tamamlıyor):
//   1) RegisterService/Login  -> appToken + email + şifre ile giriş yapılır, bir UserToken alınır
//   2) UserToken, 3D ödeme isteğinde "authorizationToken" alanı olarak kullanılır
//   3) Sepet -> build3DPaymentForm() ile imzalı bir form üretilir -> tarayıcı bu formu
//      Multinet'in 3D sayfasına post eder -> müşteri orada kartını onaylar -> Multinet,
//      responseSuccessUrl/responseErrorUrl adresimize sonucu redirect eder -> verifyResponseSign()
//      ile doğrulanır.
//   4) İade/iptal için OnlinePaymentService -> RollbackWithSign / GetValidTransactionInfo
const https = require('https');
const crypto = require('crypto');
const integrations = require('./integrations');

const LOGIN_URL_TEST = 'https://test-posvent-rest.inventiv.services/RegisterService/Login';
const LOGIN_URL_LIVE = 'https://posvent-rest.inventiv.services/RegisterService/Login'; // canlıya geçerken Multinet ile teyit edilmeli

const PAYMENT_URL_TEST = 'https://test-multiwebpos.multinet.com.tr/ThreeDPayment/ThreeDPayment'; // dokümanın "Test Sistemi Adresi" ile örnek kodu farklı adresler veriyordu, bu ikincisi denendi
const PAYMENT_URL_LIVE = 'https://multiwebpos.multinet.com.tr/ThreeDPayment/ThreeDPayment'; // canlıya geçerken Multinet ile teyit edilmeli

const ONLINE_SERVICE_URL_TEST = 'https://test-posvent-rest.inventiv.services/OnlinePaymentService';
const ONLINE_SERVICE_URL_LIVE = 'https://posvent-rest.inventiv.services/OnlinePaymentService'; // canlıya geçerken Multinet ile teyit edilmeli

// UserToken'ı her ödemede yeniden istemek yerine kısa süre bellekte tutuyoruz (aynı sunucu süreci içinde)
let cachedUserToken = null;
let cachedUserTokenAt = 0;
const TOKEN_CACHE_MS = 10 * 60 * 1000; // 10 dakika

function formatMerchantId(id) {
  const digits = String(id || '').replace(/\D/g, '');
  return digits.padStart(6, '0');
}

// Tutarı Multinet'in beklediği "kuruşsuz birleşik + TRY" formatına çevirir (150.00 -> "15000TRY")
function formatAmount(tl) {
  const kurus = Math.round(Number(tl) * 100);
  return `${kurus}TRY`;
}

function sha256Base64(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('base64');
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: 15000, // 15 saniye — Multinet'e bağlanılamıyorsa sonsuza kadar beklemeyelim
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch (e) {}
          resolve({ statusCode: res.statusCode, raw, json: parsed });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error(`Multinet sunucusuna bağlanılamadı (zaman aşımı): ${u.hostname}`));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// RegisterService/Login ile giriş yapıp bir UserToken alır.
async function login(creds, { force } = {}) {
  if (!force && cachedUserToken && Date.now() - cachedUserTokenAt < TOKEN_CACHE_MS) {
    return cachedUserToken;
  }
  const url = creds.environment === 'live' ? LOGIN_URL_LIVE : LOGIN_URL_TEST;
  const res = await postJson(url, {
    AppToken: creds.appToken,
    Email: creds.email,
    Password: creds.posword,
  });

  const body = res.json || {};
  const result = body.Result || body.result || body;
  const token = result.UserToken || result.userToken || result.Token || result.token;

  if (!token) {
    throw new Error(
      `Multinet girişi başarısız veya token bulunamadı (HTTP ${res.statusCode}). Sunucu yanıtı: ${res.raw.slice(0, 300)}`
    );
  }
  cachedUserToken = token;
  cachedUserTokenAt = Date.now();
  return token;
}

// Request imzası: saltKey + merchantId + terminalId + transferClientRefNo + [amount+productId...] + requestId
function buildRequestSign({ saltKey, merchantId, terminalId, transferClientRequestRefNo, transactionDetails, requestId }) {
  const itemsPart = transactionDetails.map((t) => `${t.amount}${t.merchantProductId}`).join('');
  const raw = `${saltKey}${merchantId}${terminalId}${transferClientRequestRefNo}${itemsPart}${requestId}`;
  return sha256Base64(raw);
}

// Response imzası: saltKey + transferServerRefNo + requestId
function buildResponseSign({ saltKey, transferServerRefNo, requestId }) {
  const raw = `${saltKey}${transferServerRefNo}${requestId}`;
  return sha256Base64(raw);
}

function verifyResponseSign({ saltKey, transferServerRefNo, requestId, responseSign }) {
  if (!responseSign) return false;
  const expected = buildResponseSign({ saltKey, transferServerRefNo, requestId });
  const decoded = decodeURIComponent(responseSign);
  return expected === decoded;
}

function requireCreds(creds) {
  if (!creds || !creds.enabled) throw new Error('Multinet entegrasyonu aktif değil');
  if (!creds.appToken || !creds.email || !creds.posword) {
    throw new Error('Multinet giriş bilgileri eksik (AppToken / E-posta / Şifre)');
  }
  if (!creds.merchantId || !creds.terminalId || !creds.saltKey) {
    throw new Error('Multinet bilgileri eksik (Üye İşyeri No / Terminal No / Salt Key)');
  }
  if (!creds.defaultProductId) {
    throw new Error('Multinet Ürün Kodu (merchantProductId) girilmemiş');
  }
}

// Sepeti Multinet'in 3D sayfasına yönlendirecek otomatik-post HTML formunu üretir.
async function build3DPaymentForm({ amount, transferClientRequestRefNo, requestId, responseSuccessUrl, responseErrorUrl }) {
  const creds = await integrations.getProviderCredentials('multinet');
  requireCreds(creds);

  const userToken = await login(creds);
  const merchantId = formatMerchantId(creds.merchantId);
  const terminalId = creds.terminalId;
  const transactionDetails = [{ amount: formatAmount(amount), merchantProductId: Number(creds.defaultProductId) }];

  const sign = buildRequestSign({
    saltKey: creds.saltKey,
    merchantId,
    terminalId,
    transferClientRequestRefNo,
    transactionDetails,
    requestId,
  });

  const targetUrl = creds.environment === 'live' ? PAYMENT_URL_LIVE : PAYMENT_URL_TEST;

  const fields = {
    authorizationToken: userToken,
    requestId,
    sign,
    responseSuccessUrl,
    responseErrorUrl,
    merchantId,
    terminalId,
    transferClientRequestRefNo,
    'transactionDetails[0][MerchantProductId]': transactionDetails[0].merchantProductId,
    'transactionDetails[0][Amount]': transactionDetails[0].amount,
  };

  const inputsHtml = Object.keys(fields)
    .map((key) => `<input type="hidden" name="${key}" value="${String(fields[key]).replace(/"/g, '&quot;')}"/>`)
    .join('\n');

  return `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>Ödemeye yönlendiriliyorsunuz...</title></head>
    <body onload="document.forms[0].submit()">
      <p>Multinet ödeme sayfasına yönlendiriliyorsunuz, lütfen bekleyin...</p>
      <form method="POST" action="${targetUrl}">
        ${inputsHtml}
      </form>
    </body></html>
  `;
}

// İade/iptal — OnlinePaymentService/RollbackWithSign
async function rollbackTransaction({ transferServerRefNo, requestId }) {
  const creds = await integrations.getProviderCredentials('multinet');
  requireCreds(creds);
  const userToken = await login(creds);
  const sign = buildResponseSign({ saltKey: creds.saltKey, transferServerRefNo, requestId });
  const url = (creds.environment === 'live' ? ONLINE_SERVICE_URL_LIVE : ONLINE_SERVICE_URL_TEST) + '/RollbackWithSign';
  const res = await postJson(url, {
    authorizationToken: userToken,
    transferServerRefNo,
    requestId,
    sign,
  });
  if (res.statusCode !== 200) {
    throw new Error(`İade başarısız (HTTP ${res.statusCode}): ${res.raw.slice(0, 300)}`);
  }
  return res.json || { raw: res.raw };
}

// İşlem durumu sorgulama — OnlinePaymentService/GetValidTransactionInfo
async function getValidTransactionInfo({ transferServerRefNo, requestId }) {
  const creds = await integrations.getProviderCredentials('multinet');
  requireCreds(creds);
  const userToken = await login(creds);
  const sign = buildResponseSign({ saltKey: creds.saltKey, transferServerRefNo, requestId });
  const url = (creds.environment === 'live' ? ONLINE_SERVICE_URL_LIVE : ONLINE_SERVICE_URL_TEST) + '/GetValidTransactionInfo';
  const res = await postJson(url, {
    authorizationToken: userToken,
    transferServerRefNo,
    requestId,
    sign,
  });
  return res.json || { raw: res.raw };
}

// Bilgilerin doğru olup olmadığını gerçekten Multinet'e giriş yaparak test eder.
async function testConnection() {
  const creds = await integrations.getProviderCredentials('multinet');
  requireCreds(creds);
  const userToken = await login(creds, { force: true });
  return `Giriş başarılı, UserToken alındı (${creds.environment === 'live' ? 'CANLI' : 'TEST'} ortam). Ödeme testi için siteden bir sipariş deneyebilirsin.`;
}

module.exports = {
  formatMerchantId,
  formatAmount,
  buildRequestSign,
  buildResponseSign,
  verifyResponseSign,
  build3DPaymentForm,
  rollbackTransaction,
  getValidTransactionInfo,
  testConnection,
};
