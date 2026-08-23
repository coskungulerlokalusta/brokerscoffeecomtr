import express from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

// ---- Yazıcı ayarları (Mutfak/Bar — her istasyon için bir tane) ----
router.get('/', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM printer_config WHERE tenant_id = ?', [req.tenantId]);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { station, printer_name, ip, port } = req.body;
  if (!station) return res.status(400).json({ error: 'İstasyon adı zorunlu' });
  await pool.query(
    `INSERT INTO printer_config (tenant_id, station, printer_name, ip, port)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE printer_name=VALUES(printer_name), ip=VALUES(ip), port=VALUES(port)`,
    [req.tenantId, station, printer_name || null, ip || null, port || 9100]
  );
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM printer_config WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  res.json({ ok: true });
});

// ---- Garson (telefon) uygulamasından gelen yazdırma isteği ----
// Telefonun kendi yazıcısı olmadığı için, seçilen istasyona (örn. "Bahçe")
// kuyruğa bir fiş bırakıyoruz — o istasyon olarak ayarlanmış Kasa terminali
// bunu birkaç saniye içinde çekip kendi bağlı yazıcısından basıyor.
router.post('/jobs', async (req, res) => {
  const { station, content_html } = req.body;
  if (!station || !content_html) return res.status(400).json({ error: 'station ve content_html gerekli' });
  await pool.query(
    `INSERT INTO print_jobs (tenant_id, order_id, station, content, content_html) VALUES (?, NULL, ?, '', ?)`,
    [req.tenantId, station, content_html]
  );
  res.json({ ok: true });
});

// ---- Bekleyen fiş kuyruğu — Bridge programı periyodik olarak bunu çeker ----
router.get('/jobs/pending', async (req, res) => {
  const { station } = req.query;
  let sql = `SELECT * FROM print_jobs WHERE tenant_id = ? AND status = 'bekliyor'`;
  const params = [req.tenantId];
  if (station) { sql += ' AND station = ?'; params.push(station); }
  sql += ' ORDER BY created_at ASC LIMIT 20';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

router.patch('/jobs/:id', async (req, res) => {
  const { status } = req.body; // 'yazdirildi' | 'hata'
  await pool.query(
    `UPDATE print_jobs SET status = ?, printed_at = ${status === 'yazdirildi' ? 'NOW()' : 'NULL'} WHERE id = ? AND tenant_id = ?`,
    [status, req.params.id, req.tenantId]
  );
  res.json({ ok: true });
});

export default router;
