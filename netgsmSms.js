import pool from './db.js';

// Netgsm'in resmi, basit REST (GET tabanlı) SMS gönderim uç noktası —
// dönen cevap "00" ile başlıyorsa başarılı demektir (Netgsm'in standart
// hata kod formatı budur).
const NETGSM_URL = 'https://api.netgsm.com.tr/sms/send/get';

async function getNetgsmConfig() {
  const [[row]] = await pool.query('SELECT netgsm_username, netgsm_password, netgsm_header FROM platform_settings WHERE id = 1');
  if (!row || !row.netgsm_username || !row.netgsm_password || !row.netgsm_header) return null;
  return row;
}

export async function isSmsConfigured() {
  return !!(await getNetgsmConfig());
}

// Telefon numarasını Netgsm'in beklediği formata (başında 0 olmadan, sadece
// rakamlar, 10 haneli) çeviriyor — kullanıcı "0532 123 45 67" veya
// "+90 532 123 45 67" gibi farklı biçimlerde girmiş olabilir.
function normalizePhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.startsWith('90') && digits.length === 12) return digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) return digits.slice(1);
  return digits;
}

export async function sendSms(phone, message) {
  const config = await getNetgsmConfig();
  if (!config) return { ok: false, error: 'SMS sistemi henüz yapılandırılmadı.' };
  const gsmNo = normalizePhone(phone);
  if (gsmNo.length !== 10) return { ok: false, error: 'Geçersiz telefon numarası.' };

  const params = new URLSearchParams({
    usercode: config.netgsm_username,
    password: config.netgsm_password,
    gsmno: gsmNo,
    message,
    msgheader: config.netgsm_header,
    filter: '0',
  });

  try {
    const res = await fetch(`${NETGSM_URL}?${params.toString()}`);
    const text = (await res.text()).trim();
    if (text.startsWith('00') || text.startsWith('01')) return { ok: true, jobId: text.split(' ')[1] || null };
    return { ok: false, error: `Netgsm hata kodu: ${text}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
