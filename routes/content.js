import express from 'express';
import pool from '../db.js';
import { addClient, removeClient, broadcastNewOrder } from '../sseHub.js';

const router = express.Router();

// Kasa uygulamasının açtığı canlı bağlantı — menü değiştiğinde anında haber alır.
// tenantSlug ile (kimlik doğrulama gerektirmeden, sadece "değişti" sinyali için)
router.get('/menu-events/:tenantSlug', async (req, res) => {
  try {
    const [[tenant]] = await pool.query('SELECT id FROM tenants WHERE slug = ?', [req.params.tenantSlug]);
    if (!tenant) return res.status(404).end();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // bazı proxy'lerin tamponlamasını engeller
    });
    res.write('\n');
    addClient(tenant.id, res);

    // Bağlantıyı canlı tutmak için periyodik ping (proxy'lerin bağlantıyı kapatmasını engeller)
    const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      removeClient(tenant.id, res);
    });
  } catch (e) {
    res.status(500).end();
  }
});


const DEFAULTS = {
  hero_title: 'Hızlı Satış Yapın,\nKarmaşaya Son Verin.',
  hero_subtitle: 'Menü yönetiminden ödemeye, raporlardan anlık ciro takibine kadar her şey tek bir sistemde.',
  banner_image: '',
  price_baslangic: '499',
  price_pro: '999',
  price_kurumsal: 'Özel teklif',
};

// Herkese açık — landing sayfası bunu okur, giriş gerekmez
router.get('/content', async (req, res) => {
  try{
    const [rows] = await pool.query('SELECT content_key, content_value FROM site_content');
    const content = { ...DEFAULTS };
    rows.forEach(r => { content[r.content_key] = r.content_value; });
    const [posts] = await pool.query('SELECT id, title, slug, body, created_at FROM blog_posts WHERE published = 1 ORDER BY created_at DESC');
    res.json({ content, posts });
  }catch(e){ res.json({ content: DEFAULTS, posts: [] }); }
});

// Herkese açık — "Sizi Arayalım" demo talep formu buraya POST atar, giriş gerekmez
router.post('/demo-request', async (req, res) => {
  const { name, phone, email, businessName } = req.body || {};
  if (!name || !phone || !businessName) {
    return res.status(400).json({ error: 'Ad Soyad, Telefon Numarası ve İşletme Adı zorunludur' });
  }
  try {
    await pool.query(
      'INSERT INTO demo_requests (name, phone, email, business_name) VALUES (?, ?, ?, ?)',
      [name, phone, email || null, businessName]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Talep kaydedilemedi', detail: e.message });
  }
});

// Herkese açık — QR menü sayfası bunu okur, giriş gerekmez
router.get('/qr-menu/:tenantSlug', async (req, res) => {
  try{
    const [tenants] = await pool.query('SELECT id, name, currency FROM tenants WHERE slug = ?', [req.params.tenantSlug]);
    if (tenants.length === 0) return res.status(404).json({ error: 'İşletme bulunamadı' });
    const tenant = tenants[0];

    const [cats] = await pool.query('SELECT id, group_name, name FROM categories WHERE tenant_id = ?', [tenant.id]);
    const [products] = await pool.query('SELECT * FROM products WHERE tenant_id = ? AND active = 1', [tenant.id]);
    const [sizes] = await pool.query(
      `SELECT ps.* FROM product_sizes ps JOIN products p ON p.id = ps.product_id WHERE p.tenant_id = ?`, [tenant.id]
    );
    const withSizes = products.map(p => ({ ...p, sizes: sizes.filter(s => s.product_id === p.id) }));
    const [tables] = await pool.query('SELECT id, name FROM tables WHERE tenant_id = ? ORDER BY id', [tenant.id]);

    res.json({ tenant, categories: cats, products: withSizes, tables, requiresTable: tables.length > 0 });
  }catch(e){ res.status(500).json({ error: 'Menü alınamadı', detail: e.message }); }
});

// Herkese açık — QR menüden sipariş gönderimi
router.post('/qr-order', async (req, res) => {
  const { tenantSlug, tableId, items, customerNote } = req.body || {};
  if (!tenantSlug || !items || !items.length) {
    return res.status(400).json({ error: 'Sipariş bilgisi eksik' });
  }
  try{
    const [tenants] = await pool.query('SELECT id FROM tenants WHERE slug = ?', [tenantSlug]);
    if (tenants.length === 0) return res.status(404).json({ error: 'İşletme bulunamadı' });
    const tenantId = tenants[0].id;

    const [tables] = await pool.query('SELECT id FROM tables WHERE tenant_id = ?', [tenantId]);
    if (tables.length > 0 && !tableId) {
      return res.status(400).json({ error: 'Bu işletmede masa seçimi zorunludur' });
    }
    const total = items.reduce((s, it) => s + (Number(it.price) * Number(it.qty)), 0);

    const [result] = await pool.query(
      'INSERT INTO qr_orders (tenant_id, table_id, items, total, customer_note) VALUES (?, ?, ?, ?, ?)',
      [tenantId, tableId || null, JSON.stringify(items), total, customerNote || null]
    );
    broadcastNewOrder(tenantId);
    res.json({ ok: true, orderId: result.insertId });
  }catch(e){ res.status(500).json({ error: 'Sipariş gönderilemedi', detail: e.message }); }
});

// Herkese açık — müşteri ekranı (ikinci monitör) bunları okur, giriş gerekmez
router.get('/display/:tenantSlug', async (req, res) => {
  try{
    const [tenants] = await pool.query('SELECT id, name, currency FROM tenants WHERE slug = ?', [req.params.tenantSlug]);
    if (tenants.length === 0) return res.status(404).json({ error: 'İşletme bulunamadı' });
    const tenant = tenants[0];
    const [slides] = await pool.query('SELECT id, image_url, seconds FROM display_slides WHERE tenant_id = ? ORDER BY sort_order, id', [tenant.id]);
    const [[cart]] = await pool.query('SELECT items, total, updated_at FROM live_cart WHERE tenant_id = ?', [tenant.id]);
    // Bazı sürücü/sürüm kombinasyonlarında JSON sütunu ham metin olarak
    // dönebiliyor — ekran tarafında sessizce bozulmasın diye burada garantiye alıyoruz.
    let cartItems = null;
    if (cart) cartItems = typeof cart.items === 'string' ? JSON.parse(cart.items) : cart.items;
    res.json({
      tenant,
      slides,
      liveCart: cart ? { items: cartItems || [], total: Number(cart.total), updatedAt: cart.updated_at } : null
    });
  }catch(e){ res.status(500).json({ error: 'Ekran verisi alınamadı', detail: e.message }); }
});

// ============================================================
// HARİCİ WEB SİTESİ SİPARİŞ API'Sİ
// ============================================================
// Her işletme kendi web sitesini (panelden alacağı API anahtarıyla) bu iki
// uç noktaya bağlayarak sipariş gönderebilir — sipariş otomatik olarak
// kasa/panel "Gelen Siparişler" listesine düşer.

// Web sitesinin güncel menü/fiyatları çekmesi için — API anahtarı gerekir
router.get('/store-api/:apiKey/menu', async (req, res) => {
  try{
    const [tenants] = await pool.query('SELECT id, name, currency, features FROM tenants WHERE store_api_key = ?', [req.params.apiKey]);
    if (tenants.length === 0) return res.status(401).json({ error: 'Geçersiz API anahtarı' });
    const tenant = tenants[0];
    const feats = tenant.features ? (typeof tenant.features === 'string' ? JSON.parse(tenant.features) : tenant.features) : {};
    const staffDiscountOn = feats.personel_indirimi === true;

    const [cats] = await pool.query('SELECT id, group_name, name FROM categories WHERE tenant_id = ?', [tenant.id]);
    const [products] = await pool.query('SELECT id, category_id, name, image_url FROM products WHERE tenant_id = ? AND active = 1', [tenant.id]);
    const [sizes] = await pool.query(
      `SELECT ps.* FROM product_sizes ps JOIN products p ON p.id = ps.product_id WHERE p.tenant_id = ?`, [tenant.id]
    );
    const withSizes = products.map(p => ({ ...p, sizes: sizes.filter(s => s.product_id === p.id) }));

    // Personel indirimi açıksa, hangi kategoride kaç oran indirim olduğunu da
    // veriyoruz — web sitesi bunu SADECE "personel fiyatı" önizlemesi göstermek
    // için kullanabilir, ama gerçek/geçerli hesaplama her zaman sipariş
    // gönderilirken sunucuda (bu dosyada) yeniden yapılıyor — web sitesinin
    // gönderdiği fiyata güvenilmiyor.
    let staffDiscounts = [];
    if (staffDiscountOn) {
      const [rows] = await pool.query('SELECT category_id, discount_percent FROM category_staff_discounts WHERE tenant_id = ?', [tenant.id]);
      staffDiscounts = rows.map(r => ({ categoryId: r.category_id, discountPercent: Number(r.discount_percent) }));
    }

    res.json({ tenant: { name: tenant.name, currency: tenant.currency }, categories: cats, products: withSizes, staffDiscountEnabled: staffDiscountOn, staffDiscounts });
  }catch(e){ res.status(500).json({ error: 'Menü alınamadı', detail: e.message }); }
});

// Web sitesinden sipariş gönderimi — API anahtarı gerekir. GÜVENLİK: fiyatı
// web sitesinin gönderdiği değere ASLA güvenmiyoruz — her ürünün gerçek/güncel
// fiyatını burada, kendi veritabanımızdan buluyoruz. Personel indirimi de
// (isStaffMember true ise ve özellik açıksa) burada, kategoriye göre biz
// hesaplıyoruz — böylece hem fiyat manipülasyonu imkansız hem de indirim
// raporlara gerçek bir indirim olarak doğru yansıyor.
router.post('/store-api/:apiKey/order', async (req, res) => {
  const { items, customerName, customerPhone, note, isStaffMember } = req.body || {};
  if (!items || !items.length) return res.status(400).json({ error: 'Sipariş kalemleri gerekli' });
  try{
    const [tenants] = await pool.query('SELECT id, features FROM tenants WHERE store_api_key = ?', [req.params.apiKey]);
    if (tenants.length === 0) return res.status(401).json({ error: 'Geçersiz API anahtarı' });
    const tenantId = tenants[0].id;
    const feats = tenants[0].features ? (typeof tenants[0].features === 'string' ? JSON.parse(tenants[0].features) : tenants[0].features) : {};
    const staffDiscountOn = feats.personel_indirimi === true && isStaffMember === true;

    let staffDiscountMap = {};
    if (staffDiscountOn) {
      const [rows] = await pool.query('SELECT category_id, discount_percent FROM category_staff_discounts WHERE tenant_id = ?', [tenantId]);
      rows.forEach(r => { staffDiscountMap[r.category_id] = Number(r.discount_percent); });
    }

    // Her kalem için GERÇEK fiyatı kendi veritabanımızdan buluyoruz —
    // web sitesinin gönderdiği "price" alanı SADECE ekranda gösterim için,
    // burada dikkate alınmıyor.
    const resolvedItems = [];
    for (const it of items) {
      const [[product]] = await pool.query('SELECT id, name, category_id FROM products WHERE id = ? AND tenant_id = ?', [it.productId, tenantId]);
      if (!product) return res.status(400).json({ error: `Ürün bulunamadı: ${it.productId}` });
      const [[size]] = await pool.query('SELECT label, price FROM product_sizes WHERE product_id = ? AND label = ?', [product.id, it.size || '']);
      if (!size) return res.status(400).json({ error: `Boy bulunamadı: ${product.name} / ${it.size}` });
      let unitPrice = Number(size.price);
      let discountPercent = staffDiscountOn ? (staffDiscountMap[product.category_id] ?? 0) : 0;
      const finalPrice = discountPercent > 0 ? +(unitPrice * (1 - discountPercent / 100)).toFixed(2) : unitPrice;
      resolvedItems.push({ name: product.name, size: size.label, qty: Number(it.qty) || 1, unitPrice, discountPercent, finalPrice });
    }

    const total = resolvedItems.reduce((s, it) => s + it.finalPrice * it.qty, 0);
    const [result] = await pool.query(
      `INSERT INTO qr_orders (tenant_id, items, total, customer_note, customer_name, customer_phone, source)
       VALUES (?, ?, ?, ?, ?, ?, 'website')`,
      [tenantId, JSON.stringify(resolvedItems), total, note || null, customerName || null, customerPhone || null]
    );
    broadcastNewOrder(tenantId);
    res.json({ ok: true, orderId: result.insertId, total });
  }catch(e){ res.status(500).json({ error: 'Sipariş gönderilemedi', detail: e.message }); }
});

export default router;
