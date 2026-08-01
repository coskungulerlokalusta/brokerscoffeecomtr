// WhatsApp Business Cloud API (Meta) üzerinden mesaj gönderimi
// NOT: Meta kuralları gereği, işletme tarafından başlatılan İLK mesaj (müşteri/personel
// size daha önce hiç yazmadıysa) onaylı bir "template" mesaj olmalıdır. Bu fonksiyon
// serbest metin gönderir — bu yalnızca son 24 saat içinde karşı taraf size yazdıysa
// çalışır. Soğuk/ilk temas için Meta'dan template onayı almanız gerekir.
const https = require('https');
const integrations = require('./integrations');

async function sendTextMessage(phone, message) {
  const creds = await integrations.getProviderCredentials('whatsapp');
  if (!creds || !creds.enabled) {
    throw new Error('WhatsApp entegrasyonu aktif değil');
  }
  if (!creds.phoneNumberId || !creds.accessToken) {
    throw new Error('WhatsApp bilgileri eksik (Telefon Numarası ID / Access Token)');
  }

  let to = phone.replace(/\D/g, '');
  if (to.startsWith('0')) to = '90' + to.slice(1);
  if (!to.startsWith('90')) to = '90' + to;

  const body = JSON.stringify({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: message },
  });

  const options = {
    hostname: 'graph.facebook.com',
    path: `/v19.0/${creds.phoneNumberId}/messages`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + creds.accessToken,
      'Content-Length': Buffer.byteLength(body),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        const data = JSON.parse(raw || '{}');
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(data.error ? data.error.message : 'WhatsApp gönderim hatası'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Kimlik bilgilerini test eder — telefon numarası bilgisini sorgular, mesaj göndermez
async function testConnection() {
  const creds = await integrations.getProviderCredentials('whatsapp');
  if (!creds || !creds.phoneNumberId || !creds.accessToken) {
    throw new Error('Telefon Numarası ID / Access Token eksik');
  }
  const options = {
    hostname: 'graph.facebook.com',
    path: `/v19.0/${creds.phoneNumberId}?fields=display_phone_number,verified_name`,
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + creds.accessToken },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        const data = JSON.parse(raw || '{}');
        if (res.statusCode === 200) {
          resolve(`Bağlantı başarılı: ${data.verified_name || ''} (${data.display_phone_number || ''})`);
        } else {
          reject(new Error(data.error ? data.error.message : 'Bağlantı başarısız'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = { sendTextMessage, testConnection };
