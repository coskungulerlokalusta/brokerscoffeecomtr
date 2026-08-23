import express from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

// Kasa/panelde kullanılabilecek yetki anahtarları — kasa uygulaması buna göre
// buton gösterip gizliyor. Sahip (owner) her zaman tüm yetkilere sahiptir.
export const PERMISSION_KEYS = [
  { key: 'indirim_uygulama', label: 'İndirim Uygulayabilir' },
  { key: 'urun_silme', label: 'Sepetten/Adisyondan Ürün Silebilir' },
  { key: 'adisyon_duzenleme', label: 'Kapanmış Adisyonu Yeniden Açıp Düzenleyebilir' },
  { key: 'manuel_odeme', label: 'Manuel Ödeme Kapatabilir (POS arızasında)' },
  { key: 'raporlari_gorme', label: 'Raporlar Ekranını Görebilir' },
  { key: 'adisyonlari_gorme', label: 'Önceki Adisyonları Görebilir' },
];

// ---- Roller ----
router.get('/roles', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM roles WHERE tenant_id = ?', [req.tenantId]);
  res.json(rows.map(r => ({ ...r, permissions: typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions })));
});

router.post('/roles', async (req, res) => {
  const { name, permissions } = req.body;
  if (!name) return res.status(400).json({ error: 'Rol adı zorunlu' });
  const [result] = await pool.query(
    'INSERT INTO roles (tenant_id, name, permissions) VALUES (?, ?, ?)',
    [req.tenantId, name, JSON.stringify(permissions || {})]
  );
  res.json({ id: result.insertId });
});

router.patch('/roles/:id', async (req, res) => {
  const { name, permissions } = req.body;
  const sets = [], values = [];
  if (name !== undefined) { sets.push('name = ?'); values.push(name); }
  if (permissions !== undefined) { sets.push('permissions = ?'); values.push(JSON.stringify(permissions)); }
  if (sets.length === 0) return res.json({ ok: true });
  values.push(req.params.id, req.tenantId);
  await pool.query(`UPDATE roles SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, values);
  res.json({ ok: true });
});

router.delete('/roles/:id', async (req, res) => {
  await pool.query('UPDATE users SET role_id = NULL WHERE role_id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  await pool.query('DELETE FROM roles WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  res.json({ ok: true });
});

// ---- Personel (CRUD) ----
router.get('/staff', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.role, u.role_id, u.email, r.name as role_name
     FROM users u LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.tenant_id = ? ORDER BY u.id`,
    [req.tenantId]
  );
  res.json(rows);
});

router.post('/staff', async (req, res) => {
  const { name, pin, role_id } = req.body;
  if (!name || !pin || pin.length !== 4) return res.status(400).json({ error: 'İsim ve 4 haneli PIN zorunlu' });
  const [result] = await pool.query(
    'INSERT INTO users (tenant_id, name, role, pin, role_id) VALUES (?, ?, ?, ?, ?)',
    [req.tenantId, name, 'staff', pin, role_id || null]
  );
  res.json({ id: result.insertId });
});

router.patch('/staff/:id', async (req, res) => {
  const { name, pin, role_id } = req.body;
  const sets = [], values = [];
  if (name !== undefined) { sets.push('name = ?'); values.push(name); }
  if (pin !== undefined && pin !== '') { sets.push('pin = ?'); values.push(pin); }
  if (role_id !== undefined) { sets.push('role_id = ?'); values.push(role_id || null); }
  if (sets.length === 0) return res.json({ ok: true });
  values.push(req.params.id, req.tenantId);
  await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, values);
  res.json({ ok: true });
});

// Bir personele (genelde sahip/yönetici) panel/patron girişi (e-posta+şifre)
// tanımlar veya kaldırır — bu, aynı e-postayla birden fazla şubeye eklenirse
// "şube değiştirme" özelliğini de otomatik olarak açar.
router.post('/staff/:id/panel-login', async (req, res) => {
  const { email, password } = req.body;
  if (!email) return res.status(400).json({ error: 'E-posta gerekli' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });
  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query('UPDATE users SET email = ?, password_hash = ? WHERE id = ? AND tenant_id = ?', [email, passwordHash, req.params.id, req.tenantId]);
  res.json({ ok: true });
});

router.delete('/staff/:id/panel-login', async (req, res) => {
  await pool.query('UPDATE users SET email = NULL, password_hash = NULL WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  res.json({ ok: true });
});

router.delete('/staff/:id', async (req, res) => {
  const [[u]] = await pool.query('SELECT role FROM users WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (u && u.role === 'owner') return res.status(400).json({ error: 'İşletme sahibi silinemez' });
  await pool.query('DELETE FROM users WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  res.json({ ok: true });
});

export default router;
