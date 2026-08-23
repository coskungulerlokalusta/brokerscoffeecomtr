import express from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

// ---- İşletmenin kendi paneli — hangi platformlara bağlı, kod girme/silme ----
router.get('/', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM delivery_integrations WHERE tenant_id = ?', [req.tenantId]);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { platform, store_code } = req.body;
  if (!platform || !store_code) return res.status(400).json({ error: 'Platform ve mağaza kodu zorunlu' });
  try {
    await pool.query(
      `INSERT INTO delivery_integrations (tenant_id, platform, store_code, status)
       VALUES (?, ?, ?, 'bekliyor')
       ON DUPLICATE KEY UPDATE store_code = VALUES(store_code), status = 'bekliyor', connected_at = NULL`,
      [req.tenantId, platform, store_code]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Kaydedilemedi', detail: e.message });
  }
});

router.delete('/:platform', async (req, res) => {
  await pool.query('DELETE FROM delivery_integrations WHERE tenant_id = ? AND platform = ?', [req.tenantId, req.params.platform]);
  res.json({ ok: true });
});

// ---- Platformlardan gelen siparişleri kasa/panel görsün diye ----
router.get('/orders', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM delivery_orders WHERE tenant_id = ? AND status IN ('yeni','hazirlaniyor','yolda') ORDER BY created_at ASC`,
    [req.tenantId]
  );
  res.json(rows);
});

router.patch('/orders/:id', async (req, res) => {
  const { status } = req.body;
  await pool.query('UPDATE delivery_orders SET status = ? WHERE id = ? AND tenant_id = ?', [status, req.params.id, req.tenantId]);
  res.json({ ok: true });
});

export default router;

// ============================================================
// NOT — DÜRÜST DURUM (ileride bu dosyaya dönüldüğünde okunsun):
// ============================================================
// Aşağıdaki webhook, aracı firmanın (API Merkezi/Posentegra) GERÇEK API
// dokümanı elimize geçmeden yazılamaz — her aracı firmanın kendi imza
// doğrulama yöntemi, kendi JSON formatı, kendi sipariş durum kodları vardır.
// Doküman geldiğinde, aşağıya şu şekli alacak bir uç nokta eklenecek:
//
//   router.post('/webhook/:platform/:tenantSlug', async (req, res) => {
//     // 1) Aracı firmanın imza/güvenlik doğrulamasını kontrol et
//     // 2) req.body'yi aracı firmanın formatından bizim delivery_orders
//     //    yapımıza çevir (ürün adı/adet/fiyat/müşteri adres eşleştirmesi)
//     // 3) delivery_orders tablosuna INSERT et
//     // 4) Aracı firmaya "sipariş alındı" onayı dön
//   });
//
// Şu an bu adres yok, çünkü sahte/tahmini bir format yazmak, gerçek entegrasyon
// geldiğinde baştan yazılması gereken kod demek — zaman kaybı olur.
