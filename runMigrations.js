import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// schema.sql'deki her satır her seferinde güvenle tekrar çalıştırılabilir (IF
// NOT EXISTS, ADD COLUMN IF NOT EXISTS vb.) şekilde yazılıyor — TEK istisna,
// ilk kurulumdaki INSERT INTO satırları (tekrar çalışırsa mükerrer kayıt
// oluştururdu), onları burada bilerek atlıyoruz.
export async function runMigrations() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaPath)) return;
  const sql = fs.readFileSync(schemaPath, 'utf-8');

  const statements = sql
    .split(';')
    .map(chunk => {
      // Her parçanın İÇİNDEKİ yorum satırlarını (--) tek tek temizliyoruz —
      // yoksa bir yorumdan hemen sonra gelen gerçek SQL komutu, o yorumla
      // aynı parça içinde kaldığı için yanlışlıkla atlanıyordu.
      return chunk.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').trim();
    })
    .filter(s => s.length > 0)
    .filter(s => !/^INSERT\s+INTO/i.test(s)); // ilk kurulum verisi — tekrar çalıştırılmaz

  let applied = 0, failed = 0;
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
      applied++;
    } catch (e) {
      // Bazı zararsız hataları ("already exists" gibi) sessizce geçiyoruz,
      // gerçek hataları logluyoruz ki fark edilsin.
      if (!/already exists|Duplicate column|Duplicate key/i.test(e.message)) {
        failed++;
        console.error('Migration satırı başarısız:', stmt.slice(0, 80) + '...', '→', e.message);
      }
    }
  }
  console.log(`Migration tamamlandı: ${applied} çalıştırıldı, ${failed} gerçek hata.`);
}
