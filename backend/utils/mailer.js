// E-posta gönderimi (Resend). Anahtar Entegrasyonlar sayfasından ya da RESEND_API_KEY ortam değişkeninden gelir.
// Anahtar yoksa e-posta gönderilmez; son 50 e-posta bellekte tutulur (deneme ve geliştirme için).
const integrations = require('./integrations');

const DEFAULT_FROM = 'Brokers Coffee <bildirim@brokerscoffee.com.tr>';
const outbox = [];

async function getConfig() {
  const c = await integrations.getProviderCredentials('resend');
  return { apiKey: c.apiKey || '', from: (c.from || '').trim() || DEFAULT_FROM, ready: !!c.apiKey };
}

// m: { to, subject, text, html, headers } — gönderildiyse true döner
async function sendMail(m) {
  const cfg = await getConfig();
  if (!cfg.ready) {
    outbox.push(m); if (outbox.length > 50) outbox.shift();
    return false;
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: cfg.from, to: [m.to], subject: m.subject, text: m.text, html: m.html, ...(m.headers ? { headers: m.headers } : {}) }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error('E-posta gönderilemedi:', r.status, body.slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error('E-posta gönderilemedi:', err.message);
    return false;
  }
}

// Entegrasyonlar sayfasındaki "Bağlantıyı test et" düğmesi: anahtarın geçerliliğini kontrol eder
async function testConnection() {
  const cfg = await getConfig();
  if (!cfg.apiKey) throw new Error('Resend API anahtarı girilmemiş');
  const r = await fetch('https://api.resend.com/domains', { headers: { authorization: `Bearer ${cfg.apiKey}` } });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) {
    // yalnızca gönderim yetkili anahtar alan adlarını listeleyemez; bu durumda anahtar yine de geçerli olabilir
    if (d && /restricted/i.test(d.message || '')) return 'Anahtar kabul edildi (yalnızca gönderim yetkili anahtar).';
    throw new Error('Resend anahtarı reddedildi: ' + (d.message || r.status));
  }
  if (!r.ok) throw new Error('Resend yanıt vermedi: ' + (d.message || r.status));
  const domains = (d.data || []).map((x) => `${x.name} (${x.status === 'verified' ? 'doğrulandı' : 'doğrulanmadı'})`);
  return domains.length ? 'Bağlantı başarılı. Alan adları: ' + domains.join(', ') : 'Bağlantı başarılı, ancak Resend\'de henüz alan adı eklenmemiş.';
}

module.exports = { sendMail, getConfig, testConnection, outbox, DEFAULT_FROM };
