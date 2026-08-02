// Instagram Messaging API (Meta Graph API üzerinden) — DM gönderimi
// Doğrulanmış kaynak: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/
// Gerekli izin: instagram_business_manage_messages
const https = require('https');
const integrations = require('./integrations');

async function sendMessage(igsid, text) {
  const creds = await integrations.getProviderCredentials('instagram');
  if (!creds || !creds.enabled) {
    throw new Error('Instagram entegrasyonu aktif değil');
  }
  if (!creds.igBusinessAccountId || !creds.accessToken) {
    throw new Error('Instagram bilgileri eksik (Hesap ID / Access Token)');
  }

  const body = JSON.stringify({
    recipient: { id: igsid },
    message: { text },
  });

  const options = {
    hostname: 'graph.facebook.com',
    path: `/v21.0/${encodeURIComponent(creds.igBusinessAccountId.trim())}/messages`,
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
          reject(new Error(data.error ? data.error.message : 'Instagram gönderim hatası'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Kimlik bilgilerini test eder — hesap bilgisini sorgular, mesaj göndermez
async function testConnection() {
  const creds = await integrations.getProviderCredentials('instagram');
  if (!creds || !creds.igBusinessAccountId || !creds.accessToken) {
    throw new Error('Hesap ID / Access Token eksik');
  }
  const options = {
    hostname: 'graph.facebook.com',
    path: `/v21.0/${encodeURIComponent(creds.igBusinessAccountId.trim())}?fields=username,name`,
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
          resolve(`Bağlantı başarılı: @${data.username || data.name || ''}`);
        } else {
          reject(new Error(data.error ? data.error.message : 'Bağlantı başarısız'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = { sendMessage, testConnection };
