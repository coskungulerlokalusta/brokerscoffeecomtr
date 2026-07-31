// Tek seferlik kullanım: node create-admin.js <kullanici_adi> <sifre>
const { setUserPassword } = require('./backend/utils/adminAuth');

const [, , username, password] = process.argv;
if (!username || !password) {
  console.error('Kullanım: node create-admin.js <kullanici_adi> <sifre>');
  process.exit(1);
}
setUserPassword(username, password);
console.log(`Admin kullanıcısı oluşturuldu: ${username}`);
