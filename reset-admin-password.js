// Tek seferlik admin şifre sıfırlama betiği.
// Kullanım (SSH ile sunucuya bağlanıp proje klasöründe):
//   node reset-admin-password.js
// Çalıştırdıktan sonra bu dosyayı SİL — içinde şifre bilgisi olmasa da
// güvenlik için sunucuda bırakılmamalı.
const adminAuth = require('./backend/utils/adminAuth');

const USERNAME = 'coskun';
const NEW_PASSWORD = 'Brokers2026!';

(async () => {
  try {
    await adminAuth.setUserPassword(USERNAME, NEW_PASSWORD);
    console.log('✅ Şifre sıfırlandı.');
    console.log('Kullanıcı adı:', USERNAME);
    console.log('Yeni şifre:', NEW_PASSWORD);
    console.log('\nŞimdi bu dosyayı SİL: rm reset-admin-password.js');
    process.exit(0);
  } catch (err) {
    console.error('❌ Hata:', err.message);
    process.exit(1);
  }
})();
