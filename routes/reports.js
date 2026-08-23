import express from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { requireAuth, requireFeature } from '../middleware/auth.js';
import { broadcastMenuChanged } from '../sseHub.js';
import { generateImageWithGemini, buildProductImagePrompt } from '../geminiImage.js';
import { saveBase64ImageIfNeeded } from '../imageStorage.js';
import { businessDayStartUtc } from '../dayCloseAuto.js';
import { aiLimiter } from '../rateLimiters.js';
import { appendRow } from '../googleSheets.js';

const router = express.Router();
router.use(requireAuth);

// Patron uygulamasının anlık göreceği özet
router.get('/summary', async (req, res) => {
  const [[today]] = await pool.query(
    `SELECT COUNT(*) as order_count, COALESCE(SUM(total),0) as revenue
     FROM orders WHERE tenant_id = ? AND DATE(created_at) = CURDATE()`,
    [req.tenantId]
  );
  const [[week]] = await pool.query(
    `SELECT COALESCE(SUM(total),0) as revenue
     FROM orders WHERE tenant_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
    [req.tenantId]
  );
  const [[month]] = await pool.query(
    `SELECT COALESCE(SUM(total),0) as revenue
     FROM orders WHERE tenant_id = ? AND MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())`,
    [req.tenantId]
  );
  res.json({
    today_orders: today.order_count,
    today_revenue: today.revenue,
    week_revenue: week.revenue,
    month_revenue: month.revenue,
  });
});

// Tarih aralığına göre ödeme tipi / kategori kırılımı
router.get('/breakdown', async (req, res) => {
  const { start, end } = req.query;
  const [byPay] = await pool.query(
    `SELECT pay_label, COUNT(*) as qty, SUM(total) as amount
     FROM orders WHERE tenant_id = ? AND created_at BETWEEN ? AND ?
     GROUP BY pay_label`,
    [req.tenantId, start, end]
  );
  res.json({ byPay });
});

// Seçilen ay/tarih aralığı için maliyet oranı — ürün reçetelerindeki malzeme
// fiyatlarına göre otomatik hesaplanır
router.get('/cost-summary', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start ve end tarihleri gerekli' });
  try {
    const [[rev]] = await pool.query(
      `SELECT COALESCE(SUM(total),0) as revenue, COUNT(*) as orderCount
       FROM orders WHERE tenant_id = ? AND created_at BETWEEN ? AND ?`,
      [req.tenantId, start, end]
    );
    const [costMap] = await pool.query(
      `SELECT p.name, COALESCE(SUM(pi.quantity * i.unit_price), 0) as cost
       FROM products p
       LEFT JOIN product_ingredients pi ON pi.product_id = p.id
       LEFT JOIN ingredients i ON i.id = pi.ingredient_id
       WHERE p.tenant_id = ?
       GROUP BY p.id, p.name`,
      [req.tenantId]
    );
    const costByName = {};
    costMap.forEach(c => { costByName[c.name.toLowerCase()] = Number(c.cost); });

    const [items] = await pool.query(
      `SELECT oi.product_name, oi.qty FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.tenant_id = ? AND o.created_at BETWEEN ? AND ?`,
      [req.tenantId, start, end]
    );
    let totalCost = 0, matchedItemCount = 0, unmatchedItemCount = 0;
    items.forEach(it => {
      const unitCost = costByName[(it.product_name || '').toLowerCase()];
      if (unitCost !== undefined) { totalCost += unitCost * it.qty; matchedItemCount++; }
      else unmatchedItemCount++;
    });

    const revenue = Number(rev.revenue);
    const costRatio = revenue > 0 ? (totalCost / revenue) * 100 : 0;
    const marginRatio = 100 - costRatio;
    res.json({
      revenue, totalCost, costRatio, marginRatio,
      orderCount: rev.orderCount, matchedItemCount, unmatchedItemCount
    });
  } catch (e) {
    res.status(500).json({ error: 'Maliyet hesaplanamadı', detail: e.message });
  }
});

// ---- AI Veri Analisti — sohbet ederek satış verilerini yorumlatma ----
router.post('/ai-insights', requireFeature('ai_assistant'), async (req, res) => {
  const { messages } = req.body; // [{role:'user'|'assistant', content:'...'}]
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'AI asistanı henüz aktif değil — sunucuda ANTHROPIC_API_KEY tanımlı değil. Hostinger → Ortam Değişkenleri kısmından ekleyin.' });
  }
  if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'Mesaj gerekli' });

  try {
    const now = new Date();
    const start30 = new Date(now.getTime() - 30*24*3600*1000);
    const start60 = new Date(now.getTime() - 60*24*3600*1000);

    const [[cur30]] = await pool.query(
      `SELECT COUNT(*) as orderCount, COALESCE(SUM(total),0) as revenue, COALESCE(AVG(total),0) as avgTicket
       FROM orders WHERE tenant_id = ? AND created_at >= ?`, [req.tenantId, start30]
    );
    const [[prev30]] = await pool.query(
      `SELECT COUNT(*) as orderCount, COALESCE(SUM(total),0) as revenue
       FROM orders WHERE tenant_id = ? AND created_at >= ? AND created_at < ?`, [req.tenantId, start60, start30]
    );
    const [dailyRevenue] = await pool.query(
      `SELECT DATE(created_at) as day, COALESCE(SUM(total),0) as revenue, COUNT(*) as orders
       FROM orders WHERE tenant_id = ? AND created_at >= ?
       GROUP BY DATE(created_at) ORDER BY day`, [req.tenantId, start30]
    );
    const [byPay] = await pool.query(
      `SELECT pay_label, COUNT(*) as qty, SUM(total) as amount
       FROM orders WHERE tenant_id = ? AND created_at >= ? GROUP BY pay_label`, [req.tenantId, start30]
    );
    const [topProducts] = await pool.query(
      `SELECT oi.product_name, SUM(oi.qty) as totalQty, SUM(oi.qty * oi.unit_price) as totalRevenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.tenant_id = ? AND o.created_at >= ?
       GROUP BY oi.product_name ORDER BY totalRevenue DESC LIMIT 10`, [req.tenantId, start30]
    );
    const [hourly] = await pool.query(
      `SELECT HOUR(created_at) as hr, COUNT(*) as orders FROM orders
       WHERE tenant_id = ? AND created_at >= ? GROUP BY HOUR(created_at) ORDER BY orders DESC LIMIT 5`,
      [req.tenantId, start30]
    );

    let costInfo = null;
    try {
      const [[rev]] = await pool.query(`SELECT COALESCE(SUM(total),0) as revenue FROM orders WHERE tenant_id = ? AND created_at >= ?`, [req.tenantId, start30]);
      const [costMap] = await pool.query(
        `SELECT p.name, COALESCE(SUM(pi.quantity * i.unit_price), 0) as cost FROM products p
         LEFT JOIN product_ingredients pi ON pi.product_id = p.id LEFT JOIN ingredients i ON i.id = pi.ingredient_id
         WHERE p.tenant_id = ? GROUP BY p.id, p.name`, [req.tenantId]
      );
      const costByName = {}; costMap.forEach(c => costByName[c.name.toLowerCase()] = Number(c.cost));
      const [items] = await pool.query(
        `SELECT oi.product_name, oi.qty FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.tenant_id = ? AND o.created_at >= ?`, [req.tenantId, start30]
      );
      let totalCost = 0;
      items.forEach(it => { const c = costByName[(it.product_name||'').toLowerCase()]; if (c !== undefined) totalCost += c * it.qty; });
      const revenue = Number(rev.revenue);
      if (revenue > 0) costInfo = { totalCost, costRatioPct: (totalCost/revenue*100).toFixed(1), marginRatioPct: (100-(totalCost/revenue*100)).toFixed(1) };
    } catch(e) { /* maliyet verisi yoksa sessizce geç */ }

    const [[tRow]] = await pool.query('SELECT name FROM tenants WHERE id = ?', [req.tenantId]);

    const dataSnapshot = {
      isletme: tRow ? tRow.name : '',
      son30Gun: {
        siparisSayisi: cur30.orderCount, ciro: Number(cur30.revenue).toFixed(2), ortalamaFisTutari: Number(cur30.avgTicket).toFixed(2)
      },
      oncekiDonemKarsilastirma: {
        oncekiSiparisSayisi: prev30.orderCount, oncekiCiro: Number(prev30.revenue).toFixed(2),
        ciroDegisimYuzde: prev30.revenue > 0 ? (((cur30.revenue - prev30.revenue) / prev30.revenue) * 100).toFixed(1) : null
      },
      gunlukCiroSon30Gun: dailyRevenue.map(d => ({ tarih: d.day, ciro: Number(d.revenue).toFixed(2), siparis: d.orders })),
      odemeYontemiKirilimi: byPay.map(p => ({ yontem: p.pay_label, adet: p.qty, tutar: Number(p.amount).toFixed(2) })),
      enCokSatanUrunler: topProducts.map(p => ({ urun: p.product_name, adet: p.totalQty, ciro: Number(p.totalRevenue).toFixed(2) })),
      enYogunSaatler: hourly.map(h => ({ saat: h.hr, siparisSayisi: h.orders })),
      maliyetVeKarMarji: costInfo
    };

    const systemPrompt = `Sen deneyimli bir veri analistisin ve bir kahve dükkanı/kafe işletmecisinin DurakPOS panelindeki AI Asistanısın. Görevin, aşağıdaki gerçek satış verilerini yorumlamak, işletme sahibine net ve uygulanabilir öneriler sunmak, sorularını cevaplamak ve satışlarını artırmasına yardımcı olmaktır.

İşletmenin son 30 günlük verisi (JSON):
${JSON.stringify(dataSnapshot)}

Kurallar:
- Türkçe, samimi ama profesyonel bir dille konuş — bir danışman gibi.
- Sayılara dayan, verideki gerçek rakamları kullan, uydurma.
- Kısa ve net cevaplar ver, gereksiz uzatma; madde işaretleri kullanabilirsin.
- Fırsat gördüğün yerlerde (düşük saatler, az satan ürünler, yüksek maliyetli ürünler vb.) proaktif öneri sun, sadece soru bekleme.
- Veri yetersizse (örn. maliyet verisi yoksa) bunu nazikçe belirt, tahmin uydurma.`;

    const cleanMessages = messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20);

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1200, system: systemPrompt, messages: cleanMessages })
    });
    const aiData = await aiRes.json();
    if (!aiRes.ok) return res.status(500).json({ error: 'AI isteği başarısız', detail: aiData.error?.message || JSON.stringify(aiData) });
    const reply = (aiData.content || []).map(b => b.text || '').join('').trim();
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: 'Analiz alınamadı', detail: e.message });
  }
});

// Kasa içinden çağrılan, Kardo'daki gibi özet kartlar + kategori/ödeme
// tipi kırılımlı rapor — sadece gerçekten takip ettiğimiz verilerle
router.get('/kasa-report', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start ve end tarihleri gerekli' });
  // Gelen tarih/saat, kasa ekranında Türkiye saatine göre gösterilen ve
  // girilen değer — burada "Z" ekleyip UTC gibi ayrıştırıp, sonra gerçek
  // UTC karşılığına çeviriyoruz (Türkiye = UTC+3). Böylece panelde "10:00"
  // yazan saat, veritabanındaki UTC kayıtlarıyla doğru eşleşiyor.
  const startUtc = parseReportDate(start);
  const endUtc = parseReportDate(end);
  try {
    const [items] = await pool.query(
      `SELECT oi.*, o.pay_label FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.tenant_id = ? AND o.created_at BETWEEN ? AND ?`,
      [req.tenantId, startUtc, endUtc]
    );
    const [payments] = await pool.query(
      `SELECT op.* FROM order_payments op JOIN orders o ON o.id = op.order_id
       WHERE o.tenant_id = ? AND op.created_at BETWEEN ? AND ?`,
      [req.tenantId, startUtc, endUtc]
    );
    const [products] = await pool.query('SELECT p.name, c.group_name, c.name as cat_name FROM products p JOIN categories c ON c.id = p.category_id WHERE p.tenant_id = ?', [req.tenantId]);
    const catByProductName = {};
    products.forEach(p => { catByProductName[p.name.toLowerCase()] = p.group_name + ' / ' + p.cat_name; });

    let toplamUrunAdedi = 0, toplamUrunTutari = 0, indirimTutari = 0;
    const kategoriMap = {};
    items.forEach(it => {
      const lineGross = Number(it.unit_price) * it.qty;
      let discount = 0;
      if (it.discount_type === 'percent') discount = lineGross * Number(it.discount_value) / 100;
      else if (it.discount_type === 'amount') discount = Number(it.discount_value);
      toplamUrunAdedi += it.qty;
      toplamUrunTutari += lineGross;
      indirimTutari += discount;
      const cat = catByProductName[(it.product_name||'').toLowerCase()] || 'Diğer';
      if (!kategoriMap[cat]) kategoriMap[cat] = { adet: 0, tutar: 0 };
      kategoriMap[cat].adet += it.qty;
      kategoriMap[cat].tutar += (lineGross - discount);
    });

    const odemeTipiMap = {};
    let odemeTutari = 0;
    payments.forEach(p => {
      odemeTutari += Number(p.amount);
      if (!odemeTipiMap[p.pay_label]) odemeTipiMap[p.pay_label] = { adet: 0, tutar: 0 };
      odemeTipiMap[p.pay_label].adet += 1;
      odemeTipiMap[p.pay_label].tutar += Number(p.amount);
    });

    const netToplam = toplamUrunTutari - indirimTutari;
    const kategoriKirilimi = Object.entries(kategoriMap).map(([kategori, v]) => ({
      kategori, adet: v.adet, tutar: v.tutar, oran: netToplam > 0 ? (v.tutar / netToplam * 100) : 0
    })).sort((a,b)=>b.tutar-a.tutar);
    const odemeTipiKirilimi = Object.entries(odemeTipiMap).map(([tip, v]) => ({
      tip, adet: v.adet, tutar: v.tutar, oran: odemeTutari > 0 ? (v.tutar / odemeTutari * 100) : 0
    })).sort((a,b)=>b.tutar-a.tutar);

    // Net Toplam ile Tahsil Edilen arasındaki fark genelde açık (henüz ödenmemiş)
    // hesaplardan kaynaklanır — burada listeleyip kasiyerin hemen görmesini
    // sağlıyoruz, ayrı bir uygulamaya gitmesine gerek kalmadan.
    const [openOrders] = await pool.query(
      `SELECT o.id, o.daily_number, o.total, o.created_at, t.name as table_name FROM orders o
       LEFT JOIN tables t ON t.id = o.table_id
       WHERE o.tenant_id = ? AND o.status = 'open' ORDER BY o.created_at ASC`,
      [req.tenantId]
    );

    res.json({
      toplamUrunAdedi, toplamUrunTutari, indirimTutari, netToplam,
      odemeAdedi: payments.length, odemeTutari,
      kategoriKirilimi, odemeTipiKirilimi,
      acikHesaplar: openOrders.map(o => ({ id: o.id, dailyNumber: o.daily_number || o.id, masa: o.table_name || 'Self Servis', tutar: Number(o.total), tarih: o.created_at })),
    });
  } catch (e) {
    res.status(500).json({ error: 'Rapor alınamadı', detail: e.message });
  }
});

// Detaylı rapor — personel bazlı satış + günlük/aylık kırılım (panelin
// "Raporlar" sayfasında kullanılır, "en ince ayrıntısına kadar" görüş sağlar)
router.get('/detailed', async (req, res) => {
  const { start, end, groupBy } = req.query; // groupBy: 'day' | 'month'
  if (!start || !end) return res.status(400).json({ error: 'start ve end tarihleri gerekli' });
  try {
    // Personel bazlı: kim, kaç sipariş, kaç ürün, ne kadar ciro yaptı
    const [byStaff] = await pool.query(
      `SELECT u.id as staff_id, u.name as staff_name,
              COUNT(DISTINCT o.id) as order_count,
              COALESCE(SUM(oi.qty), 0) as item_count,
              COALESCE(SUM(o.total), 0) as revenue
       FROM orders o
       LEFT JOIN users u ON u.id = o.staff_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.tenant_id = ? AND o.created_at BETWEEN ? AND ?
       GROUP BY u.id, u.name
       ORDER BY revenue DESC`,
      [req.tenantId, start, end]
    );
    // Fix: SUM(o.total) çoklanıyor olabilir (order_items join'i order başına birden fazla satır
    // getirdiği için) — ciroyu ayrı, temiz bir sorgudan alalım
    const [orderTotals] = await pool.query(
      `SELECT staff_id, COUNT(*) as order_count, COALESCE(SUM(total),0) as revenue
       FROM orders WHERE tenant_id = ? AND created_at BETWEEN ? AND ? GROUP BY staff_id`,
      [req.tenantId, start, end]
    );
    const revenueByStaff = {};
    orderTotals.forEach(r => { revenueByStaff[r.staff_id || 'null'] = { order_count: r.order_count, revenue: Number(r.revenue) }; });
    const staffBreakdown = byStaff.map(s => ({
      staff_id: s.staff_id,
      staff_name: s.staff_name || 'Bilinmiyor',
      order_count: revenueByStaff[s.staff_id || 'null']?.order_count || 0,
      item_count: Number(s.item_count),
      revenue: revenueByStaff[s.staff_id || 'null']?.revenue || 0,
    }));

    // Günlük veya aylık kırılım
    const dateFmt = groupBy === 'month' ? '%Y-%m' : '%Y-%m-%d';
    const [byDate] = await pool.query(
      `SELECT DATE_FORMAT(created_at, ?) as period, COUNT(*) as order_count, COALESCE(SUM(total),0) as revenue
       FROM orders WHERE tenant_id = ? AND created_at BETWEEN ? AND ?
       GROUP BY period ORDER BY period`,
      [dateFmt, req.tenantId, start, end]
    );

    res.json({
      staffBreakdown,
      dateBreakdown: byDate.map(d => ({ period: d.period, order_count: d.order_count, revenue: Number(d.revenue) }))
    });
  } catch (e) {
    res.status(500).json({ error: 'Rapor alınamadı', detail: e.message });
  }
});

// Patron (mobil izleme) uygulaması için kapsamlı özet — tarih aralığına göre
// ciro, adisyon, ortalama hesap, açık çek, indirim, hesap başı ürün + trend grafiği
// Sunucu UTC saatinde çalışıyor olabilir, ama işletmeler Türkiye saatinde (UTC+3,
// yaz/kış saati uygulaması yok) çalışıyor — "Bugün/Dün/Hafta/Ay" hesaplarken
// sunucunun kendi saat dilimini değil, hep Türkiye saatini esas alıyoruz.
const TR_OFFSET_MS = 3 * 3600 * 1000;
function trFrame(realDate) { return new Date(realDate.getTime() + TR_OFFSET_MS); }
function trToReal(trFrameDate) { return new Date(trFrameDate.getTime() - TR_OFFSET_MS); }
// Rapor uç noktalarına iki farklı yerden iki farklı formatta tarih geliyor:
// Kasa saf Türkiye saati basamıklarını gönderiyor ("2026-08-16T10:00", Z'siz),
// Patron uygulaması ise zaten doğru UTC anını gönderiyor ("...T07:00:00.000Z").
// Bu fonksiyon ikisini de doğru ayırt edip gerçek UTC karşılığını döner.
function parseReportDate(str) {
  if (/[Zz]$/.test(str) || /[+-]\d{2}:?\d{2}$/.test(str)) return new Date(str);
  return trToReal(new Date(str + 'Z'));
}
function trDayStart(realDate) {
  const tf = trFrame(realDate);
  tf.setUTCHours(0, 0, 0, 0);
  return trToReal(tf);
}
function trMonthStart(realDate) {
  const tf = trFrame(realDate);
  return trToReal(new Date(Date.UTC(tf.getUTCFullYear(), tf.getUTCMonth(), 1, 0, 0, 0, 0)));
}

router.get('/patron-dashboard', async (req, res) => {
  const { range, start, end } = req.query;
  const now = new Date();
  const [[tenantRow]] = await pool.query('SELECT opening_time FROM tenants WHERE id = ?', [req.tenantId]);
  const todayBizStart = businessDayStartUtc(now, tenantRow?.opening_time);
  let s, e, groupBy;
  if (start && end) {
    s = new Date(start); e = new Date(end);
    groupBy = (e - s) > 3 * 24 * 3600 * 1000 ? 'day' : 'hour';
  } else {
    switch (range) {
      case 'yesterday': {
        s = new Date(todayBizStart.getTime() - 24 * 3600 * 1000);
        e = new Date(todayBizStart.getTime() - 1);
        groupBy = 'hour'; break;
      }
      case 'week': {
        s = new Date(todayBizStart.getTime() - 6 * 24 * 3600 * 1000);
        e = now; groupBy = 'day'; break;
      }
      case 'month': {
        s = trMonthStart(now);
        e = now; groupBy = 'day'; break;
      }
      default: {
        s = todayBizStart;
        e = now; groupBy = 'hour';
      }
    }
  }
  try {
    const [[totals]] = await pool.query(
      `SELECT COUNT(*) as order_count, COALESCE(SUM(total),0) as revenue
       FROM orders WHERE tenant_id = ? AND status = 'closed' AND created_at BETWEEN ? AND ?`,
      [req.tenantId, s, e]
    );
    const [[openInfo]] = await pool.query(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as tutar FROM orders WHERE tenant_id = ? AND status = 'open'`,
      [req.tenantId]
    );
    const [[itemInfo]] = await pool.query(
      `SELECT COALESCE(SUM(oi.qty),0) as item_count,
              COALESCE(SUM(CASE WHEN oi.discount_type='percent' THEN oi.unit_price*oi.qty*oi.discount_value/100
                                 WHEN oi.discount_type='amount' THEN oi.discount_value ELSE 0 END),0) as discount_total
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.tenant_id = ? AND o.created_at BETWEEN ? AND ?`,
      [req.tenantId, s, e]
    );
    const dateFmt = groupBy === 'hour' ? '%H:00' : '%m/%d';
    const [trend] = await pool.query(
      `SELECT DATE_FORMAT(created_at, ?) as period, COALESCE(SUM(total),0) as revenue, MIN(created_at) as first_at
       FROM orders WHERE tenant_id = ? AND status = 'closed' AND created_at BETWEEN ? AND ?
       GROUP BY period ORDER BY first_at`,
      [dateFmt, req.tenantId, s, e]
    );

    res.json({
      revenue: Number(totals.revenue),
      orderCount: totals.order_count,
      avgTicket: totals.order_count > 0 ? Number(totals.revenue) / totals.order_count : 0,
      openCheckCount: openInfo.cnt,
      openCheckAmount: Number(openInfo.tutar),
      discountTotal: Number(itemInfo.discount_total),
      itemsPerCheck: totals.order_count > 0 ? Number(itemInfo.item_count) / totals.order_count : 0,
      trend: trend.map(t => ({ period: t.period, revenue: Number(t.revenue) })),
      rangeStart: s, rangeEnd: e
    });
  } catch (e) {
    res.status(500).json({ error: 'Veri alınamadı', detail: e.message });
  }
});

// ============================================================
// AI ASİSTAN — ARAÇ KULLANABİLEN (TOOL-USE) AJAN
// ============================================================
// Sadece soru cevaplamıyor — "bu ürünü ekle", "şu gideri kaydet", "tüm
// ürünlere büyük boy ekle" gibi talimatları GERÇEKTEN uyguluyor.
// Fotoğraftan stok/miktar OKUMA (tedarik fişi OCR) şimdilik kapsam dışı —
// güvenilirliği test edilmeden canlıya alınmadı, ayrı bir aşamada eklenecek.

const AGENT_TOOLS = [
  {
    name: 'add_product',
    description: 'Menüye yeni bir ürün ekler. Kategori yoksa otomatik oluşturulur. Kullanıcı bir fotoğraf gönderdiyse o fotoğraf otomatik ürün fotoğrafı olarak kullanılır. Market modu açık işletmelerde barkod/stok/kilogram bilgisi de girilebilir.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Ürünün adı' },
        group_name: { type: 'string', description: 'Üst kategori, örn: Yiyecekler, İçecekler' },
        category_name: { type: 'string', description: 'Alt kategori, örn: Pastalar, Soğuk İçecekler' },
        price: { type: 'number', description: 'Fiyat (TL) — kilogram ile satılan ürünlerde kg başına fiyat' },
        size_label: { type: 'string', description: 'Boyut adı — belirtilmezse "Tek Boy" kullanılır, kg ile satılanlarda "kg" kullan' },
        barcode: { type: 'string', description: 'Ürün barkodu (yalnızca market modunda anlamlı)' },
        sale_type: { type: 'string', enum: ['adet', 'kg'], description: 'Adet mi yoksa kilogram ile mi satılıyor — belirtilmezse "adet"' },
        stock_qty: { type: 'number', description: 'Mevcut stok miktarı — belirtilmezse stok takibi yapılmaz' },
        low_stock_threshold: { type: 'number', description: 'Bu miktarın altına inince uyarı verilsin' },
        vat_rate: { type: 'number', enum: [1, 8, 10, 20], description: 'KDV oranı — Türkiye\'de geçerli oranlar: %1, %8, %10, %20. Kullanıcı belirtmezse gönderme, otomatik %10 uygulanır.' },
      },
      required: ['name', 'group_name', 'category_name', 'price'],
    },
  },
  {
    name: 'update_product',
    description: 'Mevcut bir ürünü düzenler — adını, fiyatını, kategorisini, barkodunu, stok bilgisini değiştirir veya aktif/pasif yapar. Kullanıcı fotoğraf gönderdiyse ürün fotoğrafını da günceller. Sadece değiştirilecek alanları gönder, diğerlerini boş bırak.',
    input_schema: {
      type: 'object',
      properties: {
        product_name: { type: 'string', description: 'Düzenlenecek ürünün MEVCUT adı (aramak için)' },
        new_name: { type: 'string', description: 'Yeni ad (değiştirilmeyecekse gönderme)' },
        new_price: { type: 'number', description: 'Yeni fiyat — ürünün ilk/tek boyutuna uygulanır' },
        size_label: { type: 'string', description: 'Fiyatı değiştirilecek boy adı (birden fazla boyu olan ürünlerde) — belirtilmezse ilk boy' },
        new_group_name: { type: 'string', description: 'Yeni üst kategori (kategori değiştirilecekse)' },
        new_category_name: { type: 'string', description: 'Yeni alt kategori (kategori değiştirilecekse)' },
        barcode: { type: 'string', description: 'Yeni barkod' },
        sale_type: { type: 'string', enum: ['adet', 'kg'], description: 'Satış şeklini değiştir' },
        stock_qty: { type: 'number', description: 'Stok miktarını güncelle' },
        low_stock_threshold: { type: 'number', description: 'Düşük stok uyarı eşiğini güncelle' },
        vat_rate: { type: 'number', enum: [1, 8, 10, 20], description: 'KDV oranını değiştir — Türkiye\'de geçerli oranlar: %1, %8, %10, %20. Kullanıcı belirtmezse dokunma, varsayılan zaten %10.' },
        active: { type: 'boolean', description: 'Ürünü aktif/pasif yap (menüden gizle/göster)' },
      },
      required: ['product_name'],
    },
  },
  {
    name: 'delete_product',
    description: 'Bir ürünü menüden tamamen siler.',
    input_schema: {
      type: 'object',
      properties: { product_name: { type: 'string' } },
      required: ['product_name'],
    },
  },
  {
    name: 'add_category',
    description: 'Yeni bir üst/alt kategori oluşturur (henüz ürün eklemeden).',
    input_schema: {
      type: 'object',
      properties: {
        group_name: { type: 'string', description: 'Üst kategori, örn: Yiyecekler' },
        category_name: { type: 'string', description: 'Alt kategori, örn: Tatlılar' },
      },
      required: ['group_name', 'category_name'],
    },
  },
  {
    name: 'rename_category',
    description: 'Bir alt kategorinin adını değiştirir.',
    input_schema: {
      type: 'object',
      properties: {
        group_name: { type: 'string' },
        old_category_name: { type: 'string' },
        new_category_name: { type: 'string' },
      },
      required: ['group_name', 'old_category_name', 'new_category_name'],
    },
  },
  {
    name: 'delete_category',
    description: 'Bir alt kategoriyi ve içindeki TÜM ürünleri siler. Dikkatli kullan, geri alınamaz.',
    input_schema: {
      type: 'object',
      properties: { group_name: { type: 'string' }, category_name: { type: 'string' } },
      required: ['group_name', 'category_name'],
    },
  },
  {
    name: 'list_menu',
    description: 'Mevcut menünün tamamını (kategoriler, ürünler, fiyatlar) getirir — kullanıcı menüyü incelemeni veya menü hakkında bilgi vermeni istediğinde çağır.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'log_expense',
    description: 'Bir gideri (personele ödeme, tedarikçiye ödeme, kira vb.) kaydeder.',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Örn: "Deniz\'e maaş ödemesi"' },
        amount: { type: 'number' },
        category: { type: 'string', description: 'Örn: Personel, Tedarikçi, Kira, Genel' },
      },
      required: ['description', 'amount'],
    },
  },
  {
    name: 'log_to_sheet',
    description: 'Kullanıcının söylediği SERBEST bir notu (maaş ödemesi, gelen ürün, firma notu, herhangi bir kayıt) işletmenin bağlı olduğu Google E-Tablosuna yeni bir satır olarak ekler. Kullanıcı "not al", "kaydet", "tabloya ekle" gibi bir şey demeden de, doğal konuşma içinde bir kayıt niteliği taşıyan bilgi verirse (örn. "Kuzey\'e 1000 TL maaş ödedim", "ABC firmasından 50 kutu su geldi") bu aracı kullan. Kategoriyi konuşmanın içeriğine göre SEN belirle (örn. "Maaş Ödemesi", "Gelen Ürün", "Firma Notu", "Ödeme").',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Örn: Maaş Ödemesi, Gelen Ürün, Firma Notu, Ödeme — kendi belirle' },
        description: { type: 'string', description: 'Kaydın kendisi, örn: "Kuzey\'e maaş ödemesi"' },
        amount: { type: 'number', description: 'Varsa bir tutar (TL) — yoksa boş bırak' },
      },
      required: ['category', 'description'],
    },
  },
  {
    name: 'add_size_to_all_products',
    description: 'Tüm ürünlere (bu boyu henüz olmayanlara) yeni bir boy seçeneği ekler — her ürünün mevcut en yüksek fiyatına belirtilen farkı ekleyerek yeni fiyat hesaplar.',
    input_schema: {
      type: 'object',
      properties: {
        size_label: { type: 'string', description: 'Örn: Ekstra Büyük' },
        price_delta: { type: 'number', description: 'Mevcut en yüksek fiyata eklenecek TL farkı' },
      },
      required: ['size_label', 'price_delta'],
    },
  },
  {
    name: 'delete_product_size',
    description: 'Belirli BİR üründeki belirli bir boyu (örn. yanlışlıkla eklenmiş "Ekstra Büyük" boyunu) siler. Ürünün son/tek boyu siliniyorsa reddeder — her ürünün en az bir boyu olmak zorunda.',
    input_schema: {
      type: 'object',
      properties: {
        product_name: { type: 'string' },
        size_label: { type: 'string', description: 'Silinecek boyun adı, örn: Ekstra Büyük' },
      },
      required: ['product_name', 'size_label'],
    },
  },
  {
    name: 'delete_size_from_all_products',
    description: 'Belirli bir boy etiketini (örn. yanlışlıkla tüm ürünlere eklenmiş "Ekstra Büyük" boyunu), o boya sahip TÜM ürünlerden birden siler. Bir ürünün son/tek boyuysa o üründe atlar, silmez.',
    input_schema: {
      type: 'object',
      properties: {
        size_label: { type: 'string', description: 'Örn: Ekstra Büyük' },
      },
      required: ['size_label'],
    },
  },
  {
    name: 'get_report_summary',
    description: 'Belirli bir dönem için ciro, sipariş sayısı ve en çok satan ürünleri getirir. Basit "bugün ne kadar ciro yaptık" gibi sorular için yeterli — trend/karşılaştırma/analiz istenirse onun yerine analyze_sales_trends kullan.',
    input_schema: {
      type: 'object',
      properties: { period: { type: 'string', enum: ['today', 'yesterday', 'week', 'month'] } },
      required: ['period'],
    },
  },
  {
    name: 'analyze_sales_trends',
    description: 'Bir tarih aralığındaki ÜRÜN BAZLI satış verisini (gün/hafta/ay kırılımında, sen seçersin) ve o aralıktaki indirim/kampanya kayıtlarını birlikte döner — bu veriyle kendin gerçek bir satış veri uzmanı gibi davranıp trend tespiti, dönem karşılaştırması (örn. "geçen ay ile bu ay", "kampanya öncesi ve sonrası aylar") ve korelasyon (örn. "X indirimi başlayınca Y ürününün satışı zamanla düştü, Z ürününün arttı") yapabilirsin. Kullanıcı "analiz et", "karşılaştır", "geçen ayla bu ay arasındaki fark", "kampanyadan sonra ne değişti" gibi bir şey istediğinde bunu kullan, get_report_summary yerine. Kısa aralıklarda (birkaç hafta) group_by="day", birkaç ay için "week", bir yıla yakın/aşan aralıklar için "month" kullan — aksi halde çok fazla satır dönüp veri okunması zorlaşır.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'YYYY-MM-DD formatında başlangıç' },
        end_date: { type: 'string', description: 'YYYY-MM-DD formatında bitiş' },
        group_by: { type: 'string', enum: ['day', 'week', 'month'], description: 'Veri hangi dönemlere göre gruplanacak — kısa aralıklarda "day", aylar arası karşılaştırmada "week" veya "month" kullan.' },
      },
      required: ['start_date', 'end_date', 'group_by'],
    },
  },
  {
    name: 'add_staff',
    description: 'Yeni bir personel (kasa PIN\'i ile giriş yapacak) oluşturur.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Personelin adı' },
        pin: { type: 'string', description: '4 haneli kasa PIN\'i' },
      },
      required: ['name', 'pin'],
    },
  },
  {
    name: 'set_staff_panel_login',
    description: 'Bir personele (veya kendine) panel/patron/asistan girişi için e-posta+şifre tanımlar.',
    input_schema: {
      type: 'object',
      properties: {
        staff_name: { type: 'string', description: 'Hangi personel için (kasadaki adı)' },
        email: { type: 'string' },
        password: { type: 'string', description: 'En az 6 karakter' },
      },
      required: ['staff_name', 'email', 'password'],
    },
  },
  {
    name: 'list_staff',
    description: 'Tüm personel listesini (isim, rol) getirir.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_ingredients',
    description: 'İşletmenin tanımlı malzeme listesini (isim, birim, birim fiyatı) getirir — reçete oluşturmadan önce hangi malzemelerin zaten tanımlı olduğunu görmek için kullan.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'set_product_recipe',
    description: 'Bir ürünün reçetesini (o ürünü yapmak için gereken malzemeler ve miktarları) belirler/değiştirir. Malzeme henüz tanımlı değilse önce onu ekle demen gerekir — malzemeleri otomatik oluşturmaz, sadece mevcut malzemelerle eşleştirir. NOT: Bu reçete ürünün TÜMÜ için geçerlidir, boy bazında (küçük/orta/büyük için ayrı ayrı) farklı reçete şu an desteklenmiyor.',
    input_schema: {
      type: 'object',
      properties: {
        product_name: { type: 'string', description: 'Reçetesi belirlenecek ürünün adı' },
        ingredients: {
          type: 'array',
          description: 'Malzeme ve miktar listesi',
          items: {
            type: 'object',
            properties: {
              ingredient_name: { type: 'string', description: 'Malzemenin mevcut listedeki adı' },
              quantity: { type: 'number', description: 'Kullanılan miktar (malzemenin birimine göre — ml, g, adet vb.)' },
            },
            required: ['ingredient_name', 'quantity'],
          },
        },
      },
      required: ['product_name', 'ingredients'],
    },
  },
  {
    name: 'generate_product_image',
    description: 'Bir ürün için yapay zeka ile fotoğraf/görsel üretir — kullanıcı elle fotoğraf yüklemek istemediğinde kullanılır (örn. "Coca Cola resmini bul yükle" gibi bir istek geldiğinde). Ürettiğin görsel, hemen sonrasında çağıracağın add_product veya update_product aracına otomatik eklenir, ayrıca bir şey yapmana gerek yok. Marka isimli ürünlerde (Coca Cola, Fanta vb.) birebir marka logosu/şişesi kopyalamaya çalışma — o markayı çağrıştıran, tanınabilir ama stilize/jenerik bir görsel üret (telif/marka riskini azaltmak için).',
    input_schema: {
      type: 'object',
      properties: {
        product_name: { type: 'string', description: 'Görseli üretilecek ürünün adı' },
        visual_description: { type: 'string', description: 'Görselin nasıl görünmesi gerektiğine dair kısa bir tarif (renk, şekil, sunum) — ürün adından çıkaramayacağın detaylar varsa buraya ekle' },
      },
      required: ['product_name'],
    },
  },
];

function periodRange(period) {
  const now = new Date();
  if (period === 'yesterday') {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const s = new Date(y); s.setHours(0,0,0,0);
    const e = new Date(y); e.setHours(23,59,59,999);
    return [s, e];
  }
  if (period === 'week') { const s = new Date(now.getTime() - 6*24*3600*1000); s.setHours(0,0,0,0); return [s, now]; }
  if (period === 'month') { return [new Date(now.getFullYear(), now.getMonth(), 1), now]; }
  const s = new Date(now); s.setHours(0,0,0,0); return [s, now];
}

// Gemini ile ürün görseli üretir — anahtar tanımlı değilse net bir hata döner

async function executeAgentTool(tenantId, name, input, pendingImage, generatedImageRef) {
  if (name === 'generate_product_image') {
    try {
      const [[t]] = await pool.query('SELECT features FROM tenants WHERE id = ?', [tenantId]);
      const feats = t && t.features ? (typeof t.features === 'string' ? JSON.parse(t.features) : t.features) : {};
      if (feats.ai_image_generation !== true) {
        return { ok: false, error: 'Görsel üretme özelliği bu işletme paketinde henüz aktif değil.' };
      }
      const prompt = buildProductImagePrompt(input.product_name, input.visual_description);
      const b64 = await generateImageWithGemini(prompt);
      if (generatedImageRef) generatedImageRef.value = b64;
      return { ok: true, message: `"${input.product_name}" için bir görsel üretildi — şimdi add_product veya update_product aracını çağırarak ürüne ekleyebilirsin.` };
    } catch (e) {
      return { ok: false, error: 'Görsel üretilemedi: ' + e.message };
    }
  }

  if (name === 'add_product') {
    let [[cat]] = await pool.query(
      'SELECT id FROM categories WHERE tenant_id = ? AND group_name = ? AND name = ?',
      [tenantId, input.group_name, input.category_name]
    );
    let categoryId;
    if (cat) { categoryId = cat.id; }
    else {
      const [catResult] = await pool.query(
        'INSERT INTO categories (tenant_id, group_name, name) VALUES (?, ?, ?)',
        [tenantId, input.group_name, input.category_name]
      );
      categoryId = catResult.insertId;
    }
    const imageUrl = await saveBase64ImageIfNeeded(pendingImage ? `data:${pendingImage.mediaType};base64,${pendingImage.base64}` : (generatedImageRef && generatedImageRef.value ? `data:image/png;base64,${generatedImageRef.value}` : null));
    const [prodResult] = await pool.query(
      'INSERT INTO products (tenant_id, category_id, name, image_url, vat_rate, active, barcode, sale_type, stock_qty, low_stock_threshold) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)',
      [tenantId, categoryId, input.name, imageUrl, input.vat_rate ?? 10, input.barcode || null, input.sale_type || 'adet', input.stock_qty ?? null, input.low_stock_threshold ?? null]
    );
    await pool.query(
      'INSERT INTO product_sizes (product_id, label, price) VALUES (?, ?, ?)',
      [prodResult.insertId, input.size_label || (input.sale_type === 'kg' ? 'kg' : 'Tek Boy'), input.price]
    );
    broadcastMenuChanged(tenantId);
    return { ok: true, message: `"${input.name}" ürünü "${input.group_name} / ${input.category_name}" kategorisine ${input.price}₺ fiyatla eklendi.${imageUrl ? ' Fotoğraf da eklendi.' : ''}${input.barcode ? ' Barkod: '+input.barcode+'.' : ''}` };
  }

  if (name === 'update_product') {
    const [[prod]] = await pool.query(
      'SELECT * FROM products WHERE tenant_id = ? AND LOWER(name) = LOWER(?)', [tenantId, input.product_name]
    );
    if (!prod) return { ok: false, error: `"${input.product_name}" adında bir ürün bulunamadı.` };

    let categoryId = prod.category_id;
    if (input.new_group_name && input.new_category_name) {
      let [[cat]] = await pool.query(
        'SELECT id FROM categories WHERE tenant_id = ? AND group_name = ? AND name = ?',
        [tenantId, input.new_group_name, input.new_category_name]
      );
      if (cat) { categoryId = cat.id; }
      else {
        const [catResult] = await pool.query('INSERT INTO categories (tenant_id, group_name, name) VALUES (?, ?, ?)', [tenantId, input.new_group_name, input.new_category_name]);
        categoryId = catResult.insertId;
      }
    }
    const imageUrl = await saveBase64ImageIfNeeded(pendingImage ? `data:${pendingImage.mediaType};base64,${pendingImage.base64}` : (generatedImageRef && generatedImageRef.value ? `data:image/png;base64,${generatedImageRef.value}` : undefined));
    const sets = [], values = [];
    if (input.new_name) { sets.push('name = ?'); values.push(input.new_name); }
    if (categoryId !== prod.category_id) { sets.push('category_id = ?'); values.push(categoryId); }
    if (imageUrl !== undefined) { sets.push('image_url = ?'); values.push(imageUrl); }
    if (input.active !== undefined) { sets.push('active = ?'); values.push(input.active ? 1 : 0); }
    if (input.barcode !== undefined) { sets.push('barcode = ?'); values.push(input.barcode || null); }
    if (input.sale_type !== undefined) { sets.push('sale_type = ?'); values.push(input.sale_type); }
    if (input.stock_qty !== undefined) { sets.push('stock_qty = ?'); values.push(input.stock_qty); }
    if (input.low_stock_threshold !== undefined) { sets.push('low_stock_threshold = ?'); values.push(input.low_stock_threshold); }
    if (input.vat_rate !== undefined) { sets.push('vat_rate = ?'); values.push(input.vat_rate); }
    if (sets.length > 0) {
      values.push(prod.id);
      await pool.query(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, values);
    }
    if (input.new_price !== undefined) {
      const [[sizeRow]] = await pool.query(
        'SELECT id FROM product_sizes WHERE product_id = ? AND label = ? LIMIT 1',
        [prod.id, input.size_label || null]
      );
      if (sizeRow) {
        await pool.query('UPDATE product_sizes SET price = ? WHERE id = ?', [input.new_price, sizeRow.id]);
      } else {
        const [[firstSize]] = await pool.query('SELECT id FROM product_sizes WHERE product_id = ? LIMIT 1', [prod.id]);
        if (firstSize) await pool.query('UPDATE product_sizes SET price = ? WHERE id = ?', [input.new_price, firstSize.id]);
      }
    }
    broadcastMenuChanged(tenantId);
    return { ok: true, message: `"${input.product_name}" ürünü güncellendi.${input.new_name ? ' Yeni ad: '+input.new_name+'.' : ''}${input.new_price!==undefined ? ' Yeni fiyat: '+input.new_price+'₺.' : ''}${imageUrl ? ' Fotoğraf değiştirildi.' : ''}` };
  }

  if (name === 'delete_product') {
    const [result] = await pool.query('DELETE FROM products WHERE tenant_id = ? AND LOWER(name) = LOWER(?)', [tenantId, input.product_name]);
    if (result.affectedRows === 0) return { ok: false, error: `"${input.product_name}" adında bir ürün bulunamadı.` };
    broadcastMenuChanged(tenantId);
    return { ok: true, message: `"${input.product_name}" ürünü silindi.` };
  }

  if (name === 'add_category') {
    const [[existing]] = await pool.query('SELECT id FROM categories WHERE tenant_id=? AND group_name=? AND name=?', [tenantId, input.group_name, input.category_name]);
    if (existing) return { ok: false, error: 'Bu kategori zaten var.' };
    await pool.query('INSERT INTO categories (tenant_id, group_name, name) VALUES (?, ?, ?)', [tenantId, input.group_name, input.category_name]);
    broadcastMenuChanged(tenantId);
    return { ok: true, message: `"${input.group_name} / ${input.category_name}" kategorisi oluşturuldu.` };
  }

  if (name === 'rename_category') {
    const [result] = await pool.query(
      'UPDATE categories SET name = ? WHERE tenant_id = ? AND group_name = ? AND name = ?',
      [input.new_category_name, tenantId, input.group_name, input.old_category_name]
    );
    if (result.affectedRows === 0) return { ok: false, error: 'Kategori bulunamadı.' };
    broadcastMenuChanged(tenantId);
    return { ok: true, message: `"${input.old_category_name}" kategorisi "${input.new_category_name}" olarak değiştirildi.` };
  }

  if (name === 'delete_category') {
    const [[cat]] = await pool.query('SELECT id FROM categories WHERE tenant_id=? AND group_name=? AND name=?', [tenantId, input.group_name, input.category_name]);
    if (!cat) return { ok: false, error: 'Kategori bulunamadı.' };
    const [[countRow]] = await pool.query('SELECT COUNT(*) as c FROM products WHERE category_id = ?', [cat.id]);
    await pool.query('DELETE FROM products WHERE category_id = ?', [cat.id]);
    await pool.query('DELETE FROM categories WHERE id = ?', [cat.id]);
    broadcastMenuChanged(tenantId);
    return { ok: true, message: `"${input.category_name}" kategorisi ve içindeki ${countRow.c} ürün silindi.` };
  }

  if (name === 'list_menu') {
    const [cats] = await pool.query('SELECT id, group_name, name FROM categories WHERE tenant_id = ?', [tenantId]);
    const [prods] = await pool.query('SELECT id, category_id, name, active FROM products WHERE tenant_id = ?', [tenantId]);
    const [sizes] = await pool.query(`SELECT ps.* FROM product_sizes ps JOIN products p ON p.id=ps.product_id WHERE p.tenant_id=?`, [tenantId]);
    const menu = cats.map(c => ({
      grup: c.group_name, kategori: c.name,
      urunler: prods.filter(p => p.category_id === c.id).map(p => ({
        ad: p.name, aktif: !!p.active,
        boylar: sizes.filter(s => s.product_id === p.id).map(s => `${s.label}: ${s.price}₺`)
      }))
    }));
    return { ok: true, menu };
  }

  if (name === 'add_staff') {
    if (!/^\d{4}$/.test(input.pin)) return { ok: false, error: 'PIN 4 haneli rakam olmalı.' };
    await pool.query('INSERT INTO users (tenant_id, name, role, pin) VALUES (?, ?, ?, ?)', [tenantId, input.name, 'staff', input.pin]);
    return { ok: true, message: `"${input.name}" adlı personel eklendi, kasa PIN'i: ${input.pin}.` };
  }

  if (name === 'set_staff_panel_login') {
    const [[staff]] = await pool.query('SELECT id FROM users WHERE tenant_id = ? AND LOWER(name) = LOWER(?)', [tenantId, input.staff_name]);
    if (!staff) return { ok: false, error: `"${input.staff_name}" adında bir personel bulunamadı.` };
    if (input.password.length < 6) return { ok: false, error: 'Şifre en az 6 karakter olmalı.' };
    const passwordHash = await bcrypt.hash(input.password, 10);
    await pool.query('UPDATE users SET email = ?, password_hash = ? WHERE id = ?', [input.email, passwordHash, staff.id]);
    return { ok: true, message: `"${input.staff_name}" için panel girişi tanımlandı — e-posta: ${input.email}.` };
  }

  if (name === 'list_staff') {
    const [staff] = await pool.query('SELECT name, role FROM users WHERE tenant_id = ?', [tenantId]);
    return { ok: true, personel: staff.map(s => ({ ad: s.name, rol: s.role })) };
  }

  if (name === 'list_ingredients') {
    const [rows] = await pool.query('SELECT name, unit, unit_price FROM ingredients WHERE tenant_id = ? ORDER BY name', [tenantId]);
    return { ok: true, malzemeler: rows.map(r => ({ ad: r.name, birim: r.unit, birim_fiyat: r.unit_price })) };
  }

  if (name === 'set_product_recipe') {
    const [[prod]] = await pool.query('SELECT id FROM products WHERE tenant_id = ? AND LOWER(name) = LOWER(?)', [tenantId, input.product_name]);
    if (!prod) return { ok: false, error: `"${input.product_name}" adında bir ürün bulunamadı.` };

    const [allIngredients] = await pool.query('SELECT id, name FROM ingredients WHERE tenant_id = ?', [tenantId]);
    const byName = {}; allIngredients.forEach(i => { byName[i.name.toLowerCase()] = i.id; });

    const matched = [], notFound = [];
    for (const it of input.ingredients) {
      const id = byName[(it.ingredient_name || '').toLowerCase()];
      if (id) matched.push({ ingredient_id: id, quantity: it.quantity, name: it.ingredient_name });
      else notFound.push(it.ingredient_name);
    }
    if (matched.length === 0) {
      return { ok: false, error: `Hiçbir malzeme eşleşmedi. Bulunamayanlar: ${notFound.join(', ')}. Önce bu malzemeleri panelden (Maliyet Hesaplama) veya bana söyleyerek ekletmen gerekiyor.` };
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM product_ingredients WHERE product_id = ?', [prod.id]);
      for (const m of matched) {
        await conn.query('INSERT INTO product_ingredients (product_id, ingredient_id, quantity) VALUES (?, ?, ?)', [prod.id, m.ingredient_id, m.quantity]);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      return { ok: false, error: 'Reçete kaydedilemedi: ' + e.message };
    } finally {
      conn.release();
    }

    return {
      ok: true,
      message: `"${input.product_name}" reçetesi kaydedildi: ${matched.map(m => `${m.name} (${m.quantity})`).join(', ')}.${notFound.length > 0 ? ' Eşleşmeyen (atlanan) malzemeler: ' + notFound.join(', ') + '.' : ''}`,
    };
  }

  if (name === 'log_expense') {
    await pool.query(
      'INSERT INTO expenses (tenant_id, description, amount, category, created_by) VALUES (?, ?, ?, ?, ?)',
      [tenantId, input.description, input.amount, input.category || 'Genel', 'AI Asistan']
    );
    return { ok: true, message: `${input.amount}₺ tutarında gider kaydedildi: "${input.description}".` };
  }

  if (name === 'log_to_sheet') {
    const result = await appendRow(tenantId, { category: input.category, description: input.description, amount: input.amount });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, message: `Google E-Tablonuza kaydedildi: [${input.category}] ${input.description}${input.amount ? ' — ' + input.amount + '₺' : ''}` };
  }

  if (name === 'add_size_to_all_products') {
    const [products] = await pool.query("SELECT id, name FROM products WHERE tenant_id = ? AND (sale_type IS NULL OR sale_type != 'kg')", [tenantId]);
    let addedCount = 0, skippedCount = 0;
    for (const p of products) {
      const [[existing]] = await pool.query(
        'SELECT id FROM product_sizes WHERE product_id = ? AND label = ?', [p.id, input.size_label]
      );
      if (existing) { skippedCount++; continue; }
      const [[maxRow]] = await pool.query('SELECT MAX(price) as maxPrice FROM product_sizes WHERE product_id = ?', [p.id]);
      const basePrice = Number(maxRow.maxPrice || 0);
      await pool.query(
        'INSERT INTO product_sizes (product_id, label, price) VALUES (?, ?, ?)',
        [p.id, input.size_label, basePrice + Number(input.price_delta)]
      );
      addedCount++;
    }
    broadcastMenuChanged(tenantId);
    return { ok: true, message: `"${input.size_label}" boyu ${addedCount} ürüne eklendi (her birinin mevcut en yüksek fiyatına +${input.price_delta}₺ eklenerek).${skippedCount>0 ? ' '+skippedCount+' üründe bu boy zaten vardı, atlandı.' : ''}` };
  }

  if (name === 'delete_product_size') {
    const [[prod]] = await pool.query('SELECT id FROM products WHERE tenant_id = ? AND name = ?', [tenantId, input.product_name]);
    if (!prod) return { ok: false, error: `Ürün bulunamadı: ${input.product_name}` };
    const [[size]] = await pool.query('SELECT id FROM product_sizes WHERE product_id = ? AND label = ?', [prod.id, input.size_label]);
    if (!size) return { ok: false, error: `"${input.product_name}" ürününde "${input.size_label}" adında bir boy yok.` };
    const [[countRow]] = await pool.query('SELECT COUNT(*) as c FROM product_sizes WHERE product_id = ?', [prod.id]);
    if (Number(countRow.c) <= 1) return { ok: false, error: `"${input.product_name}" ürününün tek boyu bu — silinemez, her ürünün en az bir boyu olmalı.` };
    await pool.query('DELETE FROM product_sizes WHERE id = ?', [size.id]);
    broadcastMenuChanged(tenantId);
    return { ok: true, message: `"${input.product_name}" ürününden "${input.size_label}" boyu silindi.` };
  }

  if (name === 'delete_size_from_all_products') {
    const [rows] = await pool.query(
      `SELECT ps.id, ps.product_id, p.name as product_name FROM product_sizes ps
       JOIN products p ON p.id = ps.product_id
       WHERE p.tenant_id = ? AND ps.label = ?`,
      [tenantId, input.size_label]
    );
    if (rows.length === 0) return { ok: false, error: `"${input.size_label}" adında bir boy hiçbir üründe bulunamadı.` };
    let deleted = 0, skipped = 0;
    for (const row of rows) {
      const [[countRow]] = await pool.query('SELECT COUNT(*) as c FROM product_sizes WHERE product_id = ?', [row.product_id]);
      if (Number(countRow.c) <= 1) { skipped++; continue; } // tek boyuysa silme, ürün boysuz kalmasın
      await pool.query('DELETE FROM product_sizes WHERE id = ?', [row.id]);
      deleted++;
    }
    broadcastMenuChanged(tenantId);
    return { ok: true, message: `"${input.size_label}" boyu ${deleted} üründen silindi.${skipped>0 ? ' '+skipped+' üründe bu boy TEK boy olduğu için atlandı (ürün boysuz kalamaz).' : ''}` };
  }

  if (name === 'get_report_summary') {
    const [s, e] = periodRange(input.period);
    const [[totals]] = await pool.query(
      `SELECT COUNT(*) as orderCount, COALESCE(SUM(total),0) as revenue FROM orders WHERE tenant_id=? AND status='closed' AND created_at BETWEEN ? AND ?`,
      [tenantId, s, e]
    );
    const [top] = await pool.query(
      `SELECT oi.product_name, SUM(oi.qty) as qty, SUM(oi.qty*oi.unit_price) as revenue
       FROM order_items oi JOIN orders o ON o.id=oi.order_id
       WHERE o.tenant_id=? AND o.created_at BETWEEN ? AND ? GROUP BY oi.product_name ORDER BY revenue DESC LIMIT 5`,
      [tenantId, s, e]
    );
    return {
      ok: true,
      donem: input.period, siparisSayisi: totals.orderCount, ciro: Number(totals.revenue).toFixed(2),
      enCokSatanlar: top.map(t => ({ urun: t.product_name, adet: t.qty, ciro: Number(t.revenue).toFixed(2) }))
    };
  }

  if (name === 'analyze_sales_trends') {
    const start = new Date(input.start_date + 'T00:00:00');
    const end = new Date(input.end_date + 'T23:59:59');
    if (isNaN(start) || isNaN(end) || start > end) return { ok: false, error: 'Geçersiz tarih aralığı.' };
    const groupBy = input.group_by || 'day';
    const maxDays = { day: 62, week: 370, month: 1100 }[groupBy] ?? 62;
    if ((end - start) / (24 * 3600 * 1000) > maxDays) {
      return { ok: false, error: `Bu kadar geniş bir aralığı "${groupBy}" kırılımıyla analiz edemem — ya aralığı kısalt ya da group_by'ı hafta/ay yap.` };
    }
    // MySQL tarafında, seçilen kırılıma göre dönemi tek bir etikete indiriyoruz:
    // gün → "2026-08-16", hafta → o haftanın Pazartesi tarihi, ay → "2026-08"
    const periodExpr = groupBy === 'month'
      ? `DATE_FORMAT(o.created_at, '%Y-%m')`
      : groupBy === 'week'
        ? `DATE(DATE_SUB(o.created_at, INTERVAL WEEKDAY(o.created_at) DAY))`
        : `DATE(o.created_at)`;

    const [rows] = await pool.query(
      `SELECT ${periodExpr} as donem, oi.product_name, SUM(oi.qty) as adet, SUM(oi.qty*oi.unit_price) as ciro
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.tenant_id = ? AND o.created_at BETWEEN ? AND ?
       GROUP BY ${periodExpr}, oi.product_name
       ORDER BY donem ASC`,
      [tenantId, start, end]
    );
    // Aynı aralıktaki indirim kayıtları — kampanya/indirim etkisini görebilmek için
    const [discounts] = await pool.query(
      `SELECT ${periodExpr} as donem, oi.product_name,
              SUM(CASE WHEN oi.discount_type='percent' THEN oi.unit_price*oi.qty*oi.discount_value/100
                       WHEN oi.discount_type='amount' THEN oi.discount_value ELSE 0 END) as indirimTutari
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.tenant_id = ? AND o.created_at BETWEEN ? AND ? AND oi.discount_type IS NOT NULL
       GROUP BY ${periodExpr}, oi.product_name
       ORDER BY donem ASC`,
      [tenantId, start, end]
    );
    const fmt = (v) => v instanceof Date ? v.toISOString().slice(0,10) : String(v);
    const byPeriod = {};
    for (const r of rows) {
      const d = fmt(r.donem);
      if (!byPeriod[d]) byPeriod[d] = { donem: d, urunler: [], toplamCiro: 0 };
      byPeriod[d].urunler.push({ urun: r.product_name, adet: Number(r.adet), ciro: Number(r.ciro) });
      byPeriod[d].toplamCiro += Number(r.ciro);
    }
    for (const dc of discounts) {
      const d = fmt(dc.donem);
      if (byPeriod[d]) {
        if (!byPeriod[d].indirimler) byPeriod[d].indirimler = [];
        byPeriod[d].indirimler.push({ urun: dc.product_name, indirimTutari: Number(dc.indirimTutari) });
      }
    }
    return {
      ok: true,
      kirilim: groupBy,
      not: 'Bu ham veriyi kullanarak trend, artış/azalış, dönem karşılaştırması ve korelasyon tespitini SEN (Claude) yapmalısın — veri hazır, yorum senden bekleniyor.',
      donemselVeri: Object.values(byPeriod),
    };
  }

  return { ok: false, error: 'Bilinmeyen araç: ' + name };
}

router.post('/ai-agent', requireFeature('ai_assistant'), aiLimiter, async (req, res) => {
  const { messages, image } = req.body; // messages: [{role, content}], image: {mediaType, base64} | null
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'AI asistanı henüz aktif değil — sunucuda ANTHROPIC_API_KEY tanımlı değil.' });
  }
  if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'Mesaj gerekli' });

  try {
    const [[tRow]] = await pool.query('SELECT name FROM tenants WHERE id = ?', [req.tenantId]);
    const systemPrompt = `Sen "${tRow ? tRow.name : 'işletme'}" işletmesinin DurakPOS panelindeki AI Asistanısın. Sadece soru cevaplamıyorsun — panelde bir insanın elle yapabileceği hemen hemen her şeyi (ürün ekleme/düzenleme/silme, fotoğraf değiştirme, kategori yönetimi, personel ekleme, panel şifresi tanımlama, gider kaydetme, toplu fiyat/boy değişikliği, ürün reçetesi (maliyet malzemeleri) belirleme, rapor ve menü sorgulama) araçlarınla GERÇEKTEN yapabiliyorsun.

Kurallar:
- Kullanıcı bir şeyi "ekle", "değiştir", "sil", "kaydet", "düş" gibi bir eylem istiyorsa, ilgili aracı çağır — sadece "tamam yapacağım" deyip durma, gerçekten çağır.
- Kullanıcı bir fotoğraf gönderdiyse ve "bunu ekle/değiştir" diyorsa, fotoğrafı incele (ne olduğunu anla) ve add_product/update_product aracını çağır — fotoğrafın kendisi otomatik olarak ürüne eklenecek, sen sadece isim/kategori/fiyat bilgisini araca ver.
- Ürün/kategori düzenlerken veya silerken, kullanıcının kastettiği ürünü mevcut menüden (gerekirse list_menu ile) doğru eşleştir — emin değilsen kullanıcıya sor.
- Silme işlemleri (delete_product, delete_category) geri alınamaz — kullanıcı açıkça "sil" demediyse silme, sadece "kaldır mı istersin?" diye sor.
- Personel/şifre işlemlerinde (add_staff, set_staff_panel_login) girilen bilgileri aynen kullan, tahmin üretme.
- Reçete (set_product_recipe) isterken önce list_ingredients ile mevcut malzemeleri kontrol et — kullanıcının bahsettiği bir malzeme listede yoksa, onu kendin ekleyemezsin, kullanıcıya "önce bu malzemeyi panelden veya bana bilgisini vererek eklemen lazım" de. set_product_recipe şu an ürünün TÜMÜ için tek bir reçete kaydeder — "küçük boy için ayrı, büyük boy için ayrı reçete" gibi bir istek gelirse, bunun şu an desteklenmediğini, istersen bu özelliği ekleyebileceğinizi kullanıcıya söyle.
- Kullanıcı bir ürün için "fotoğrafını bul/yükle/oluştur" derse ve kendisi fotoğraf göndermediyse, önce generate_product_image aracını çağır, sonra hemen ardından add_product veya update_product'ı çağır (görsel otomatik eklenecek). Kullanıcı gerçek bir fotoğraf gönderdiyse generate_product_image'a hiç gerek yok.
- İşlemi yaptıktan sonra kullanıcıya kısa, net bir onay cümlesiyle ne yaptığını söyle.
- ÖNEMLİ: Bir araç sonucu {"ok": false, ...} şeklinde hata döndürürse, bunu ASLA "yaptım" veya "tamamlandı" gibi göstermeyip kullanıcıya AÇIKÇA hangi işlemin başarısız olduğunu ve neden (hata mesajını) söyle. Kısmi başarı varsa (bazıları yapıldı, bazıları başarısız oldu), hangilerinin yapıldığını hangilerinin yapılmadığını net ayırarak listele.
- Emin olmadığın bir bilgi varsa (örn. fiyat belirtilmemişse) tahmin etme, kullanıcıya sor.
- Kullanıcı satış trendi, karşılaştırma, "neden arttı/azaldı" gibi bir analiz isterse, analyze_sales_trends aracıyla ham günlük veriyi çek, SONRA bu veriyi SEN yorumla — gerçek bir satış veri uzmanı gibi davran: hangi ürünün ne zaman arttığını/azaldığını, indirim/kampanya günleriyle örtüşüp örtüşmediğini fark et, somut rakamlarla açıkla, varsa öneride bulun. Genel geçer laflar etme, verideki gerçek sayılara dayan.
- Kullanıcı, doğal konuşma içinde bir KAYIT niteliği taşıyan bir şey söylerse (maaş ödemesi, gelen ürün, firma notu, ödeme bilgisi gibi — "not al" demese bile), log_to_sheet aracıyla bunu Google E-Tablosuna kaydet. Kategoriyi konuşmanın içeriğine göre sen belirle. Bu, log_expense'ten farklı — log_expense sadece giderleri bizim kendi sistemimize kaydeder, log_to_sheet ise kullanıcının kendi Google E-Tablosuna, HER TÜR kaydı (gider olmayanlar dahil) yazar.
- Türkçe, samimi ama profesyonel konuş.`;

    let apiMessages = messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content }));

    // Son kullanıcı mesajına, varsa gönderilen fotoğrafı ekle
    if (image && image.base64 && apiMessages.length > 0) {
      const lastIdx = apiMessages.length - 1;
      if (apiMessages[lastIdx].role === 'user') {
        apiMessages[lastIdx] = {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
            { type: 'text', text: apiMessages[lastIdx].content },
          ],
        };
      }
    }

    const actionsPerformed = [];
    let finalReply = '';
    let hitIterationLimit = false;
    const MAX_ITERATIONS = 15; // önceden 5'ti — birden fazla ürün eklerken (özellikle fotoğraf oluşturup sonra ekleme gibi 2 adımlı işlerde) çok kolay yetersiz kalıyordu
    const generatedImageRef = { value: null }; // generate_product_image çalışırsa buraya yazılır, sonraki add/update_product bunu kullanır
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1200, system: systemPrompt, messages: apiMessages, tools: AGENT_TOOLS }),
      });
      const aiData = await aiRes.json();
      if (!aiRes.ok) return res.status(500).json({ error: 'AI isteği başarısız', detail: aiData.error?.message || JSON.stringify(aiData) });

      const toolUses = (aiData.content || []).filter(b => b.type === 'tool_use');
      const textParts = (aiData.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      if (textParts) finalReply = textParts;

      if (toolUses.length === 0) break; // Claude son cevabını verdi, döngü biter

      if (iteration === MAX_ITERATIONS - 1) {
        // Döngü sınıra takıldı ama Claude'un HÂLÂ yapacak işi vardı — bu,
        // gerçek bir yarıda kalma durumu. Kullanıcıya YANLIŞLIKLA "tamamlandı"
        // demek yerine, dürüstçe ne kadarının yapıldığını bildiriyoruz.
        hitIterationLimit = true;
        break;
      }

      apiMessages.push({ role: 'assistant', content: aiData.content });
      const toolResults = [];
      for (const tu of toolUses) {
        const result = await executeAgentTool(req.tenantId, tu.name, tu.input, image, generatedImageRef);
        actionsPerformed.push({ tool: tu.name, input: tu.input, result });
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
      }
      apiMessages.push({ role: 'user', content: toolResults });
    }

    let replyToSend = finalReply;
    if (hitIterationLimit) {
      const doneCount = actionsPerformed.filter(a => a.result && a.result.ok !== false).length;
      replyToSend = `${finalReply ? finalReply + '\n\n' : ''}⚠ İstek çok büyük olduğu için hepsini tek seferde bitiremedim — ${doneCount} işlem gerçekten tamamlandı. Lütfen menüyü kontrol edip kalanları ayrı ayrı (ya da daha küçük gruplar halinde) tekrar isteyin.`;
    } else if (!replyToSend) {
      replyToSend = 'İşlem tamamlandı.';
    }

    res.json({ reply: replyToSend, actionsPerformed });
  } catch (e) {
    res.status(500).json({ error: 'Analiz alınamadı', detail: e.message });
  }
});

// Patron ekranındaki "Adisyon Sayısı" kartına tıklayınca açılan detay listesi
router.get('/patron-orders', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start ve end gerekli' });
  try {
    const [orders] = await pool.query(
      `SELECT o.id, o.total, o.created_at, o.table_id, o.reopened_count, o.last_reopened_by, t.name as table_name
       FROM orders o LEFT JOIN tables t ON t.id = o.table_id
       WHERE o.tenant_id = ? AND o.status = 'closed' AND o.created_at BETWEEN ? AND ?
       ORDER BY o.created_at DESC LIMIT 200`,
      [req.tenantId, start, end]
    );
    const distinctTables = new Set(orders.filter(o => o.table_id).map(o => o.table_id));
    const totalAmount = orders.reduce((s, o) => s + Number(o.total), 0);
    res.json({
      orders: orders.map(o => ({
        id: o.id, dailyNumber: o.daily_number || o.id, tableName: o.table_name || 'Self Servis', total: Number(o.total), createdAt: o.created_at,
        reopenedCount: o.reopened_count || 0, lastReopenedBy: o.last_reopened_by
      })),
      totalMasa: distinctTables.size || (orders.length > 0 ? 1 : 0),
      totalAmount
    });
  } catch (e) {
    res.status(500).json({ error: 'Liste alınamadı', detail: e.message });
  }
});

// Patron ekranındaki "Açık Çek" kartına tıklayınca açılan detay listesi —
// tarih aralığından bağımsız, o an gerçekten ödeme bekleyen tüm siparişler
router.get('/patron-open-checks', async (req, res) => {
  try {
    const [orders] = await pool.query(
      `SELECT o.id, o.daily_number, o.total, o.created_at, o.table_id, t.name as table_name
       FROM orders o LEFT JOIN tables t ON t.id = o.table_id
       WHERE o.tenant_id = ? AND o.status = 'open'
       ORDER BY o.created_at ASC LIMIT 200`,
      [req.tenantId]
    );
    res.json({
      orders: orders.map(o => ({ id: o.id, dailyNumber: o.daily_number || o.id, tableName: o.table_name || 'Self Servis', total: Number(o.total), createdAt: o.created_at })),
      totalAmount: orders.reduce((s, o) => s + Number(o.total), 0)
    });
  } catch (e) {
    res.status(500).json({ error: 'Liste alınamadı', detail: e.message });
  }
});

// ---- Kasa Kapanışı (Z Raporu) ----
router.get('/day-close-summary', async (req, res) => {
  const { date } = req.query; // 'YYYY-MM-DD', yoksa bugün
  const day = date || trFrame(new Date()).toISOString().slice(0, 10);
  const start = `${day} 00:00:00`, end = `${day} 23:59:59`;
  try {
    const [payments] = await pool.query(
      `SELECT op.pay_label, SUM(op.amount) as total FROM order_payments op
       JOIN orders o ON o.id = op.order_id
       WHERE o.tenant_id = ? AND op.created_at BETWEEN ? AND ?
       GROUP BY op.pay_label`,
      [req.tenantId, start, end]
    );
    const [[expenseRow]] = await pool.query(
      `SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id = ? AND created_at BETWEEN ? AND ?`,
      [req.tenantId, start, end]
    );
    const [[orderCountRow]] = await pool.query(
      `SELECT COUNT(*) as c FROM orders WHERE tenant_id = ? AND status = 'closed' AND created_at BETWEEN ? AND ?`,
      [req.tenantId, start, end]
    );
    const [[existingClosure]] = await pool.query(
      'SELECT * FROM day_closures WHERE tenant_id = ? AND closure_date = ?', [req.tenantId, day]
    );

    let cashTotal = 0, cardTotal = 0, otherTotal = 0;
    payments.forEach(p => {
      const label = (p.pay_label || '').toLowerCase();
      if (label.includes('nakit')) cashTotal += Number(p.total);
      else if (label.includes('kart')) cardTotal += Number(p.total);
      else otherTotal += Number(p.total);
    });
    const revenueTotal = cashTotal + cardTotal + otherTotal;
    const expenseTotal = Number(expenseRow.total);

    res.json({
      date: day, orderCount: orderCountRow.c,
      byPayment: payments.map(p => ({ label: p.pay_label, total: Number(p.total) })),
      cashTotal, cardTotal, otherTotal, revenueTotal, expenseTotal,
      netTotal: revenueTotal - expenseTotal,
      alreadyClosed: !!existingClosure, closedAt: existingClosure ? existingClosure.closed_at : null,
    });
  } catch (e) {
    res.status(500).json({ error: 'Kapanış özeti alınamadı', detail: e.message });
  }
});

router.post('/day-close', async (req, res) => {
  const { date, closedBy } = req.body;
  const day = date || trFrame(new Date()).toISOString().slice(0, 10);
  try {
    const [[existing]] = await pool.query('SELECT id FROM day_closures WHERE tenant_id = ? AND closure_date = ?', [req.tenantId, day]);
    if (existing) return res.status(400).json({ error: 'Bu gün için zaten bir kapanış kaydı var.' });

    const start = `${day} 00:00:00`, end = `${day} 23:59:59`;
    const [payments] = await pool.query(
      `SELECT op.pay_label, SUM(op.amount) as total FROM order_payments op
       JOIN orders o ON o.id = op.order_id WHERE o.tenant_id = ? AND op.created_at BETWEEN ? AND ? GROUP BY op.pay_label`,
      [req.tenantId, start, end]
    );
    const [[expenseRow]] = await pool.query(
      `SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id = ? AND created_at BETWEEN ? AND ?`,
      [req.tenantId, start, end]
    );
    let cashTotal = 0, cardTotal = 0, otherTotal = 0;
    payments.forEach(p => {
      const label = (p.pay_label || '').toLowerCase();
      if (label.includes('nakit')) cashTotal += Number(p.total);
      else if (label.includes('kart')) cardTotal += Number(p.total);
      else otherTotal += Number(p.total);
    });
    const revenueTotal = cashTotal + cardTotal + otherTotal;
    const expenseTotal = Number(expenseRow.total);

    await pool.query(
      `INSERT INTO day_closures (tenant_id, closure_date, cash_total, card_total, other_total, expense_total, net_total, closed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, day, cashTotal, cardTotal, otherTotal, expenseTotal, revenueTotal - expenseTotal, closedBy || 'Kasa']
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Kapanış kaydedilemedi', detail: e.message });
  }
});

// İndirimli Ürün Raporu — hangi üründen ne kadar indirimle satılmış
router.get('/discounted-items-report', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start ve end gerekli' });
  const s = parseReportDate(start), en = parseReportDate(end);
  try {
    const [rows] = await pool.query(
      `SELECT oi.product_name,
              SUM(oi.qty) as qty,
              SUM(CASE WHEN oi.discount_type='percent' THEN oi.unit_price*oi.qty*oi.discount_value/100
                       WHEN oi.discount_type='amount' THEN oi.discount_value ELSE 0 END) as discount_total
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.tenant_id = ? AND o.created_at BETWEEN ? AND ? AND oi.discount_type IS NOT NULL
       GROUP BY oi.product_name ORDER BY discount_total DESC`,
      [req.tenantId, s, en]
    );
    res.json(rows.map(r => ({ urun: r.product_name, adet: Number(r.qty), indirim: Number(r.discount_total) })));
  } catch (e) { res.status(500).json({ error: 'Rapor alınamadı', detail: e.message }); }
});

// İptal Ürün Raporu — hangi ürün ne kadar iptal edilmiş
router.get('/cancelled-items-report', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start ve end gerekli' });
  const s = parseReportDate(start), en = parseReportDate(end);
  try {
    const [rows] = await pool.query(
      `SELECT product_name, SUM(qty) as qty, SUM(qty*unit_price) as tutar
       FROM cancelled_items WHERE tenant_id = ? AND cancelled_at BETWEEN ? AND ?
       GROUP BY product_name ORDER BY tutar DESC`,
      [req.tenantId, s, en]
    );
    res.json(rows.map(r => ({ urun: r.product_name, adet: Number(r.qty), tutar: Number(r.tutar) })));
  } catch (e) { res.status(500).json({ error: 'Rapor alınamadı', detail: e.message }); }
});

// Ürün Raporu — her ürünün satış adedi/tutarı/indirim bilgisi, en çok satılandan aza sıralı
router.get('/product-report', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start ve end gerekli' });
  const s = parseReportDate(start), en = parseReportDate(end);
  try {
    const [rows] = await pool.query(
      `SELECT oi.product_name,
              SUM(oi.qty) as qty,
              SUM(oi.qty*oi.unit_price) as tutar,
              SUM(CASE WHEN oi.discount_type IS NOT NULL THEN oi.qty ELSE 0 END) as indirim_adet,
              SUM(CASE WHEN oi.discount_type='percent' THEN oi.unit_price*oi.qty*oi.discount_value/100
                       WHEN oi.discount_type='amount' THEN oi.discount_value ELSE 0 END) as indirim_tutar
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.tenant_id = ? AND o.status = 'closed' AND o.created_at BETWEEN ? AND ?
       GROUP BY oi.product_name ORDER BY qty DESC`,
      [req.tenantId, s, en]
    );
    res.json(rows.map(r => ({
      urun: r.product_name, satisAdet: Number(r.qty), satisTutar: Number(r.tutar),
      indirimAdet: Number(r.indirim_adet), indirimTutar: Number(r.indirim_tutar)
    })));
  } catch (e) { res.status(500).json({ error: 'Rapor alınamadı', detail: e.message }); }
});

export default router;
