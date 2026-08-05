// Multinet 3D Secure ödeme entegrasyonu — resmi teknik dokümana göre.
// Akış: sepet -> initiate3DPayment() ile imzalı bir form üretilir -> tarayıcı bu formu
// Multinet'in 3D sayfasına post eder -> müşteri orada kartını onaylar -> Multinet,
// responseSuccessUrl/responseErrorUrl adresimize sonucu redirect eder -> verifyResponseSign()
// ile doğrulanır.
const crypto = require('crypto');
const integrations = require('./integrations');

const MULTINET_URL_TEST = 'https://test-multinet-webpos-merchant.inventiv.services/ThreeDPayment/ThreeDPayment';
const MULTINET_URL_LIVE = 'https://multiwebpos.multinet.com.tr/ThreeDPayment/ThreeDPayment';

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
  // Meta/Multinet redirect sırasında url-encode edilmiş olabilir, decode ederek karşılaştır
  const decoded = decodeURIComponent(responseSign);
  return expected === decoded;
}

// Sepeti Multinet'in 3D sayfasına yönlendirecek otomatik-post HTML formunu üretir.
async function build3DPaymentForm({ amount, transferClientRequestRefNo, requestId, responseSuccessUrl, responseErrorUrl }) {
  const creds = await integrations.getProviderCredentials('multinet');
  if (!creds || !creds.enabled) {
    throw new Error('Multinet entegrasyonu aktif değil');
  }
  if (!creds.authorizationToken || !creds.merchantId || !creds.terminalId || !creds.saltKey) {
    throw new Error('Multinet bilgileri eksik (Yetki Anahtarı / Üye İşyeri No / Terminal No / Salt Key)');
  }
  if (!creds.defaultProductId) {
    throw new Error('Multinet Ürün Kodu (merchantProductId) girilmemiş — bunu Multinet ile yaptığın sözleşmeden öğrenip panele girmen gerekiyor');
  }

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

  const targetUrl = creds.environment === 'live' ? MULTINET_URL_LIVE : MULTINET_URL_TEST;

  const fields = {
    authorizationToken: creds.authorizationToken,
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

// Multinet'in basit bir "bakiye sorgula" ucu dokümanda yok — bu yüzden gerçek bir işlem
// göndermeden, tüm alanların dolu olduğunu ve imza hesaplamasının hatasız çalıştığını doğrular.
async function testConnection() {
  const creds = await integrations.getProviderCredentials('multinet');
  if (!creds.authorizationToken || !creds.merchantId || !creds.terminalId || !creds.saltKey) {
    throw new Error('Eksik alan var: Yetki Anahtarı / Üye İşyeri No / Terminal No / Salt Key hepsi dolu olmalı');
  }
  if (!creds.defaultProductId) {
    throw new Error('Ürün Kodu (merchantProductId) girilmemiş');
  }
  const sign = buildRequestSign({
    saltKey: creds.saltKey,
    merchantId: formatMerchantId(creds.merchantId),
    terminalId: creds.terminalId,
    transferClientRequestRefNo: 'test-' + Date.now(),
    transactionDetails: [{ amount: formatAmount(1), merchantProductId: Number(creds.defaultProductId) }],
    requestId: 'test-request-id',
  });
  if (!sign) throw new Error('İmza hesaplanamadı');
  return `Bilgiler eksiksiz, imza hesaplanabiliyor (${creds.environment === 'live' ? 'CANLI' : 'TEST'} ortam). Gerçek ödeme testi için siteden bir sipariş denemen gerekir.`;
}

module.exports = { formatMerchantId, formatAmount, buildRequestSign, buildResponseSign, verifyResponseSign, build3DPaymentForm, testConnection };
