import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { checkTrialExpiry } from '../trialCheck.js';
import { registerAdminPushToken, sendPushToAdmins } from '../pushNotify.js';

const router = express.Router();

function requireSuperAdmin(req, res, next){
  const header = req.headers.authorization;
  if(!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Giriş gerekli' });
  try{
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    if(payload.role !== 'superadmin') return res.status(403).json({ error: 'Yetkiniz yok' });
    req.adminId = payload.adminId;
    next();
  }catch(e){ return res.status(401).json({ error: 'Geçersiz oturum' }); }
}

// İlk süper admin hesabını oluşturur — sadece admins tablosu BOŞSA çalışır (güvenlik).
router.post('/bootstrap', async (req, res) => {
  try{
    const [existing] = await pool.query('SELECT id FROM admins LIMIT 1');
    if(existing.length > 0) return res.status(403).json({ error: 'Zaten bir süper admin hesabı var, bootstrap tekrar çalıştırılamaz.' });
    const { name, email, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query('INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)', [name, email, hash]);
    res.json({ ok:true, id: result.insertId });
  }catch(e){ res.status(500).json({ error:'Oluşturulamadı', detail:e.message }); }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try{
    const [admins] = await pool.query('SELECT * FROM admins WHERE email = ?', [email]);
    if(admins.length === 0) return res.status(401).json({ error:'E-posta veya şifre hatalı' });
    const admin = admins[0];
    const valid = await bcrypt.compare(password, admin.password_hash);
    if(!valid) return res.status(401).json({ error:'E-posta veya şifre hatalı' });
    const token = jwt.sign({ adminId: admin.id, role:'superadmin' }, process.env.JWT_SECRET, { expiresIn:'7d' });
    res.json({ token, admin: { id: admin.id, name: admin.name } });
  }catch(e){ res.status(500).json({ error:'Giriş hatası', detail:e.message }); }
});

// Bir şubenin POS cihazı bilgilerini süper admin görüp düzenleyebilir —
// müşteri elde etmekte zorlanırsa siz onun yerine girip düzenleyebilirsiniz
router.get('/tenants/:id/pos-config', requireSuperAdmin, async (req, res) => {
  const [[row]] = await pool.query('SELECT * FROM pos_terminal_config WHERE tenant_id = ?', [req.params.id]);
  res.json(row || { device_name:'', marka: 'INGENICO', model: 'MOVE5000F', seri_no: '', sicil_no: '', pos_sifresi: '', ip: '', port: 7500, connection_type: 'ethernet' });
});

router.put('/tenants/:id/pos-config', requireSuperAdmin, async (req, res) => {
  const { device_name, marka, model, seri_no, sicil_no, pos_sifresi, ip, port, connection_type } = req.body;
  try {
    await pool.query(
      `INSERT INTO pos_terminal_config (tenant_id, device_name, marka, model, seri_no, sicil_no, pos_sifresi, ip, port, connection_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE device_name=VALUES(device_name), marka=VALUES(marka), model=VALUES(model), seri_no=VALUES(seri_no),
         sicil_no=VALUES(sicil_no), pos_sifresi=VALUES(pos_sifresi), ip=VALUES(ip), port=VALUES(port),
         connection_type=VALUES(connection_type), updated_at=NOW()`,
      [req.params.id, device_name, marka, model, seri_no, sicil_no, pos_sifresi, ip, port || 7500, connection_type || 'ethernet']
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Kaydedilemedi', detail: e.message });
  }
});

// Bir şubenin paneline "sahibi gibi" girmenizi sağlayan geçici oturum —
// müşterinin herhangi bir ayarını (menü, personel, her şey) siz düzenleyebilirsiniz
router.post('/tenants/:id/impersonate', requireSuperAdmin, async (req, res) => {
  try {
    const [[tenantRow]] = await pool.query('SELECT * FROM tenants WHERE id = ?', [req.params.id]);
    if (!tenantRow) return res.status(404).json({ error: 'Şube bulunamadı' });
    const [[ownerRow]] = await pool.query(`SELECT * FROM users WHERE tenant_id = ? AND role = 'owner' LIMIT 1`, [req.params.id]);
    if (!ownerRow) return res.status(404).json({ error: 'Bu şubenin sahip hesabı bulunamadı' });

    const token = jwt.sign(
      { tenantId: tenantRow.id, userId: ownerRow.id, role: 'owner' },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );
    res.json({ token, tenant: tenantRow, user: { id: ownerRow.id, name: ownerRow.name, role: 'owner' } });
  } catch (e) {
    res.status(500).json({ error: 'Girilemedi', detail: e.message });
  }
});

// Tüm şubeleri, temel ciro özetiyle birlikte listeler
// ---- Markalar — birden fazla şubeyi gruplamak için ----
router.get('/brands', requireSuperAdmin, async (req, res) => {
  const [brands] = await pool.query('SELECT * FROM brands ORDER BY name');
  res.json(brands);
});

router.post('/brands', requireSuperAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Marka adı zorunlu' });
  const [result] = await pool.query('INSERT INTO brands (name) VALUES (?)', [name]);
  res.json({ id: result.insertId, name });
});

router.delete('/brands/:id', requireSuperAdmin, async (req, res) => {
  await pool.query('UPDATE tenants SET brand_id = NULL WHERE brand_id = ?', [req.params.id]);
  await pool.query('DELETE FROM brands WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// Bir şubeyi bir markaya bağla/ayır
router.patch('/tenants/:id/brand', requireSuperAdmin, async (req, res) => {
  const { brand_id } = req.body;
  await pool.query('UPDATE tenants SET brand_id = ? WHERE id = ?', [brand_id || null, req.params.id]);
  res.json({ ok: true });
});

// Bir markadaki (grup) tüm şubelere, kaynak şubedeki sahip girişini (e-posta+
// şifre) kopyalar — böylece sahip, tek bir e-posta/şifreyle tüm şubeler
// arasında panelde/Patron'da geçiş yapabilir. Sadece "owner" rolündeki
// kullanıcıyı etkiler, diğer personeli değiştirmez.
router.post('/brands/:brandId/sync-owner-login', requireSuperAdmin, async (req, res) => {
  const { sourceTenantId } = req.body;
  if (!sourceTenantId) return res.status(400).json({ error: 'sourceTenantId gerekli' });
  const [[sourceOwner]] = await pool.query(
    `SELECT email, password_hash FROM users WHERE tenant_id = ? AND role = 'owner' LIMIT 1`,
    [sourceTenantId]
  );
  if (!sourceOwner || !sourceOwner.email || !sourceOwner.password_hash) {
    return res.status(400).json({ error: 'Kaynak şubede henüz bir panel girişi (e-posta/şifre) tanımlanmamış — önce o şubenin panelinden Personel sayfasında sahibe giriş tanımlayın.' });
  }
  const [tenants] = await pool.query('SELECT id FROM tenants WHERE brand_id = ? AND id != ?', [req.params.brandId, sourceTenantId]);
  let updated = 0;
  for (const t of tenants) {
    const [[owner]] = await pool.query(`SELECT id FROM users WHERE tenant_id = ? AND role = 'owner' LIMIT 1`, [t.id]);
    if (owner) {
      await pool.query('UPDATE users SET email = ?, password_hash = ? WHERE id = ?', [sourceOwner.email, sourceOwner.password_hash, owner.id]);
      updated++;
    }
  }
  res.json({ ok: true, updated });
});

// İşletme türünü belirle — panelde hangi özelliklerin önerileceğini etkiler
router.patch('/tenants/:id/business-type', requireSuperAdmin, async (req, res) => {
  const { business_type } = req.body;
  await pool.query('UPDATE tenants SET business_type = ? WHERE id = ?', [business_type || null, req.params.id]);
  res.json({ ok: true });
});

// Süper Admin native uygulaması, açılışta cihaz jetonunu buraya kaydediyor.
router.post('/push-token', requireSuperAdmin, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token gerekli' });
  await registerAdminPushToken(req.adminId, token);
  res.json({ ok: true });
});

router.get('/tenants', requireSuperAdmin, async (req, res) => {
  try{
    const [tenants] = await pool.query('SELECT * FROM tenants');
    const withStats = await Promise.all(tenants.map(async t=>{
      await checkTrialExpiry(t);
      const [[stats]] = await pool.query(
        `SELECT COUNT(*) as order_count, COALESCE(SUM(total),0) as revenue
         FROM orders WHERE tenant_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [t.id]
      );
      return { ...t, last30_orders: stats.order_count, last30_revenue: stats.revenue };
    }));
    res.json(withStats);
  }catch(e){ res.status(500).json({ error:'Liste alınamadı', detail:e.message }); }
});

// Bir şubenin abonelik durumunu, deneme süresini ve hangi özelliklere erişebileceğini değiştirir
// Yeni bir müşteri (şube) oluşturur — sadece süper admin (Coşkun) yapabilir.
// İşletme kaydı + ilk personel/sahip hesabını (kasa PIN'i dahil) tek seferde kurar.
router.post('/tenants', requireSuperAdmin, async (req, res) => {
  const { businessName, slug, ownerName, pin, currency } = req.body;
  if (!businessName || !slug || !ownerName || !pin) {
    return res.status(400).json({ error: 'İşletme adı, şube kodu, sahip adı ve PIN zorunlu' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query('SELECT id FROM tenants WHERE slug = ?', [slug]);
    if (existing.length > 0) {
      await conn.rollback();
      return res.status(409).json({ error: 'Bu şube kodu zaten kullanılıyor, başka bir kod seçin.' });
    }
    const [tenantResult] = await conn.query(
      'INSERT INTO tenants (name, slug, currency, subscription_status) VALUES (?, ?, ?, ?)',
      [businessName, slug, currency || '₺', 'trial']
    );
    const tenantId = tenantResult.insertId;
    const [userResult] = await conn.query(
      'INSERT INTO users (tenant_id, name, role, pin) VALUES (?, ?, ?, ?)',
      [tenantId, ownerName, 'owner', pin]
    );
    await conn.commit();
    res.json({ ok: true, tenantId, slug, ownerId: userResult.insertId });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: 'Şube oluşturulamadı', detail: e.message });
  } finally {
    conn.release();
  }
});

router.patch('/tenants/:id', requireSuperAdmin, async (req, res) => {
  const { subscription_status, plan, features, trial_days, name } = req.body;
  const sets = [], values = [];
  if(name){ sets.push('name = ?'); values.push(name); }
  if(trial_days){
    sets.push('subscription_status = ?'); values.push('trial');
    sets.push('trial_ends_at = DATE_ADD(NOW(), INTERVAL ? DAY)'); values.push(Number(trial_days));
  } else if(subscription_status){
    sets.push('subscription_status = ?'); values.push(subscription_status);
    sets.push('trial_ends_at = NULL'); // manuel durum değişince deneme sayacı temizlenir
  }
  if(plan){ sets.push('plan = ?'); values.push(plan); }
  if(features){ sets.push('features = ?'); values.push(JSON.stringify(features)); }
  if(sets.length === 0) return res.json({ ok:true });
  values.push(req.params.id);
  try{
    await pool.query(`UPDATE tenants SET ${sets.join(', ')} WHERE id = ?`, values);
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ error:'Güncellenemedi', detail:e.message }); }
});

// ---- Web sitesi içerik yönetimi (CMS) ----
router.get('/content', requireSuperAdmin, async (req, res) => {
  try{
    const [rows] = await pool.query('SELECT content_key, content_value FROM site_content');
    const content = {};
    rows.forEach(r => { content[r.content_key] = r.content_value; });
    res.json(content);
  }catch(e){ res.status(500).json({ error:'İçerik alınamadı', detail:e.message }); }
});

router.put('/content', requireSuperAdmin, async (req, res) => {
  const { key, value } = req.body;
  if(!key) return res.status(400).json({ error:'Anahtar (key) gerekli' });
  try{
    await pool.query(
      'INSERT INTO site_content (content_key, content_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE content_value = ?',
      [key, value, value]
    );
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ error:'Kaydedilemedi', detail:e.message }); }
});

// ---- Blog yönetimi ----
router.get('/blog', requireSuperAdmin, async (req, res) => {
  const [posts] = await pool.query('SELECT * FROM blog_posts ORDER BY created_at DESC');
  res.json(posts);
});
router.post('/blog', requireSuperAdmin, async (req, res) => {
  const { title, slug, body, published } = req.body;
  try{
    const [result] = await pool.query(
      'INSERT INTO blog_posts (title, slug, body, published) VALUES (?, ?, ?, ?)',
      [title, slug, body, published !== false ? 1 : 0]
    );
    res.json({ id: result.insertId });
  }catch(e){ res.status(500).json({ error:'Eklenemedi', detail:e.message }); }
});
router.patch('/blog/:id', requireSuperAdmin, async (req, res) => {
  const { title, slug, body, published } = req.body;
  const sets=[], values=[];
  if(title!==undefined){ sets.push('title=?'); values.push(title); }
  if(slug!==undefined){ sets.push('slug=?'); values.push(slug); }
  if(body!==undefined){ sets.push('body=?'); values.push(body); }
  if(published!==undefined){ sets.push('published=?'); values.push(published?1:0); }
  if(sets.length===0) return res.json({ ok:true });
  values.push(req.params.id);
  await pool.query(`UPDATE blog_posts SET ${sets.join(', ')} WHERE id=?`, values);
  res.json({ ok:true });
});
router.delete('/blog/:id', requireSuperAdmin, async (req, res) => {
  await pool.query('DELETE FROM blog_posts WHERE id=?', [req.params.id]);
  res.json({ ok:true });
});

// ---- Demo talepleri (durakpos.com/demo-talep formundan gelenler) ----
router.get('/demo-requests', requireSuperAdmin, async (req, res) => {
  try{
    const [rows] = await pool.query('SELECT * FROM demo_requests ORDER BY created_at DESC');
    res.json(rows);
  }catch(e){ res.status(500).json({ error:'Liste alınamadı', detail:e.message }); }
});
router.patch('/demo-requests/:id', requireSuperAdmin, async (req, res) => {
  const { status } = req.body; // 'yeni' | 'arandı' | 'kapatıldı'
  try{
    await pool.query('UPDATE demo_requests SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ error:'Güncellenemedi', detail:e.message }); }
});

// ---- Abonelik Faturaları — Kardo'daki "Kardo Faturaları" ekranının karşılığı ----
router.get('/invoices', requireSuperAdmin, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT si.*, t.name as tenant_name FROM subscription_invoices si
     JOIN tenants t ON t.id = si.tenant_id ORDER BY si.due_date DESC`
  );
  res.json(rows);
});

router.post('/invoices', requireSuperAdmin, async (req, res) => {
  const { tenant_id, invoice_number, amount, due_date } = req.body;
  if (!tenant_id || !invoice_number || !amount || !due_date) return res.status(400).json({ error: 'Tüm alanlar zorunlu' });
  const [result] = await pool.query(
    'INSERT INTO subscription_invoices (tenant_id, invoice_number, amount, due_date) VALUES (?, ?, ?, ?)',
    [tenant_id, invoice_number, amount, due_date]
  );
  res.json({ id: result.insertId });
});

router.patch('/invoices/:id', requireSuperAdmin, async (req, res) => {
  const { paid } = req.body;
  await pool.query('UPDATE subscription_invoices SET paid = ?, paid_at = ? WHERE id = ?', [paid ? 1 : 0, paid ? new Date() : null, req.params.id]);
  res.json({ ok: true });
});

router.delete('/invoices/:id', requireSuperAdmin, async (req, res) => {
  await pool.query('DELETE FROM subscription_invoices WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// Otomatik aylık faturalama ayarı — bir kere tanımlanır, sistem her ay o gün
// geldiğinde kendisi fatura keser, elle "Yeni Fatura Oluştur"a gerek kalmaz.
router.patch('/tenants/:id/billing-plan', requireSuperAdmin, async (req, res) => {
  const { monthly_price, billing_day } = req.body;
  await pool.query(
    'UPDATE tenants SET monthly_price = ?, billing_day = ? WHERE id = ?',
    [monthly_price || null, billing_day || 1, req.params.id]
  );
  res.json({ ok: true });
});

// ---- iyzico/Paynet Ayarları — bilgiler geldiğinde buradan girilecek ----
router.get('/platform-settings', requireSuperAdmin, async (req, res) => {
  const [[row]] = await pool.query('SELECT * FROM platform_settings WHERE id = 1');
  if (!row) return res.json({ iyzico_api_key: '', iyzico_secret_key: '', iyzico_base_url: 'https://api.iyzipay.com', netgsm_username: '', netgsm_password: '', netgsm_header: '', google_service_account_email: '', google_service_account_key: '' });
  // Güvenlik: gerçek anahtarları tam göstermek yerine maskeleyelim
  res.json({
    iyzico_api_key: row.iyzico_api_key ? row.iyzico_api_key.slice(0, 6) + '••••••••' : '',
    iyzico_secret_key: row.iyzico_secret_key ? '••••••••' : '',
    iyzico_base_url: row.iyzico_base_url,
    configured: !!(row.iyzico_api_key && row.iyzico_secret_key),
    netgsm_username: row.netgsm_username || '',
    netgsm_password: row.netgsm_password ? '••••••••' : '',
    netgsm_header: row.netgsm_header || '',
    sms_configured: !!(row.netgsm_username && row.netgsm_password && row.netgsm_header),
    google_service_account_email: row.google_service_account_email || '',
    google_service_account_key: row.google_service_account_key ? '••••••••' : '',
    sheets_configured: !!(row.google_service_account_email && row.google_service_account_key),
  });
});

router.put('/platform-settings', requireSuperAdmin, async (req, res) => {
  const { iyzico_api_key, iyzico_secret_key, iyzico_base_url, netgsm_username, netgsm_password, netgsm_header, google_service_account_email, google_service_account_key } = req.body;
  await pool.query(
    `INSERT INTO platform_settings (id, iyzico_api_key, iyzico_secret_key, iyzico_base_url, netgsm_username, netgsm_password, netgsm_header, google_service_account_email, google_service_account_key)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       iyzico_api_key = IF(VALUES(iyzico_api_key) LIKE '%••••%', iyzico_api_key, VALUES(iyzico_api_key)),
       iyzico_secret_key = IF(VALUES(iyzico_secret_key) LIKE '%••••%', iyzico_secret_key, VALUES(iyzico_secret_key)),
       iyzico_base_url = VALUES(iyzico_base_url),
       netgsm_username = IF(VALUES(netgsm_username) IS NULL OR VALUES(netgsm_username) NOT LIKE '%••••%', VALUES(netgsm_username), netgsm_username),
       netgsm_password = IF(VALUES(netgsm_password) LIKE '%••••%', netgsm_password, VALUES(netgsm_password)),
       netgsm_header = VALUES(netgsm_header),
       google_service_account_email = IF(VALUES(google_service_account_email) IS NULL OR VALUES(google_service_account_email) NOT LIKE '%••••%', VALUES(google_service_account_email), google_service_account_email),
       google_service_account_key = IF(VALUES(google_service_account_key) LIKE '%••••%', google_service_account_key, VALUES(google_service_account_key)),
       updated_at = NOW()`,
    [iyzico_api_key || null, iyzico_secret_key || null, iyzico_base_url || 'https://api.iyzipay.com', netgsm_username || null, netgsm_password || null, netgsm_header || null, google_service_account_email || null, google_service_account_key || null]
  );
  res.json({ ok: true });
});

// Kaydetmeden ÖNCE, girilen iyzico bilgilerinin gerçekten geçerli olup
// olmadığını test eder — hiçbir ücret/kayıt oluşturmadan, sadece "taksit
// bilgisi sorgulama" gibi hafif bir uç noktayı deneyerek API anahtarının
// çalışıp çalışmadığını doğrular.
router.post('/platform-settings/test-iyzico', requireSuperAdmin, async (req, res) => {
  const { iyzico_api_key, iyzico_secret_key, iyzico_base_url } = req.body;
  let apiKey = iyzico_api_key, secretKey = iyzico_secret_key;
  // Maskelenmiş (••••) değer gönderildiyse, veritabanındaki gerçek değeri kullan
  if (!apiKey || apiKey.includes('••••') || !secretKey || secretKey.includes('••••')) {
    const [[row]] = await pool.query('SELECT iyzico_api_key, iyzico_secret_key FROM platform_settings WHERE id = 1');
    if (!apiKey || apiKey.includes('••••')) apiKey = row?.iyzico_api_key;
    if (!secretKey || secretKey.includes('••••')) secretKey = row?.iyzico_secret_key;
  }
  if (!apiKey || !secretKey) return res.status(400).json({ error: 'API Key ve Secret Key gerekli.' });

  try {
    const Iyzipay = (await import('iyzipay')).default;
    const client = new Iyzipay({ apiKey, secretKey, uri: iyzico_base_url || 'https://api.iyzipay.com' });
    client.installmentInfo.retrieve({ locale: Iyzipay.LOCALE.TR, conversationId: 'test-' + Date.now(), price: '1.00' }, (err, result) => {
      if (err) return res.status(400).json({ error: 'Bağlantı kurulamadı: ' + err.message });
      if (result.status !== 'success') return res.status(400).json({ error: result.errorMessage || 'API anahtarı geçersiz — lütfen bilgileri kontrol edin.' });
      res.json({ ok: true, message: 'Bağlantı başarılı! API bilgileri geçerli.' });
    });
  } catch (e) {
    res.status(500).json({ error: 'Test sırasında hata: ' + e.message });
  }
});

// ---- Süper Admin AI Asistanı — platform genelinde (tüm şubeler) analiz ----
router.post('/ai-insights', requireSuperAdmin, async (req, res) => {
  const { messages } = req.body;
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'AI asistanı henüz aktif değil — sunucuda ANTHROPIC_API_KEY tanımlı değil.' });
  }
  if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'Mesaj gerekli' });
  try {
    const [tenants] = await pool.query(
      `SELECT t.id, t.name, t.slug, t.subscription_status, t.trial_ends_at, t.created_at,
              COALESCE((SELECT SUM(total) FROM orders WHERE tenant_id=t.id AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)),0) as revenue_30d,
              COALESCE((SELECT COUNT(*) FROM orders WHERE tenant_id=t.id AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)),0) as orders_30d
       FROM tenants t`
    );
    const [invoices] = await pool.query(
      `SELECT tenant_id, COUNT(*) as total, SUM(paid=0) as unpaid FROM subscription_invoices GROUP BY tenant_id`
    );
    const unpaidByTenant = {}; invoices.forEach(i => unpaidByTenant[i.tenant_id] = i.unpaid);

    const dataSnapshot = {
      toplamSube: tenants.length,
      subeler: tenants.map(t => ({
        isletme: t.name, kod: t.slug, abonelikDurumu: t.subscription_status,
        son30GunCiro: Number(t.revenue_30d).toFixed(2), son30GunSiparis: t.orders_30d,
        odenmemisFaturaSayisi: unpaidByTenant[t.id] || 0,
        kayitTarihi: t.created_at
      }))
    };
    const systemPrompt = `Sen DurakPOS adlı bir POS SaaS platformunun sahibi için çalışan bir iş analistisin. Platform sahibine (Coşkun), tüm müşteri şubelerinin (tenants) verilerine bakarak yorum yap, öneriler sun, hangi müşterilerin risk altında olduğunu (deneme süresi bitmek üzere, ödeme gecikmiş, ciro düşüyor gibi) belirt, sorularını cevapla.

Platform verisi (JSON):
${JSON.stringify(dataSnapshot)}

Kurallar:
- Türkçe, samimi ama profesyonel konuş.
- Sayılara dayan, uydurma.
- Kısa ve net cevaplar ver, madde işaretleri kullanabilirsin.
- Risk gördüğün müşterileri (deneme bitiyor, ödeme gecikmiş, ciro düşük) proaktif olarak belirt.`;

    const cleanMessages = messages.filter(m => m && (m.role==='user'||m.role==='assistant') && typeof m.content==='string').slice(-20);
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key':process.env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model:'claude-sonnet-5', max_tokens:1200, system:systemPrompt, messages:cleanMessages })
    });
    const aiData = await aiRes.json();
    if (!aiRes.ok) return res.status(500).json({ error:'AI isteği başarısız', detail: aiData.error?.message || JSON.stringify(aiData) });
    const reply = (aiData.content || []).map(b=>b.text||'').join('').trim();
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: 'Analiz alınamadı', detail: e.message });
  }
});

export default router;
