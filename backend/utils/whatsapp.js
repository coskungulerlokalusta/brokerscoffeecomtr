// WhatsApp Business Cloud API (Meta) üzerinden mesaj gönderimi
// NOT: Meta kuralları gereği, işletme tarafından başlatılan İLK mesaj (müşteri/personel
// size daha önce hiç yazmadıysa) onaylı bir "template" mesaj olmalıdır. Bu fonksiyon
// serbest metin gönderir — bu yalnızca son 24 saat içinde karşı taraf size yazdıysa
// çalışır. Soğuk/ilk temas için Meta'dan template onayı almanız gerekir.
const https = require('https');
const integrations = require('./integrations');

function sendTextMessage(phone, message) {
  return new Promise((resolve, reject) => {
    const creds = integrations.getProviderCredentials('whatsapp');
    if (!creds || !creds.enabled) {
      return reject(new Error('WhatsApp entegrasyonu aktif değil'));
    }
    if (!creds.phoneNumberId || !creds.accessToken) {
      return reject(new Error('WhatsApp bilgileri eksik (Telefon Numarası ID / Access Token)'));
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

module.exports = { sendTextMessage };
