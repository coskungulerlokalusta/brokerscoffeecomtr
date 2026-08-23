import express from 'express';
import pool from '../db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { computeDailyOrderNumber } from '../dayCloseAuto.js';

const router = express.Router();
router.use(requireAuth);

// Satılan ürünlerden, stok takibi açık olanların stoğunu düşer (market/bakkal
// modülü) — ürün adıyla eşleştirir, kg bazlı ürünlerde miktar zaten kg'dır.
async function deductStock(conn, tenantId, items) {
  const [products] = await conn.query(
    'SELECT id, name, stock_qty FROM products WHERE tenant_id = ? AND stock_qty IS NOT NULL',
    [tenantId]
  );
  const byName = {}; products.forEach(p => { byName[p.name.toLowerCase()] = p; });
  for (const it of items) {
    const p = byName[(it.name || '').toLowerCase()];
    if (!p) continue;
    await conn.query('UPDATE products SET stock_qty = GREATEST(0, stock_qty - ?) WHERE id = ?', [it.qty, p.id]);
  }
}

// Sipariş kalemlerini kategorilerine göre mutfak/bar istasyonlarına ayırıp
// print_jobs kuyruğuna ekler — Bridge programı bunu çekip termal yazıcıya basar
async function createPrintJobs(conn, tenantId, orderId, tableLabel, items) {
  const [products] = await conn.query(
    `SELECT p.name, c.print_station FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.tenant_id = ? AND c.print_station IS NOT NULL`,
    [tenantId]
  );
  const stationByName = {};
  products.forEach(p => { stationByName[p.name.toLowerCase()] = p.print_station; });

  const byStation = {};
  items.forEach(it => {
    const station = stationByName[(it.name || '').toLowerCase()];
    if (!station) return; // bu ürünün yazdırma istasyonu tanımlı değil — atla
    (byStation[station] = byStation[station] || []).push(it);
  });

  for (const [station, stationItems] of Object.entries(byStation)) {
    const lines = [
      `=== ${station.toUpperCase()} FİŞİ ===`,
      tableLabel ? `Masa: ${tableLabel}` : 'Self Servis',
      new Date().toLocaleString('tr-TR'),
      '--------------------------------',
      ...stationItems.map(it => `${it.qty}x ${it.name}${it.size ? ' ('+it.size+')' : ''}${(it.options&&it.options.length) ? ' - '+it.options.map(o=>o.choice).join(', ') : ''}`),
      '--------------------------------',
    ];
    await conn.query(
      'INSERT INTO print_jobs (tenant_id, order_id, station, content) VALUES (?, ?, ?, ?)',
      [tenantId, orderId, station, lines.join('\n')]
    );
  }
}

// Yeni sipariş kaydı — kasadan gönderilir (tek seferde tam ödeme senaryosu)
router.post('/', async (req, res) => {
  const { customer_name, note, total, vat_total, pay_label, items, table_id } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[tenantRow]] = await conn.query('SELECT opening_time FROM tenants WHERE id = ?', [req.tenantId]);
    const dailyNumber = await computeDailyOrderNumber(req.tenantId, tenantRow?.opening_time);
    const [result] = await conn.query(
      `INSERT INTO orders (tenant_id, staff_id, customer_name, note, total, vat_total, pay_label, status, table_id, daily_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?)`,
      [req.tenantId, req.userId, customer_name || null, note || null, total, vat_total || 0, pay_label, table_id || null, dailyNumber]
    );
    const orderId = result.insertId;
    for (const it of items) {
      await conn.query(
        `INSERT INTO order_items (order_id, product_name, size_label, qty, unit_price, discount_type, discount_value, options)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, it.name, it.size, it.qty, it.price, it.discount?.type || null, it.discount?.value || null, JSON.stringify(it.options || [])]
      );
    }
    await conn.query('INSERT INTO order_payments (order_id, amount, pay_label) VALUES (?, ?, ?)', [orderId, total, pay_label]);
    let tableLabel = null;
    if (table_id) { const [[t]] = await conn.query('SELECT name FROM tables WHERE id = ?', [table_id]); tableLabel = t?.name; }
    await createPrintJobs(conn, req.tenantId, orderId, tableLabel, items);
    await deductStock(conn, req.tenantId, items);
    await conn.commit();
    res.json({ id: orderId });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: 'Sipariş kaydedilemedi', detail: e.message });
  } finally {
    conn.release();
  }
});

// Kısmi ödeme / masa servisi senaryosu — önce "açık" bir sipariş oluşturulur
// (henüz ödeme yok), sipariş açılır açılmaz mutfak/bar fişi otomatik kesilir
router.post('/open', async (req, res) => {
  const { customer_name, note, total, vat_total, items, table_id } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[tenantRow]] = await conn.query('SELECT opening_time FROM tenants WHERE id = ?', [req.tenantId]);
    const dailyNumber = await computeDailyOrderNumber(req.tenantId, tenantRow?.opening_time);
    const [result] = await conn.query(
      `INSERT INTO orders (tenant_id, staff_id, customer_name, note, total, vat_total, status, table_id, daily_number)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      [req.tenantId, req.userId, customer_name || null, note || null, total, vat_total || 0, table_id || null, dailyNumber]
    );
    const orderId = result.insertId;
    for (const it of items) {
      await conn.query(
        `INSERT INTO order_items (order_id, product_name, size_label, qty, unit_price, discount_type, discount_value, options)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, it.name, it.size, it.qty, it.price, it.discount?.type || null, it.discount?.value || null, JSON.stringify(it.options || [])]
      );
    }
    let tableLabel = null;
    if (table_id) { const [[t]] = await conn.query('SELECT name FROM tables WHERE id = ?', [table_id]); tableLabel = t?.name; }
    await createPrintJobs(conn, req.tenantId, orderId, tableLabel, items);
    await deductStock(conn, req.tenantId, items);
    await conn.commit();
    res.json({ id: orderId, daily_number: dailyNumber });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: 'Sipariş açılamadı', detail: e.message });
  } finally {
    conn.release();
  }
});

// Açık bir siparişe kısmi/tam ödeme ekle — toplam ödenen tutar siparişin
// tutarına ulaşınca sipariş otomatik "closed" olur
router.post('/:id/pay', async (req, res) => {
  const { amount, pay_label } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Geçersiz tutar' });
  try {
    const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    if (order.status === 'closed') return res.status(400).json({ error: 'Bu sipariş zaten kapatılmış' });

    await pool.query('INSERT INTO order_payments (order_id, amount, pay_label) VALUES (?, ?, ?)', [order.id, amount, pay_label]);

    const [[sumRow]] = await pool.query('SELECT COALESCE(SUM(amount),0) as paid FROM order_payments WHERE order_id = ?', [order.id]);
    const paid = Number(sumRow.paid);
    const remaining = Math.max(0, Number(order.total) - paid);
    let closed = false;

    if (remaining < 0.01) {
      const [labels] = await pool.query('SELECT DISTINCT pay_label FROM order_payments WHERE order_id = ?', [order.id]);
      const finalLabel = labels.length > 1 ? 'Karma Ödeme' : labels[0].pay_label;
      await pool.query('UPDATE orders SET status = ?, pay_label = ? WHERE id = ?', ['closed', finalLabel, order.id]);
      closed = true;
    }
    res.json({ ok: true, paid, remaining, closed });
  } catch (e) {
    res.status(500).json({ error: 'Ödeme kaydedilemedi', detail: e.message });
  }
});

// Bir siparişin ödeme geçmişini listele
router.get('/:id/payments', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT op.* FROM order_payments op JOIN orders o ON o.id = op.order_id
     WHERE op.order_id = ? AND o.tenant_id = ? ORDER BY op.created_at`,
    [req.params.id, req.tenantId]
  );
  res.json(rows);
});

// Kapanmış bir siparişi tekrar düzenlemek üzere yeniden aç — önceki ödemeler silinir,
// kasiyer siparişi düzenleyip yeniden kapatabilir
// Açık bir siparişten tek bir ürünü iptal eder (yanlış girildi, müşteri vazgeçti vb.)
// — sadece henüz ödenmemiş (status='open') siparişlerde kullanılabilir, kalıcı
// olarak kayıt altına alınır (İptal Ürün Raporu bu kayıttan besleniyor)
// Bir kerelik bakım: bu düzeltmeden ÖNCE iptal edilmiş ürünler order_items'ta
// hâlâ duruyor olabilir (raporlarda fazladan sayılıyordu). cancelled_items
// kayıtlarını kullanarak bunları geriye dönük temizler.
// Bir kerelik bakım (TÜM işletmeler için, sunucu açılışında otomatik çalışır):
// bu düzeltmeden ÖNCE iptal edilmiş ürünler order_items'ta hâlâ duruyor
// olabilir (raporlarda fazladan sayılıyordu). cancelled_items kayıtlarını
// kullanarak bunları geriye dönük temizler.
export async function cleanupCancelledItemsGlobal() {
  const [cancelledRows] = await pool.query('SELECT * FROM cancelled_items WHERE order_id IS NOT NULL');
  let cleaned = 0;
  for (const c of cancelledRows) {
    const [[matchingItem]] = await pool.query(
      'SELECT id, qty FROM order_items WHERE order_id = ? AND product_name = ? AND unit_price = ? LIMIT 1',
      [c.order_id, c.product_name, c.unit_price]
    );
    if (matchingItem) {
      if (Number(matchingItem.qty) <= Number(c.qty)) {
        await pool.query('DELETE FROM order_items WHERE id = ?', [matchingItem.id]);
      } else {
        await pool.query('UPDATE order_items SET qty = qty - ? WHERE id = ?', [c.qty, matchingItem.id]);
      }
      cleaned++;
    }
  }
  return cleaned;
}

// Açık (ödenmemiş) bir siparişi tamamen siler — eski/unutulmuş test siparişlerini
// temizlemek için. Sadece HENÜZ ÖDENMEMİŞ siparişler silinebilir; kapanmış
// (ödenmiş) gerçek satış geçmişi bu uç noktadan asla silinemez.
router.delete('/:id', requirePermission('adisyon_duzenleme'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!order) throw new Error('Sipariş bulunamadı');
    if (order.status !== 'open') throw new Error('Sadece henüz ödenmemiş (açık) siparişler silinebilir — kapanmış satış kayıtları korunur.');
    await conn.query('DELETE FROM order_items WHERE order_id = ?', [order.id]);
    await conn.query('DELETE FROM orders WHERE id = ?', [order.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

router.post('/:id/cancel-item', requirePermission('urun_silme'), async (req, res) => {
  const { product_name, qty, unit_price, reason } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!order) throw new Error('Sipariş bulunamadı');
    if (order.status !== 'open') throw new Error('Sadece henüz ödenmemiş siparişlerden ürün iptal edilebilir.');
    const [[staff]] = await conn.query('SELECT name FROM users WHERE id = ?', [req.userId]);
    await conn.query(
      'INSERT INTO cancelled_items (tenant_id, order_id, product_name, qty, unit_price, reason, cancelled_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.tenantId, order.id, product_name, qty, unit_price, reason || null, staff ? staff.name : 'Bilinmiyor']
    );
    // ÖNEMLİ: order_items'tan da düşüyoruz — yoksa iptal edilen ürün sipariş
    // tutarından çıksa bile Raporlar'da (order_items'tan doğrudan hesaplandığı
    // için) hâlâ sayılmaya devam ediyordu.
    const [[matchingItem]] = await conn.query(
      'SELECT id, qty FROM order_items WHERE order_id = ? AND product_name = ? AND unit_price = ? LIMIT 1',
      [order.id, product_name, unit_price]
    );
    if (matchingItem) {
      if (Number(matchingItem.qty) <= Number(qty)) {
        await conn.query('DELETE FROM order_items WHERE id = ?', [matchingItem.id]);
      } else {
        await conn.query('UPDATE order_items SET qty = qty - ? WHERE id = ?', [qty, matchingItem.id]);
      }
    }
    const newTotal = Math.max(0, Number(order.total) - Number(qty) * Number(unit_price));
    await conn.query('UPDATE orders SET total = ? WHERE id = ?', [newTotal, order.id]);
    await conn.commit();
    res.json({ ok: true, newTotal });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

router.post('/:id/reopen', requirePermission('adisyon_duzenleme'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!order) throw new Error('Sipariş bulunamadı');
    const [[staff]] = await conn.query('SELECT name FROM users WHERE id = ?', [req.userId]);
    await conn.query('DELETE FROM order_payments WHERE order_id = ?', [order.id]);
    await conn.query(
      'UPDATE orders SET status = ?, pay_label = NULL, reopened_count = reopened_count + 1, last_reopened_by = ?, last_reopened_at = NOW() WHERE id = ?',
      ['open', staff ? staff.name : 'Bilinmiyor', order.id]
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: 'Sipariş yeniden açılamadı', detail: e.message });
  } finally {
    conn.release();
  }
});

// Anlık/son siparişler — patron uygulaması ve panel bunu polling ile çekebilir
router.get('/', async (req, res) => {
  const { since, limit, status } = req.query;
  let sql = `SELECT o.*, t.name as table_name FROM orders o LEFT JOIN tables t ON t.id = o.table_id WHERE o.tenant_id = ?`;
  const params = [req.tenantId];
  if (since) { sql += ' AND o.created_at > ?'; params.push(since); }
  if (status) { sql += ' AND o.status = ?'; params.push(status); }
  sql += ' ORDER BY o.created_at DESC LIMIT ?';
  params.push(Number(limit) || 50);
  const [orders] = await pool.query(sql, params);

  if (orders.length > 0) {
    const orderIds = orders.map(o => o.id);
    const [items] = await pool.query(
      `SELECT order_id, product_name, size_label, qty, unit_price, discount_type, discount_value FROM order_items WHERE order_id IN (?)`,
      [orderIds]
    );
    const [payRows] = await pool.query(
      `SELECT order_id, COALESCE(SUM(amount),0) as paid FROM order_payments WHERE order_id IN (?) GROUP BY order_id`,
      [orderIds]
    );
    const paidByOrder = {}; payRows.forEach(p => paidByOrder[p.order_id] = Number(p.paid));
    orders.forEach(o => {
      o.items = items.filter(it => it.order_id === o.id);
      o.item_qty_total = o.items.reduce((s, it) => s + it.qty, 0);
      o.paid_total = paidByOrder[o.id] || 0;
    });
  }
  res.json(orders);
});

// QR menüden gelen bekleyen siparişler — kasa/panel bunu polling ile çeker
router.get('/qr-incoming', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT qo.*, t.name as table_name FROM qr_orders qo
     LEFT JOIN tables t ON t.id = qo.table_id
     WHERE qo.tenant_id = ? AND qo.status = 'yeni'
     ORDER BY qo.created_at ASC`,
    [req.tenantId]
  );
  res.json(rows);
});

router.patch('/qr-incoming/:id', async (req, res) => {
  const { status } = req.body; // 'hazirlaniyor' | 'tamamlandi' | 'iptal'
  await pool.query('UPDATE qr_orders SET status = ? WHERE id = ? AND tenant_id = ?', [status, req.params.id, req.tenantId]);
  res.json({ ok: true });
});

// Kasa uygulamasının, sipariş girilirken müşteri ekranına anlık yansıtmak için
// çağıracağı uç nokta — sepet her değiştiğinde buraya güncel hali gönderilir
router.put('/live-cart', async (req, res) => {
  const { items, total, sequence } = req.body; // items: [{name,size,qty,unitPrice,discount,lineTotal}]
  // ÖNEMLİ: "sequence" (sıra numarası) ile geç gelen eski bir isteğin, yeni
  // (daha büyük sıra numaralı) bir isteğin üzerine yazmasını SUNUCU tarafında
  // kesin olarak engelliyoruz — istemci tarafındaki iptal (AbortController)
  // tek başına yeterli değildi, ağ üzerinde sıralama garantisi yoktu.
  const seq = Number(sequence) || 0;
  await pool.query(
    `INSERT INTO live_cart (tenant_id, items, total, sequence) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       items = IF(VALUES(sequence) >= sequence, VALUES(items), items),
       total = IF(VALUES(sequence) >= sequence, VALUES(total), total),
       sequence = IF(VALUES(sequence) >= sequence, VALUES(sequence), sequence),
       updated_at = IF(VALUES(sequence) >= sequence, NOW(), updated_at)`,
    [req.tenantId, JSON.stringify(items || []), total || 0, seq]
  );
  res.json({ ok: true });
});

// Kasa programı çökse/kapansa bile, henüz resmi bir siparişe dönüşmemiş
// (sunucuda "open" olarak açılmamış) sepeti geri yükleyebilmek için — sadece
// az önce yazdığımız aynı canlı sepet verisini geri okuyor.
router.get('/live-cart-mine', async (req, res) => {
  const [[row]] = await pool.query('SELECT items, updated_at FROM live_cart WHERE tenant_id = ?', [req.tenantId]);
  if (!row) return res.json({ items: [] });
  // 30 dakikadan eski bir canlı sepeti geri yüklemek riskli (muhtemelen zaten
  // unutulmuş/alakasız) — sadece yakın zamanlı olanı geri veriyoruz.
  const ageMs = Date.now() - new Date(row.updated_at).getTime();
  if (ageMs > 30 * 60 * 1000) return res.json({ items: [] });
  const items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
  res.json({ items: items || [] });
});

// Tek bir siparişin tam detayı — önceki adisyonu görüntüleme/yazdırma için
router.get('/:id', async (req, res) => {
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
  const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [req.params.id]);
  const [payments] = await pool.query('SELECT * FROM order_payments WHERE order_id = ? ORDER BY created_at', [req.params.id]);
  res.json({ ...order, items, payments });
});

export default router;
