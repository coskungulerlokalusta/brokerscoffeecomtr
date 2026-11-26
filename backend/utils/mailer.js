// E-posta gönderimi. İki yol:
//  1) SMTP (ör. Hostinger e-posta kutusu: smtp.hostinger.com, 465, SSL) — Entegrasyonlar > E-posta (SMTP)
//  2) Resend API — Entegrasyonlar > Resend
// SMTP bilgileri girilmişse o kullanılır, yoksa Resend. İkisi de yoksa e-posta gönderilmez;
// son 50 e-posta bellekte tutulur (deneme ve geliştirme için).
const nodemailer = require('nodemailer');
const integrations = require('./integrations');

const DEFAULT_FROM = 'Brokers Coffee <bildirim@brokerscoffee.com.tr>';
const outbox = [];
// son hatanın açıklaması (panelde gösterilir)
const state = { lastError: '' };

let transport = null; let transportKey = '';
function smtpTransport(c) {
  const key = [c.host, c.port, c.user, c.password].join('|');
  if (transport && transportKey === key) return transport;
  const port = Number(c.port) || 465;
  transport = nodemailer.createTransport({
    host: c.host, port, secure: port === 465,
    auth: { user: c.user, pass: c.password },
    pool: true, maxConnections: 2, // toplu gönderimde bağlantıyı yeniden kullan
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  });
  transportKey = key;
  return transport;
}

async function getConfig() {
  const s = await integrations.getProviderCredentials('smtp');
  if (s.host && s.user && s.password) {
    // "Gönderen adı" alanına sadece ad yazılabilir (ör. "Torium AVM Brokers Coffee"): adres her zaman
    // giriş yapılan kutunun adresi olur; Hostinger başka adresten gönderime izin vermez.
    const raw = (s.from || '').trim();
    const name = (raw.includes('<') ? raw.slice(0, raw.indexOf('<')) : raw.includes('@') ? '' : raw).replace(/["<>]/g, '').trim() || 'Brokers Coffee';
    const from = { name, address: s.user };
    return { via: 'smtp', smtp: s, from, fromText: `${name} <${s.user}>`, ready: true };
  }
  const c = await integrations.getProviderCredentials('resend');
  return { via: 'resend', apiKey: c.apiKey || '', from: (c.from || '').trim() || DEFAULT_FROM, ready: !!c.apiKey };
}

// m: { to, subject, text, html, headers } — gönderildiyse true döner
async function sendMail(m) {
  const cfg = await getConfig();
  if (!cfg.ready) {
    outbox.push(m); if (outbox.length > 50) outbox.shift();
    return false;
  }
  if (cfg.via === 'smtp') {
    try {
      await smtpTransport(cfg.smtp).sendMail({ from: cfg.from, envelope: { from: cfg.smtp.user, to: m.to }, to: m.to, subject: m.subject, text: m.text, html: m.html, headers: m.headers });
      return true;
    } catch (err) {
      console.error('E-posta gönderilemedi (SMTP):', err.message);
      state.lastError = 'SMTP: ' + err.message;
      transport = null; transportKey = ''; // bir sonraki denemede bağlantı yeniden kurulsun
      return false;
    }
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
      state.lastError = `Resend ${r.status}: ${body.slice(0, 200)}`;
      return false;
    }
    return true;
  } catch (err) {
    console.error('E-posta gönderilemedi:', err.message);
    state.lastError = 'Resend: ' + err.message;
    return false;
  }
}

// Entegrasyonlar > E-posta (SMTP) "Bağlantıyı test et": sunucuya giriş yapılabiliyor mu
async function testSmtp() {
  const s = await integrations.getProviderCredentials('smtp');
  if (!s.host || !s.user || !s.password) throw new Error('SMTP sunucusu, e-posta adresi ve şifre girilmeli');
  try {
    await smtpTransport(s).verify();
  } catch (err) {
    transport = null; transportKey = '';
    throw new Error('SMTP girişi başarısız: ' + err.message);
  }
  return `Bağlantı başarılı. E-postalar ${s.user} adresinden gönderilecek.`;
}

// Entegrasyonlar sayfasındaki "Bağlantıyı test et" düğmesi: anahtarın geçerliliğini kontrol eder
async function testConnection() {
  const c = await integrations.getProviderCredentials('resend');
  if (!c.apiKey) throw new Error('Resend API anahtarı girilmemiş');
  const r = await fetch('https://api.resend.com/domains', { headers: { authorization: `Bearer ${c.apiKey}` } });
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

module.exports = { state, sendMail, getConfig, testConnection, testSmtp, outbox, DEFAULT_FROM };
