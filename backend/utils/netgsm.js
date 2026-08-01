// NetGSM SMS API entegrasyonu (OTP gönderimi için)
// Genel gönderim endpoint'i - hesabınızda ayrı bir "OTP SMS" paketi/başlığı varsa
// NetGSM destek ekibinden tam OTP endpoint'ini teyit edin, gerekirse burayı güncelleyin.
const https = require('https');
const integrations = require('./integrations');

function sendSms(phone, message) {
  return new Promise((resolve, reject) => {
    const creds = integrations.getProviderCredentials('netgsm');
    if (!creds || !creds.enabled) {
      return reject(new Error('NetGSM entegrasyonu aktif değil'));
    }
    if (!creds.username || !creds.password || !creds.header) {
      return reject(new Error('NetGSM bilgileri eksik (kullanıcı adı/şifre/başlık)'));
    }

    // Telefonu 90XXXXXXXXXX formatına çevir
    let gsmNo = phone.replace(/\D/g, '');
    if (gsmNo.startsWith('0')) gsmNo = '90' + gsmNo.slice(1);
    if (!gsmNo.startsWith('90')) gsmNo = '90' + gsmNo;

    const params = new URLSearchParams({
      usercode: creds.username,
      password: creds.password,
      gsmno: gsmNo,
      message,
      msgheader: creds.header,
      dil: 'TR',
    });

    const url = `https://api.netgsm.com.tr/sms/send/get?${params.toString()}`;

    https.get(url, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        // NetGSM başarı kodu "00" veya "01" ile başlar
        if (raw.trim().startsWith('00') || raw.trim().startsWith('01')) {
          resolve(raw.trim());
        } else {
          reject(new Error('NetGSM gönderim hatası: ' + raw.trim()));
        }
      });
    }).on('error', reject);
  });
}

module.exports = { sendSms };
