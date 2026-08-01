// Kampanya duyuru mesajı taslağı oluşturmak için Claude API kullanır
const https = require('https');
const integrations = require('./integrations');

async function callClaude(prompt) {
  const creds = await integrations.getProviderCredentials('anthropic');
  if (!creds || !creds.enabled || !creds.apiKey) {
    throw new Error('AI Asistan entegrasyonu aktif değil (Anthropic API key eksik)');
  }

  const body = JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': creds.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          if (data.content && data.content[0]) {
            resolve(data.content[0].text);
          } else {
            reject(new Error(data.error ? data.error.message : 'Beklenmeyen yanıt'));
          }
        } catch (e) {
          reject(new Error('AI yanıtı okunamadı'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Kampanya bilgisinden personele gidecek doğal, sıcak bir duyuru metni oluşturur
function draftStaffCampaignMessage(campaign) {
  const prompt = `Bir kahve dükkanının (Brokers Coffee) yöneticisi personeline WhatsApp'tan kısa, sıcak, samimi bir kampanya duyurusu göndermek istiyor. Aşağıdaki kampanya bilgisine göre, 2-3 cümlelik, doğal ve enerjik ama abartısız bir duyuru mesajı yaz. Sadece mesaj metnini yaz, başka açıklama ekleme.

Kampanya adı: ${campaign.title}
Açıklama: ${campaign.description || 'yok'}
Detay: ${campaign.type === 'percentage' ? campaign.value + '% indirim' : campaign.description}`;

  return callClaude(prompt);
}

// Kimlik bilgilerini test eder — minik bir istek gönderir
function testConnection() {
  return callClaude('Sadece "ok" yaz, başka hiçbir şey yazma.');
}

// Genel amaçlı mesaj taslağı — kampanya dışı, serbest bağlamlı duyurular için
async function draftGenericMessage(context) {
  const prompt = `Bir kahve dükkanının (Brokers Coffee) yöneticisi müşterilerine/personeline WhatsApp'tan kısa, sıcak, samimi bir mesaj göndermek istiyor. Aşağıdaki bağlama göre 2-3 cümlelik doğal bir mesaj yaz. Sadece mesaj metnini yaz, başka açıklama ekleme.

Bağlam: ${context}`;
  return callClaude(prompt);
}

module.exports = { draftStaffCampaignMessage, draftGenericMessage, testConnection };
