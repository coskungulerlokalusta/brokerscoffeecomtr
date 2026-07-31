// Paynet 3D ödeme entegrasyonu
// Dokümantasyon: https://doc.paynet.com.tr/oedeme-metotlari/api-entegrasyonu/3d-ile-odeme
const https = require('https');

const LIVE_BASE = 'https://api.paynet.com.tr';
const TEST_BASE = 'https://pts-api.paynet.com.tr';

function getBaseUrl() {
  return process.env.PAYNET_ENV === 'live' ? LIVE_BASE : TEST_BASE;
}

function getSecretKey() {
  const key = process.env.PAYNET_SECRET_KEY;
  if (!key) throw new Error('PAYNET_SECRET_KEY ortam değişkeni tanımlı değil');
  return key;
}

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(getBaseUrl() + path);
    const data = JSON.stringify(body);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Accept': 'application/json; charset=UTF-8',
        'Authorization': 'Basic ' + getSecretKey(),
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error('Paynet yanıtı ayrıştırılamadı: ' + raw));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// 3D ödeme başlatma — bankaların 3D doğrulama sayfasına yönlendirme bilgisini döner
function initiateTdsPayment({ amount, referenceNo, returnUrl, domain, cardHolder, pan, month, year, cvc, description }) {
  return postJson('/v2/transaction/tds_initial', {
    amount: String(amount).replace('.', ','),
    reference_no: referenceNo,
    return_url: returnUrl,
    domain,
    card_holder: cardHolder,
    pan,
    month,
    year,
    cvc,
    description,
  });
}

// 3D doğrulama sonrası ödemeyi tamamlar
function completeTdsPayment({ sessionId, tokenId }) {
  return postJson('/v2/transaction/tds_charge', {
    session_id: sessionId,
    token_id: tokenId,
  });
}

module.exports = { initiateTdsPayment, completeTdsPayment };
