import express from 'express';
import pool from '../db.js';
import { requireAuth, requireFeature } from '../middleware/auth.js';
import { broadcastMenuChanged } from '../sseHub.js';
import { generateImageWithGemini, buildProductImagePrompt } from '../geminiImage.js';
import { saveBase64ImageIfNeeded } from '../imageStorage.js';
import { registerPushToken } from '../pushNotify.js';
import { extractSheetId } from '../googleSheets.js';
import { aiLimiter } from '../rateLimiters.js';

const router = express.Router();
router.use(requireAuth);

// ---- Kategoriler ----
router.get('/categories', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM categories WHERE tenant_id = ?', [req.tenantId]);
  res.json(rows);
});

router.post('/categories', async (req, res) => {
  const { group_name, name } = req.body;
  const [result] = await pool.query(
    'INSERT INTO categories (tenant_id, group_name, name) VALUES (?, ?, ?)',
    [req.tenantId, group_name, name]
  );
  broadcastMenuChanged(req.tenantId);
  res.json({ id: result.insertId, group_name, name });
});

router.patch('/categories/:id', async (req, res) => {
  const { group_name, name, print_station } = req.body;
  const sets = [], values = [];
  if (group_name !== undefined) { sets.push('group_name = ?'); values.push(group_name); }
  if (name !== undefined) { sets.push('name = ?'); values.push(name); }
  if (print_station !== undefined) { sets.push('print_station = ?'); values.push(print_station || null); }
  if (sets.length === 0) return res.json({ ok: true });
  values.push(req.params.id, req.tenantId);
  await pool.query(`UPDATE categories SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, values);
  broadcastMenuChanged(req.tenantId);
  res.json({ ok: true });
});

router.delete('/categories/:id', async (req, res) => {
  await pool.query('DELETE FROM categories WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  broadcastMenuChanged(req.tenantId);
  res.json({ ok: true });
});

// ---- Ürünler (boylarıyla ve bağlı opsiyonel özellikleriyle birlikte) ----
router.get('/products', async (req, res) => {
  const [products] = await pool.query('SELECT * FROM products WHERE tenant_id = ? ORDER BY sort_order, id', [req.tenantId]);
  // Eski formatta (base64) kalmış resim varsa, kullanıcı hiç fark etmeden
  // burada otomatik R2'ye taşınır — ayrı bir "hızlandır" adımına gerek yok.
  const legacyImages = products.filter(p => p.image_url && p.image_url.startsWith('data:'));
  if (legacyImages.length > 0) {
    for (const p of legacyImages) {
      try {
        const newUrl = await saveBase64ImageIfNeeded(p.image_url);
        await pool.query('UPDATE products SET image_url = ? WHERE id = ?', [newUrl, p.id]);
        p.image_url = newUrl;
      } catch (e) { /* R2 ayarlı değilse sessizce eski haliyle bırak, sonraki istekte tekrar dener */ }
    }
  }
  const [sizes] = await pool.query(
    `SELECT ps.* FROM product_sizes ps
     JOIN products p ON p.id = ps.product_id
     WHERE p.tenant_id = ?`, [req.tenantId]
  );
  const [optLinks] = await pool.query(
    `SELECT pog.product_id, og.* FROM product_option_groups pog
     JOIN option_groups og ON og.id = pog.option_group_id
     JOIN products p ON p.id = pog.product_id
     WHERE p.tenant_id = ?`, [req.tenantId]
  );
  const withSizes = products.map(p => ({
    ...p,
    sizes: sizes.filter(s => s.product_id === p.id),
    optionGroups: optLinks.filter(o => o.product_id === p.id).map(o => ({
      id: o.id, name: o.name, required: !!o.required,
      choices: typeof o.choices === 'string' ? JSON.parse(o.choices) : o.choices
    }))
  }));
  res.json(withSizes);
});

// Barkod okutulunca ürünü bulmak için — kasa, okuyucudan gelen kodu buraya gönderir
router.get('/products/by-barcode/:code', requireFeature('market_modu'), async (req, res) => {
  const [[product]] = await pool.query(
    'SELECT * FROM products WHERE tenant_id = ? AND barcode = ? AND active = 1',
    [req.tenantId, req.params.code]
  );
  if (!product) return res.status(404).json({ error: 'Bu barkoda ait ürün bulunamadı' });
  const [sizes] = await pool.query('SELECT * FROM product_sizes WHERE product_id = ?', [product.id]);
  res.json({ ...product, sizes });
});

// Düşük stoklu ürünleri listeler — panelde/kasada uyarı göstermek için
router.get('/products/low-stock', requireFeature('market_modu'), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, name, stock_qty, low_stock_threshold, sale_type FROM products
     WHERE tenant_id = ? AND stock_qty IS NOT NULL AND low_stock_threshold IS NOT NULL
     AND stock_qty <= low_stock_threshold AND active = 1`,
    [req.tenantId]
  );
  res.json(rows);
});

// Bir ürüne hangi opsiyonel özellik şablonlarının bağlı olduğunu ayarla (komple değiştirir)
router.put('/products/:id/option-groups', async (req, res) => {
  const { optionGroupIds } = req.body; // [1,2,3]
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[prod]] = await conn.query('SELECT id FROM products WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!prod) throw new Error('Ürün bulunamadı');
    await conn.query('DELETE FROM product_option_groups WHERE product_id = ?', [req.params.id]);
    for (const gid of (optionGroupIds || [])) {
      await conn.query('INSERT INTO product_option_groups (product_id, option_group_id) VALUES (?, ?)', [req.params.id, gid]);
    }
    await conn.commit();
    broadcastMenuChanged(req.tenantId);
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: 'Kaydedilemedi', detail: e.message });
  } finally {
    conn.release();
  }
});

// ---- Opsiyonel Özellik Şablonları (Şeker Oranı, Süt Türü vb.) ----
router.get('/option-groups', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM option_groups WHERE tenant_id = ?', [req.tenantId]);
  res.json(rows.map(r => ({ ...r, choices: typeof r.choices === 'string' ? JSON.parse(r.choices) : r.choices })));
});

router.post('/option-groups', async (req, res) => {
  const { name, required, choices } = req.body;
  if (!name || !Array.isArray(choices) || choices.length === 0) return res.status(400).json({ error: 'Başlık ve en az bir seçenek zorunlu' });
  const [result] = await pool.query(
    'INSERT INTO option_groups (tenant_id, name, required, choices) VALUES (?, ?, ?, ?)',
    [req.tenantId, name, required ? 1 : 0, JSON.stringify(choices)]
  );
  res.json({ id: result.insertId });
});

router.patch('/option-groups/:id', async (req, res) => {
  const { name, required, choices } = req.body;
  const sets = [], values = [];
  if (name !== undefined) { sets.push('name = ?'); values.push(name); }
  if (required !== undefined) { sets.push('required = ?'); values.push(required ? 1 : 0); }
  if (choices !== undefined) { sets.push('choices = ?'); values.push(JSON.stringify(choices)); }
  if (sets.length === 0) return res.json({ ok: true });
  values.push(req.params.id, req.tenantId);
  await pool.query(`UPDATE option_groups SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, values);
  res.json({ ok: true });
});

router.delete('/option-groups/:id', async (req, res) => {
  await pool.query('DELETE FROM option_groups WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  res.json({ ok: true });
});

// Binlerce ürünü tek seferde içe aktarır (CSV'den ayrıştırılmış satırlar) —
// AI ile menü yüklemenin (~60 satır sınırı) aksine, bunun pratikte bir sınırı yok.
// Her satır: {group_name, category_name, name, price, barcode?, sale_type?, stock_qty?, low_stock_threshold?}
router.post('/products/bulk-import', async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'İçe aktarılacak satır bulunamadı' });
  if (rows.length > 20000) return res.status(400).json({ error: 'Tek seferde en fazla 20.000 satır işlenebilir.' });

  const conn = await pool.getConnection();
  const categoryCache = {}; // "grup||kategori" -> id, tekrar tekrar sorgu atmamak için
  let added = 0;
  const errors = [];
  try {
    await conn.beginTransaction();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2; // başlık satırı dahil, kullanıcıya gösterirken anlamlı olsun
      if (!r.name || !r.group_name || !r.category_name || r.price === undefined || r.price === null || isNaN(Number(r.price))) {
        errors.push(`Satır ${rowNum}: Ürün adı, grup, kategori ve fiyat zorunlu.`);
        continue;
      }
      const catKey = r.group_name + '||' + r.category_name;
      let categoryId = categoryCache[catKey];
      if (!categoryId) {
        const [[existingCat]] = await conn.query(
          'SELECT id FROM categories WHERE tenant_id = ? AND group_name = ? AND name = ?',
          [req.tenantId, r.group_name, r.category_name]
        );
        if (existingCat) categoryId = existingCat.id;
        else {
          const [catResult] = await conn.query(
            'INSERT INTO categories (tenant_id, group_name, name) VALUES (?, ?, ?)',
            [req.tenantId, r.group_name, r.category_name]
          );
          categoryId = catResult.insertId;
        }
        categoryCache[catKey] = categoryId;
      }
      const saleType = r.sale_type === 'kg' ? 'kg' : 'adet';
      const [prodResult] = await conn.query(
        `INSERT INTO products (tenant_id, category_id, name, vat_rate, active, barcode, sale_type, stock_qty, low_stock_threshold)
         VALUES (?, ?, ?, 10, 1, ?, ?, ?, ?)`,
        [req.tenantId, categoryId, r.name, r.barcode || null, saleType, r.stock_qty ?? null, r.low_stock_threshold ?? null]
      );
      await conn.query(
        'INSERT INTO product_sizes (product_id, label, price) VALUES (?, ?, ?)',
        [prodResult.insertId, saleType === 'kg' ? 'kg' : (r.size_label || 'Tek Boy'), Number(r.price)]
      );
      added++;
    }
    await conn.commit();
    broadcastMenuChanged(req.tenantId);
    res.json({ ok: true, added, errorCount: errors.length, errors: errors.slice(0, 50) });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: 'İçe aktarma başarısız oldu', detail: e.message });
  } finally {
    conn.release();
  }
});

// Panel/kasa'daki "✨ AI ile Oluştur" butonu — sohbet gerektirmeden doğrudan
// bir ürün adı için Gemini'den görsel üretip base64 olarak döner (kaydetmez,
// önizleme + kullanıcı onayı ön uçta yapılır).
router.post('/generate-product-image', requireFeature('ai_image_generation'), aiLimiter, async (req, res) => {
  const { productName, visualDescription } = req.body;
  if (!productName) return res.status(400).json({ error: 'Ürün adı gerekli' });
  try {
    const b64 = await generateImageWithGemini(buildProductImagePrompt(productName, visualDescription));
    res.json({ imageDataUrl: `data:image/png;base64,${b64}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/products', async (req, res) => {
  const { category_id, name, vat_rate, sizes, barcode, sale_type, stock_qty, low_stock_threshold } = req.body;
  const image_url = await saveBase64ImageIfNeeded(req.body.image_url);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO products (tenant_id, category_id, name, image_url, vat_rate, barcode, sale_type, stock_qty, low_stock_threshold)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, category_id, name, image_url || null, vat_rate ?? 10, barcode || null, sale_type || 'adet', stock_qty ?? null, low_stock_threshold ?? null]
    );
    const productId = result.insertId;
    for (const s of sizes) {
      await conn.query('INSERT INTO product_sizes (product_id, label, price) VALUES (?, ?, ?)', [productId, s.label, s.price]);
    }
    await conn.commit();
    broadcastMenuChanged(req.tenantId);
    res.json({ id: productId });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: 'Ürün eklenemedi', detail: e.message });
  } finally {
    conn.release();
  }
});

// Sürükle-bırakla yeni sıralama — [{id, sort_order}, ...] tüm listeyi tek seferde günceller
router.patch('/products/reorder', async (req, res) => {
  const { order } = req.body; // [{id, sort_order}]
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order dizisi gerekli' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const item of order) {
      await conn.query('UPDATE products SET sort_order = ? WHERE id = ? AND tenant_id = ?', [item.sort_order, item.id, req.tenantId]);
    }
    await conn.commit();
    broadcastMenuChanged(req.tenantId);
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: 'Sıralama kaydedilemedi', detail: e.message });
  } finally {
    conn.release();
  }
});

router.patch('/products/:id', async (req, res) => {
  const fields = req.body; // {name, active, vat_rate, image_url, stock, category_id, sizes, barcode, sale_type, stock_qty, low_stock_threshold}
  const allowed = ['name','active','vat_rate','image_url','stock','category_id','barcode','sale_type','stock_qty','low_stock_threshold'];
  const sets = [], values = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      const val = key === 'image_url' ? await saveBase64ImageIfNeeded(fields[key]) : fields[key];
      sets.push(`${key} = ?`); values.push(val);
    }
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (sets.length > 0) {
      values.push(req.params.id, req.tenantId);
      await conn.query(`UPDATE products SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, values);
    }
    if (Array.isArray(fields.sizes)) {
      // Ürünün bu işletmeye ait olduğunu doğrula, sonra boyutları komple değiştir
      const [[prod]] = await conn.query('SELECT id FROM products WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
      if (!prod) throw new Error('Ürün bulunamadı');
      await conn.query('DELETE FROM product_sizes WHERE product_id = ?', [req.params.id]);
      for (const s of fields.sizes) {
        await conn.query('INSERT INTO product_sizes (product_id, label, price) VALUES (?, ?, ?)', [req.params.id, s.label, s.price]);
      }
    }
    await conn.commit();
    broadcastMenuChanged(req.tenantId);
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: 'Ürün güncellenemedi', detail: e.message });
  } finally {
    conn.release();
  }
});

router.delete('/products/:id', async (req, res) => {
  await pool.query('DELETE FROM products WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  broadcastMenuChanged(req.tenantId);
  res.json({ ok: true });
});

// ---- Masalar (QR Menü için) ----
router.get('/tables', requireFeature('masa_servisi'), async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM tables WHERE tenant_id = ? ORDER BY id', [req.tenantId]);
  res.json(rows);
});

// İşletme açılış saatini ayarlar — kasadaki "Raporlar" varsayılan tarih
// aralığını buna göre hesaplar (sabit 24 saat yerine, gerçek işletme gününe göre)
router.patch('/opening-time', async (req, res) => {
  const { opening_time } = req.body; // "10:00" formatında
  if (!opening_time || !/^\d{2}:\d{2}$/.test(opening_time)) return res.status(400).json({ error: 'Geçersiz saat formatı (HH:MM bekleniyor)' });
  await pool.query('UPDATE tenants SET opening_time = ? WHERE id = ?', [opening_time + ':00', req.tenantId]);
  res.json({ ok: true });
});

// Müşteri adının ödeme öncesi zorunlu olup olmayacağı — işletmenin kendi tercihi
router.patch('/require-customer-name', async (req, res) => {
  const { require_customer_name } = req.body;
  await pool.query('UPDATE tenants SET require_customer_name = ? WHERE id = ?', [require_customer_name ? 1 : 0, req.tenantId]);
  res.json({ ok: true });
});

router.patch('/auto-print-receipt', async (req, res) => {
  const { auto_print_receipt } = req.body;
  await pool.query('UPDATE tenants SET auto_print_receipt = ? WHERE id = ?', [auto_print_receipt ? 1 : 0, req.tenantId]);
  res.json({ ok: true });
});

// Fatura/ödeme bilgileri — iyzico'nun ödeme başlatabilmesi için zorunlu
// tuttuğu bilgiler (TCKN, adres, şehir). Faturalarım sayfasında "Öde"ye
// basmadan önce bunların dolu olması gerekiyor.
router.get('/billing-info', async (req, res) => {
  const [[row]] = await pool.query('SELECT billing_tckn, billing_address, billing_city, billing_phone FROM tenants WHERE id = ?', [req.tenantId]);
  res.json(row || {});
});

router.patch('/billing-info', async (req, res) => {
  const { billing_tckn, billing_address, billing_city, billing_phone } = req.body;
  if (billing_tckn && !/^\d{11}$/.test(billing_tckn)) {
    return res.status(400).json({ error: 'TCKN 11 haneli olmalı' });
  }
  await pool.query(
    'UPDATE tenants SET billing_tckn = ?, billing_address = ?, billing_city = ?, billing_phone = ? WHERE id = ?',
    [billing_tckn || null, billing_address || null, billing_city || null, billing_phone || null, req.tenantId]
  );
  res.json({ ok: true });
});

// AI Asistan'ın kayıt tutacağı Google E-Tablosunun bağlanması — artık HER
// İŞLETME kendi servis hesabı bilgisini ve tablo linkini kendisi giriyor,
// süper panelle hiçbir ilgisi yok.
router.get('/google-sheet', async (req, res) => {
  const [[row]] = await pool.query('SELECT google_sheet_id, google_service_account_email, google_service_account_key FROM tenants WHERE id = ?', [req.tenantId]);
  res.json({
    sheetId: row?.google_sheet_id || null,
    serviceAccountEmail: row?.google_service_account_email || '',
    serviceAccountKey: row?.google_service_account_key ? '••••••••' : '',
    configured: !!(row?.google_service_account_email && row?.google_service_account_key),
  });
});

router.patch('/google-sheet', async (req, res) => {
  const { sheetUrl, serviceAccountEmail, serviceAccountKey } = req.body;
  const sheetId = extractSheetId(sheetUrl);
  const fields = ['google_sheet_id = ?'];
  const params = [sheetId || null];
  if (serviceAccountEmail !== undefined) { fields.push('google_service_account_email = ?'); params.push(serviceAccountEmail || null); }
  if (serviceAccountKey !== undefined && !serviceAccountKey.includes('••••')) { fields.push('google_service_account_key = ?'); params.push(serviceAccountKey || null); }
  params.push(req.tenantId);
  await pool.query(`UPDATE tenants SET ${fields.join(', ')} WHERE id = ?`, params);
  res.json({ ok: true, sheetId });
});

// Patron/Görevlerim native uygulamaları, açılışta kendi cihaz jetonunu
// buraya kaydediyor — bildirim gönderileceği zaman bu jetonlar kullanılıyor.
router.post('/push-token', async (req, res) => {
  const { token, app } = req.body;
  if (!token || !app) return res.status(400).json({ error: 'token ve app gerekli' });
  await registerPushToken(req.tenantId, req.userId, app, token);
  res.json({ ok: true });
});

// Personel indirimi — hangi kategoriye ne oranda indirim uygulanacağını yönetir
router.get('/staff-discounts', requireFeature('personel_indirimi'), async (req, res) => {
  const [cats] = await pool.query('SELECT id, group_name, name FROM categories WHERE tenant_id = ?', [req.tenantId]);
  const [discounts] = await pool.query('SELECT category_id, discount_percent FROM category_staff_discounts WHERE tenant_id = ?', [req.tenantId]);
  const map = {};
  discounts.forEach(d => { map[d.category_id] = Number(d.discount_percent); });
  res.json(cats.map(c => ({ id: c.id, groupName: c.group_name, name: c.name, discountPercent: map[c.id] ?? null })));
});

router.post('/staff-discounts', requireFeature('personel_indirimi'), async (req, res) => {
  const { category_id, discount_percent } = req.body;
  if (!category_id) return res.status(400).json({ error: 'category_id gerekli' });
  if (discount_percent === null || discount_percent === undefined || discount_percent === '') {
    await pool.query('DELETE FROM category_staff_discounts WHERE tenant_id = ? AND category_id = ?', [req.tenantId, category_id]);
    return res.json({ ok: true });
  }
  await pool.query(
    `INSERT INTO category_staff_discounts (tenant_id, category_id, discount_percent) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE discount_percent = VALUES(discount_percent)`,
    [req.tenantId, category_id, discount_percent]
  );
  res.json({ ok: true });
});

// Ödeme tipleri — panel bunlarla yönetiyor, kasa bunları okuyup butonları
// dinamik oluşturuyor (artık Nakit/Kredi Kartı sabit kodlu değil).
router.get('/payment-methods', async (req, res) => {
  const [methods] = await pool.query('SELECT * FROM payment_methods WHERE tenant_id = ? ORDER BY sort_order, id', [req.tenantId]);
  const [subs] = await pool.query(
    `SELECT s.* FROM payment_method_subtypes s JOIN payment_methods m ON m.id = s.payment_method_id WHERE m.tenant_id = ? ORDER BY s.sort_order, s.id`,
    [req.tenantId]
  );
  res.json(methods.map(m => ({ ...m, subtypes: subs.filter(s => s.payment_method_id === m.id) })));
});

router.post('/payment-methods', async (req, res) => {
  const { name, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'İsim gerekli' });
  const [[maxRow]] = await pool.query('SELECT COALESCE(MAX(sort_order),0) as m FROM payment_methods WHERE tenant_id = ?', [req.tenantId]);
  const [result] = await pool.query('INSERT INTO payment_methods (tenant_id, name, icon, sort_order) VALUES (?, ?, ?, ?)', [req.tenantId, name, icon || '💳', maxRow.m + 1]);
  res.json({ id: result.insertId });
});

router.patch('/payment-methods/:id', async (req, res) => {
  const { name, icon, active } = req.body;
  const fields = [], params = [];
  if (name !== undefined) { fields.push('name = ?'); params.push(name); }
  if (icon !== undefined) { fields.push('icon = ?'); params.push(icon); }
  if (active !== undefined) { fields.push('active = ?'); params.push(active ? 1 : 0); }
  if (fields.length === 0) return res.json({ ok: true });
  params.push(req.params.id, req.tenantId);
  await pool.query(`UPDATE payment_methods SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
  res.json({ ok: true });
});

router.delete('/payment-methods/:id', async (req, res) => {
  await pool.query('DELETE FROM payment_methods WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  res.json({ ok: true });
});

router.post('/payment-methods/:id/subtypes', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'İsim gerekli' });
  const [[owns]] = await pool.query('SELECT id FROM payment_methods WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!owns) return res.status(404).json({ error: 'Ödeme tipi bulunamadı' });
  const [[maxRow]] = await pool.query('SELECT COALESCE(MAX(sort_order),0) as m FROM payment_method_subtypes WHERE payment_method_id = ?', [req.params.id]);
  const [result] = await pool.query('INSERT INTO payment_method_subtypes (payment_method_id, name, sort_order) VALUES (?, ?, ?)', [req.params.id, name, maxRow.m + 1]);
  res.json({ id: result.insertId });
});

router.delete('/payment-methods/subtypes/:subId', async (req, res) => {
  await pool.query(
    `DELETE s FROM payment_method_subtypes s JOIN payment_methods m ON m.id = s.payment_method_id WHERE s.id = ? AND m.tenant_id = ?`,
    [req.params.subId, req.tenantId]
  );
  res.json({ ok: true });
});

router.post('/tables', requireFeature('masa_servisi'), async (req, res) => {
  const { name, x, y, seats } = req.body;
  if (!name) return res.status(400).json({ error: 'Masa adı zorunlu' });
  const [result] = await pool.query(
    'INSERT INTO tables (tenant_id, name, x, y, seats) VALUES (?, ?, ?, ?, ?)',
    [req.tenantId, name, x ?? 60, y ?? 60, seats ?? 2]
  );
  res.json({ id: result.insertId, name, x: x ?? 60, y: y ?? 60, seats: seats ?? 2 });
});

router.patch('/tables/:id', async (req, res) => {
  const { name, x, y, seats, zone_id } = req.body;
  const sets = [], values = [];
  if (name !== undefined) { sets.push('name = ?'); values.push(name); }
  if (x !== undefined) { sets.push('x = ?'); values.push(x); }
  if (y !== undefined) { sets.push('y = ?'); values.push(y); }
  if (seats !== undefined) { sets.push('seats = ?'); values.push(seats); }
  if (zone_id !== undefined) { sets.push('zone_id = ?'); values.push(zone_id); }
  if (sets.length === 0) return res.json({ ok: true });
  values.push(req.params.id, req.tenantId);
  await pool.query(`UPDATE tables SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, values);
  res.json({ ok: true });
});

router.delete('/tables/:id', requireFeature('masa_servisi'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Bu masaya bağlı geçmiş QR siparişleri varsa, siparişleri SİLMEDEN sadece
    // masa bağlantısını kaldırıyoruz — yoksa veritabanı kısıtlaması (foreign key)
    // yüzünden masa hiç silinemiyordu.
    await conn.query('UPDATE qr_orders SET table_id = NULL WHERE table_id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    await conn.query('UPDATE orders SET table_id = NULL WHERE table_id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    await conn.query('DELETE FROM tables WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: 'Masa silinemedi', detail: e.message });
  } finally {
    conn.release();
  }
});

// ---- Bölgeler (Bahçe, Salon vb.) ----
router.get('/zones', requireFeature('masa_servisi'), async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM zones WHERE tenant_id = ?', [req.tenantId]);
  res.json(rows);
});

router.post('/zones', requireFeature('masa_servisi'), async (req, res) => {
  const { name, x, y, width, height, color } = req.body;
  const [result] = await pool.query(
    'INSERT INTO zones (tenant_id, name, x, y, width, height, color) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.tenantId, name, x ?? null, y ?? null, width ?? null, height ?? null, color || '#EFE3D3']
  );
  res.json({ id: result.insertId, name, color: color || '#EFE3D3' });
});

router.patch('/zones/:id', async (req, res) => {
  const { name, x, y, width, height, color } = req.body;
  const sets = [], values = [];
  if (name !== undefined) { sets.push('name = ?'); values.push(name); }
  if (x !== undefined) { sets.push('x = ?'); values.push(x); }
  if (y !== undefined) { sets.push('y = ?'); values.push(y); }
  if (width !== undefined) { sets.push('width = ?'); values.push(width); }
  if (height !== undefined) { sets.push('height = ?'); values.push(height); }
  if (color !== undefined) { sets.push('color = ?'); values.push(color); }
  if (sets.length === 0) return res.json({ ok: true });
  values.push(req.params.id, req.tenantId);
  await pool.query(`UPDATE zones SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, values);
  res.json({ ok: true });
});

router.delete('/zones/:id', requireFeature('masa_servisi'), async (req, res) => {
  await pool.query('UPDATE tables SET zone_id = NULL WHERE zone_id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  await pool.query('DELETE FROM zones WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  res.json({ ok: true });
});

// ---- Yapay Zeka Menü Asistanı ----
// Kullanıcının yapıştırdığı menü metnini veya tek satırlık komutunu okuyup
// bir "aksiyon planı" (JSON) üreten, sonra bu planı veritabanına uygulayan uç nokta.
router.post('/ai-command', requireFeature('ai_assistant'), async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Mesaj boş olamaz' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'AI asistanı henüz aktif değil — sunucuda ANTHROPIC_API_KEY tanımlı değil. Hostinger → Ortam Değişkenleri kısmından ekleyin.' });
  }
  // Çok uzun bir menü metni AI'nin cevabının kesilmesine (bozuk JSON'a) yol açabiliyor —
  // bunun yerine net bir uyarı verip parçalara bölmesini isteyelim.
  const estimatedLineCount = message.trim().split('\n').filter(l => l.trim()).length;
  if (message.length > 6000 || estimatedLineCount > 60) {
    return res.status(400).json({
      error: `Liste tek seferde işlemek için fazla büyük görünüyor (~${estimatedLineCount} satır). Lütfen listeyi 2-3 parçaya bölüp her birini ayrı ayrı gönderin — örneğin önce "İçecekler" kategorisini, sonra "Yiyecekler"i yapıştırın. Bu şekilde her seferinde daha güvenilir sonuç alırsınız.`
    });
  }

  try {
    const [cats] = await pool.query('SELECT id, group_name, name FROM categories WHERE tenant_id = ?', [req.tenantId]);
    const [prods] = await pool.query('SELECT * FROM products WHERE tenant_id = ?', [req.tenantId]);
    const [sizes] = await pool.query(
      `SELECT ps.* FROM product_sizes ps JOIN products p ON p.id = ps.product_id WHERE p.tenant_id = ?`, [req.tenantId]
    );
    const menuSnapshot = cats.map(c => ({
      group_name: c.group_name, category_name: c.name,
      products: prods.filter(p => p.category_id === c.id).map(p => ({
        name: p.name, sizes: sizes.filter(s => s.product_id === p.id).map(s => ({ label: s.label, price: Number(s.price) }))
      }))
    }));

    const systemPrompt = `Sen bir kahve dükkanı POS sisteminin menü asistanısın. Kullanıcının verdiği serbest metni (tam bir menü listesi olabilir ya da "Latte fiyatını 130 yap" gibi tek bir komut olabilir) analiz et.

Mevcut menü (referans için, JSON):
${JSON.stringify(menuSnapshot)}

SADECE aşağıdaki JSON formatında bir aksiyon planı üret, başka hiçbir açıklama/markdown/kod bloğu yazma, sadece ham JSON:
{
  "summary": "kullanıcıya gösterilecek kısa Türkçe özet cümlesi",
  "actions": [
    {"type":"add_category","group_name":"...","name":"..."},
    {"type":"add_product","group_name":"...","category_name":"...","product_name":"...","sizes":[{"label":"...","price":123}]},
    {"type":"update_product_price","product_name":"...","size_label":"...","price":123},
    {"type":"delete_product","product_name":"..."},
    {"type":"rename_category","group_name":"...","old_name":"...","new_name":"..."},
    {"type":"delete_category","group_name":"...","name":"..."}
  ]
}

Kurallar:
- Aynı isimde bir üst/alt kategori zaten varsa tekrar add_category üretme, mevcut ismi aynen kullan.
- Menü metninde kategori belirtilmemişse mantıklı bir kategori tahmin et (örn. kahve çeşitleri → "İçecekler / Sıcak İçecekler").
- Boy/varyant belirtilmemiş ürünlerde tek bir "Adet" boyutu kullan.
- update_product_price ve delete_product, product_name'i mevcut menüdeki isimle (büyük/küçük harf duyarsız) eşleştirerek çalışır.
- Kullanıcı sadece küçük bir düzenleme istiyorsa (fiyat değiştirme, ürün silme gibi) SADECE o aksiyonu üret, tüm menüyü yeniden yazma.
- Kullanıcı büyük bir menü metni yapıştırdıysa, metindeki HER ürünü ayrı bir add_product aksiyonu olarak üret.`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: message }]
      })
    });
    const aiData = await aiRes.json();
    if (!aiRes.ok) {
      return res.status(500).json({ error: 'AI isteği başarısız', detail: aiData.error?.message || JSON.stringify(aiData) });
    }
    const rawText = (aiData.content || []).map(b => b.text || '').join('').trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'AI cevabı okunamadı', detail: rawText.slice(0, 300) });
    let plan;
    try {
      plan = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      // Cevap kesilmiş (çok uzun liste) olabilir — kullanıcıya net, aksiyon alabileceği bir mesaj verelim
      return res.status(500).json({
        error: 'AI\'nin cevabı çok uzun olduğu için yarıda kesildi ve okunamadı. Lütfen listeyi daha küçük parçalara (örn. 20-30 ürünlük gruplar halinde) bölüp tekrar deneyin.'
      });
    }

    // ---- Aksiyon planını uygula ----
    const conn = await pool.getConnection();
    let addedCategories = 0, addedProducts = 0, updated = 0, deleted = 0;
    try {
      await conn.beginTransaction();

      async function findCategoryId(group_name, category_name) {
        const [[row]] = await conn.query(
          'SELECT id FROM categories WHERE tenant_id = ? AND group_name = ? AND name = ?',
          [req.tenantId, group_name, category_name]
        );
        return row ? row.id : null;
      }

      for (const action of (plan.actions || [])) {
        if (action.type === 'add_category') {
          const exists = await findCategoryId(action.group_name, action.name);
          if (!exists) {
            await conn.query('INSERT INTO categories (tenant_id, group_name, name) VALUES (?, ?, ?)', [req.tenantId, action.group_name, action.name]);
            addedCategories++;
          }
        } else if (action.type === 'add_product') {
          let catId = await findCategoryId(action.group_name, action.category_name);
          if (!catId) {
            const [r] = await conn.query('INSERT INTO categories (tenant_id, group_name, name) VALUES (?, ?, ?)', [req.tenantId, action.group_name, action.category_name]);
            catId = r.insertId; addedCategories++;
          }
          const [pr] = await conn.query(
            'INSERT INTO products (tenant_id, category_id, name, vat_rate) VALUES (?, ?, ?, 10)',
            [req.tenantId, catId, action.product_name]
          );
          for (const s of (action.sizes || [])) {
            await conn.query('INSERT INTO product_sizes (product_id, label, price) VALUES (?, ?, ?)', [pr.insertId, s.label, s.price]);
          }
          addedProducts++;
        } else if (action.type === 'update_product_price') {
          const [[prod]] = await conn.query(
            'SELECT id FROM products WHERE tenant_id = ? AND LOWER(name) = LOWER(?)', [req.tenantId, action.product_name]
          );
          if (prod) {
            const [[sz]] = await conn.query(
              'SELECT id FROM product_sizes WHERE product_id = ? AND LOWER(label) = LOWER(?)', [prod.id, action.size_label || 'Adet']
            );
            if (sz) { await conn.query('UPDATE product_sizes SET price = ? WHERE id = ?', [action.price, sz.id]); updated++; }
            else { await conn.query('INSERT INTO product_sizes (product_id, label, price) VALUES (?, ?, ?)', [prod.id, action.size_label || 'Adet', action.price]); updated++; }
          }
        } else if (action.type === 'delete_product') {
          const [r] = await conn.query('DELETE FROM products WHERE tenant_id = ? AND LOWER(name) = LOWER(?)', [req.tenantId, action.product_name]);
          deleted += r.affectedRows;
        } else if (action.type === 'rename_category') {
          await conn.query('UPDATE categories SET name = ? WHERE tenant_id = ? AND group_name = ? AND name = ?', [action.new_name, req.tenantId, action.group_name, action.old_name]);
          updated++;
        } else if (action.type === 'delete_category') {
          const [r] = await conn.query('DELETE FROM categories WHERE tenant_id = ? AND group_name = ? AND name = ?', [req.tenantId, action.group_name, action.name]);
          deleted += r.affectedRows;
        }
      }

      await conn.commit();
      broadcastMenuChanged(req.tenantId);
      res.json({ ok: true, summary: plan.summary || 'İşlem tamamlandı.', addedCategories, addedProducts, updated, deleted });
    } catch (e) {
      await conn.rollback();
      res.status(500).json({ error: 'Değişiklikler uygulanamadı', detail: e.message });
    } finally {
      conn.release();
    }
  } catch (e) {
    res.status(500).json({ error: 'AI isteği başarısız', detail: e.message });
  }
});

// ---- Maliyet Hesaplama — Malzemeler ----
router.get('/ingredients', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM ingredients WHERE tenant_id = ? ORDER BY name', [req.tenantId]);
  res.json(rows);
});

router.post('/ingredients', async (req, res) => {
  const { name, unit, unit_price } = req.body;
  if (!name) return res.status(400).json({ error: 'Malzeme adı zorunlu' });
  const [result] = await pool.query(
    'INSERT INTO ingredients (tenant_id, name, unit, unit_price) VALUES (?, ?, ?, ?)',
    [req.tenantId, name, unit || 'adet', unit_price ?? 0]
  );
  res.json({ id: result.insertId, name, unit: unit || 'adet', unit_price: unit_price ?? 0 });
});

router.patch('/ingredients/:id', async (req, res) => {
  const { name, unit, unit_price } = req.body;
  const sets = [], values = [];
  if (name !== undefined) { sets.push('name = ?'); values.push(name); }
  if (unit !== undefined) { sets.push('unit = ?'); values.push(unit); }
  if (unit_price !== undefined) { sets.push('unit_price = ?'); values.push(unit_price); }
  if (sets.length === 0) return res.json({ ok: true });
  values.push(req.params.id, req.tenantId);
  await pool.query(`UPDATE ingredients SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, values);
  res.json({ ok: true });
});

router.delete('/ingredients/:id', async (req, res) => {
  await pool.query('DELETE FROM ingredients WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  res.json({ ok: true });
});

// ---- Ürün reçeteleri (bir ürünü yapmak için gereken malzemeler) ----
router.get('/products/:id/recipe', async (req, res) => {
  const [[prod]] = await pool.query('SELECT id FROM products WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!prod) return res.status(404).json({ error: 'Ürün bulunamadı' });
  const [rows] = await pool.query(
    `SELECT pi.id, pi.ingredient_id, pi.quantity, i.name as ingredient_name, i.unit, i.unit_price
     FROM product_ingredients pi JOIN ingredients i ON i.id = pi.ingredient_id
     WHERE pi.product_id = ?`, [req.params.id]
  );
  res.json(rows);
});

router.put('/products/:id/recipe', async (req, res) => {
  const { items } = req.body; // [{ingredient_id, quantity}]
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[prod]] = await conn.query('SELECT id FROM products WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!prod) throw new Error('Ürün bulunamadı');
    await conn.query('DELETE FROM product_ingredients WHERE product_id = ?', [req.params.id]);
    for (const it of (items || [])) {
      if (!it.ingredient_id || !it.quantity) continue;
      await conn.query('INSERT INTO product_ingredients (product_id, ingredient_id, quantity) VALUES (?, ?, ?)', [req.params.id, it.ingredient_id, it.quantity]);
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: 'Reçete kaydedilemedi', detail: e.message });
  } finally {
    conn.release();
  }
});

// Her ürünün toplam malzeme maliyeti — reçetesi olan tüm ürünler için tek seferde
router.get('/product-costs', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.id as product_id, p.name, COALESCE(SUM(pi.quantity * i.unit_price), 0) as cost
     FROM products p
     LEFT JOIN product_ingredients pi ON pi.product_id = p.id
     LEFT JOIN ingredients i ON i.id = pi.ingredient_id
     WHERE p.tenant_id = ?
     GROUP BY p.id, p.name`,
    [req.tenantId]
  );
  res.json(rows);
});

// ---- Arka Ekran Slider (müşteri ekranı boştayken dönen görseller) ----
router.get('/slides', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM display_slides WHERE tenant_id = ? ORDER BY sort_order, id', [req.tenantId]);
  res.json(rows);
});

router.post('/slides', async (req, res) => {
  const { image_url, seconds } = req.body;
  if (!image_url) return res.status(400).json({ error: 'Görsel zorunlu' });
  const [[maxRow]] = await pool.query('SELECT COALESCE(MAX(sort_order),-1) as m FROM display_slides WHERE tenant_id = ?', [req.tenantId]);
  const [result] = await pool.query(
    'INSERT INTO display_slides (tenant_id, image_url, seconds, sort_order) VALUES (?, ?, ?, ?)',
    [req.tenantId, image_url, seconds || 5, maxRow.m + 1]
  );
  res.json({ id: result.insertId });
});

router.patch('/slides/:id', async (req, res) => {
  const { seconds, sort_order } = req.body;
  const sets = [], values = [];
  if (seconds !== undefined) { sets.push('seconds = ?'); values.push(seconds); }
  if (sort_order !== undefined) { sets.push('sort_order = ?'); values.push(sort_order); }
  if (sets.length === 0) return res.json({ ok: true });
  values.push(req.params.id, req.tenantId);
  await pool.query(`UPDATE display_slides SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, values);
  res.json({ ok: true });
});

router.delete('/slides/:id', async (req, res) => {
  await pool.query('DELETE FROM display_slides WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  res.json({ ok: true });
});

export default router;
