// MySQL bağlantısı — Hostinger'ın Ortam Değişkenleri panelinden gelen bilgilerle bağlanır.
// Bu, yerel JSON dosyalarının aksine her deploy'da SİLİNMEYEN kalıcı bir depodur
// (Müşterini Bul'da SQLite'ın yaşadığı "her redeploy'da silinme" sorununu çözen aynı yöntem).
const mysql = require('mysql2/promise');

let pool = null;
let initialized = false;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return pool;
}

// Basit key-value tablosu: mevcut JSON tabanlı store'ları en az değişiklikle
// MySQL'e taşımak için — her store kendi anahtarı altında JSON metni saklar.
async function ensureSchema() {
  if (initialized) return;
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS kv_store (
      store_key VARCHAR(191) PRIMARY KEY,
      value LONGTEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  initialized = true;
}

module.exports = { getPool, ensureSchema };
