import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

// Hostinger MySQL bağlantı bilgileri .env dosyasından okunur — kod içine
// asla düz yazılmaz. .env dosyası hPanel'de "Environment Variables" bölümünden
// veya proje köküne yüklenerek tanımlanır.
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  // Önceden 10'du — gerçek kullanıcı sayısı arttıkça bu, sıralarda beklemeye
  // sebep oluyordu. DB_CONNECTION_LIMIT ortam değişkeniyle (Hostinger MySQL
  // planınızın gerçek üst sınırına göre) ihtiyaç oldukça artırılabilir, kod
  // değişikliği gerekmiyor. Hostinger'ın planınıza göre gerçek üst sınırı,
  // phpMyAdmin'de "SHOW VARIABLES LIKE 'max_connections';" ile görülebilir.
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 25,
  queueLimit: 0, // sınırsız kuyruk — havuz dolarsa istek reddedilmez, sırasını bekler
});

export default pool;
