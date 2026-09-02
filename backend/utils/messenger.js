// Facebook Messenger Send API (Meta Graph API üzerinden)
const https = require('https');
const integrations = require('./integrations');

async function sendMessage(psid, text) {
  const creds = await integrations.getProviderCredentials('messenger');
  if (!creds || !creds.enabled) {
    throw new Error('Messenger entegrasyonu aktif değil');
  }
  if (!creds.pageAccessToken) {
    throw new Error('Messenger bilgileri eksik (Sayfa Erişim Anahtarı)');
  }

  const body = JSON.stringify({
    recipient: { id: psid },
    message: { text },
  });

  const options = {
    hostname: 'graph.facebook.com',
    path: `/v21.0/me/messages?access_token=${encodeURIComponent(creds.pageAccessToken.trim())}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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
          reject(new Error(data.error ? data.error.message : 'Messenger gönderim hatası'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Kimlik bilgilerini test eder — sayfa bilgisini sorgular, mesaj göndermez
async function testConnection() {
  const creds = await integrations.getProviderCredentials('messenger');
  if (!creds || !creds.pageAccessToken) {
    throw new Error('Sayfa Erişim Anahtarı eksik');
  }
  const options = {
    hostname: 'graph.facebook.com',
    path: `/v21.0/me?fields=name&access_token=${encodeURIComponent(creds.pageAccessToken.trim())}`,
    method: 'GET',
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        const data = JSON.parse(raw || '{}');
        if (res.statusCode === 200) {
          resolve(`Bağlantı başarılı: ${data.name || ''}`);
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
