import admin from 'firebase-admin';
import pool from './db.js';

// Firebase, ortam değişkeninde (FIREBASE_SERVICE_ACCOUNT) JSON olarak
// saklanan bir "servis hesabı" anahtarıyla başlatılıyor — Firebase Console'dan
// (Project Settings → Service Accounts → Generate new private key) indirilen
// dosyanın İÇERİĞİ, tek satır JSON olarak Hostinger'a env değişkeni olarak
// eklenmeli. Anahtar yoksa (henüz kurulmadıysa) bildirimler sessizce atlanır
// — sistemin geri kalanı bundan etkilenmez.
let firebaseReady = false;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    firebaseReady = true;
  }
} catch (e) {
  console.error('Firebase başlatılamadı (FIREBASE_SERVICE_ACCOUNT kontrol edin):', e.message);
}

// Bir kullanıcının cihaz jetonunu kaydeder — uygulama açıldığında/giriş
// yapıldığında çağrılır. Aynı jeton varsa günceller (tekrar eklemez).
export async function registerPushToken(tenantId, userId, app, token) {
  await pool.query(
    `INSERT INTO push_tokens (tenant_id, user_id, app, token) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE tenant_id = VALUES(tenant_id), user_id = VALUES(user_id), app = VALUES(app)`,
    [tenantId, userId || null, app, token]
  );
}

// Bir işletmedeki (istenirse belirli bir uygulamaya kayıtlı) tüm cihazlara
// bildirim gönderir. Firebase kurulmadıysa (henüz yapılandırılmadıysa)
// sessizce hiçbir şey yapmaz — hata fırlatmaz, ana işlemi bozmaz.
export async function sendPushToTenant(tenantId, { title, body, app, data } = {}) {
  if (!firebaseReady) return { sent: 0, reason: 'Firebase henüz yapılandırılmadı' };
  let sql = 'SELECT token FROM push_tokens WHERE tenant_id = ?';
  const params = [tenantId];
  if (app) { sql += ' AND app = ?'; params.push(app); }
  const [rows] = await pool.query(sql, params);
  if (rows.length === 0) return { sent: 0 };
  const tokens = rows.map(r => r.token);
  try {
    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: data || {},
    });
    // Artık geçersiz (uygulama silinmiş/çıkış yapılmış) jetonları temizle
    const invalidTokens = [];
    res.responses.forEach((r, i) => { if (!r.success) invalidTokens.push(tokens[i]); });
    if (invalidTokens.length > 0) {
      await pool.query('DELETE FROM push_tokens WHERE token IN (?)', [invalidTokens]);
    }
    return { sent: res.successCount };
  } catch (e) {
    console.error('Push bildirimi gönderilemedi:', e.message);
    return { sent: 0, error: e.message };
  }
}

// Süper admin cihaz jetonu kaydı — normal işletme jetonlarından ayrı tabloda
export async function registerAdminPushToken(adminId, token) {
  await pool.query(
    `INSERT INTO admin_push_tokens (admin_id, token) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE admin_id = VALUES(admin_id)`,
    [adminId, token]
  );
}

// Tüm süper adminlere bildirim gönderir — yeni işletme kaydı, ödeme sorunu,
// kritik sistem hatası gibi durumlarda kullanılır.
export async function sendPushToAdmins({ title, body, data } = {}) {
  if (!firebaseReady) return { sent: 0, reason: 'Firebase henüz yapılandırılmadı' };
  const [rows] = await pool.query('SELECT token FROM admin_push_tokens');
  if (rows.length === 0) return { sent: 0 };
  const tokens = rows.map(r => r.token);
  try {
    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: data || {},
    });
    const invalidTokens = [];
    res.responses.forEach((r, i) => { if (!r.success) invalidTokens.push(tokens[i]); });
    if (invalidTokens.length > 0) {
      await pool.query('DELETE FROM admin_push_tokens WHERE token IN (?)', [invalidTokens]);
    }
    return { sent: res.successCount };
  } catch (e) {
    console.error('Admin push bildirimi gönderilemedi:', e.message);
    return { sent: 0, error: e.message };
  }
}
