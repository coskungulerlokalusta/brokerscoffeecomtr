import express from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { saveBase64ImageIfNeeded } from '../imageStorage.js';

const router = express.Router();
router.use(requireAuth);

const DAY_MS = 24 * 3600 * 1000;

// Bir görev şablonunun, işletmenin BUGÜNKÜ iş gününde (açılış-kapanış
// saatleri arasında) hangi saatlerde "olması gerektiğini" hesaplar.
function computeOccurrences(template, dayStart, dayEnd) {
  const occurrences = [];
  const dateBase = new Date(dayStart);
  if (template.recurrence_type === 'daily' && template.time_of_day) {
    const [h, m] = template.time_of_day.split(':').map(Number);
    const t = new Date(dateBase); t.setHours(h, m, 0, 0);
    occurrences.push(t);
  } else if (template.recurrence_type === 'interval' && template.interval_hours) {
    let t = new Date(dayStart);
    while (t <= dayEnd) { occurrences.push(new Date(t)); t = new Date(t.getTime() + template.interval_hours * 3600 * 1000); }
  } else if (template.recurrence_type === 'weekly' && template.time_of_day != null && template.day_of_week != null) {
    if (dateBase.getDay() === template.day_of_week) {
      const [h, m] = template.time_of_day.split(':').map(Number);
      const t = new Date(dateBase); t.setHours(h, m, 0, 0);
      occurrences.push(t);
    }
  } else if (template.recurrence_type === 'monthly' && template.time_of_day != null && template.day_of_month != null) {
    if (dateBase.getDate() === template.day_of_month) {
      const [h, m] = template.time_of_day.split(':').map(Number);
      const t = new Date(dateBase); t.setHours(h, m, 0, 0);
      occurrences.push(t);
    }
  }
  return occurrences;
}

async function getBusinessDayRange(tenantId) {
  const [[tenant]] = await pool.query('SELECT opening_time, closing_time FROM tenants WHERE id = ?', [tenantId]);
  const now = new Date();
  const opening = tenant?.opening_time || '00:00:00';
  const closing = tenant?.closing_time || '23:59:00';
  const [oh, om] = opening.split(':').map(Number);
  const [ch, cm] = closing.split(':').map(Number);
  let dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), oh, om, 0);
  if (now < dayStart) dayStart.setDate(dayStart.getDate() - 1);
  const dayEnd = new Date(dayStart); dayEnd.setHours(ch, cm, 0, 0);
  if (dayEnd <= dayStart) dayEnd.setDate(dayEnd.getDate() + 1); // kapanış gece yarısını geçiyorsa
  return { dayStart, dayEnd, now };
}

// ---------------- PATRON TARAFI: Görev şablonu yönetimi ----------------
// Görev tanımlama/düzenleme/silme sadece işletme sahibine (owner) açık —
// normal personel bunları görebilir ama değiştiremez.
function requireOwner(req, res, next) {
  if (req.role !== 'owner') return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
  next();
}

router.get('/templates', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT t.*, u.name as assigned_name FROM task_templates t
     LEFT JOIN users u ON u.id = t.assigned_to
     WHERE t.tenant_id = ? ORDER BY t.created_at DESC`,
    [req.tenantId]
  );
  res.json(rows);
});

router.post('/templates', requireOwner, async (req, res) => {
  const { title, description, recurrence_type, time_of_day, interval_hours, day_of_week, day_of_month, requires_photo, assigned_to } = req.body;
  if (!title || !recurrence_type) return res.status(400).json({ error: 'Başlık ve tekrar tipi gerekli' });
  const [result] = await pool.query(
    `INSERT INTO task_templates (tenant_id, title, description, recurrence_type, time_of_day, interval_hours, day_of_week, day_of_month, requires_photo, assigned_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.tenantId, title, description || null, recurrence_type, time_of_day || null, interval_hours || null, day_of_week ?? null, day_of_month ?? null, requires_photo !== false ? 1 : 0, assigned_to || null]
  );
  res.json({ id: result.insertId });
});

router.patch('/templates/:id', requireOwner, async (req, res) => {
  const allowed = ['title', 'description', 'recurrence_type', 'time_of_day', 'interval_hours', 'day_of_week', 'day_of_month', 'requires_photo', 'assigned_to', 'active'];
  const sets = [], values = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) { sets.push(`${key} = ?`); values.push(req.body[key]); }
  }
  if (sets.length === 0) return res.json({ ok: true });
  values.push(req.params.id, req.tenantId);
  await pool.query(`UPDATE task_templates SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, values);
  res.json({ ok: true });
});

router.delete('/templates/:id', requireOwner, async (req, res) => {
  await pool.query('DELETE FROM task_templates WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  res.json({ ok: true });
});

// ---------------- PERSONEL TARAFI: Bugünkü görevlerim ----------------
router.get('/my-tasks', async (req, res) => {
  try {
    const { dayStart, dayEnd, now } = await getBusinessDayRange(req.tenantId);
    const [templates] = await pool.query(
      'SELECT * FROM task_templates WHERE tenant_id = ? AND active = 1 AND (assigned_to IS NULL OR assigned_to = ?)',
      [req.tenantId, req.userId]
    );
    const [completions] = await pool.query(
      `SELECT * FROM task_completions WHERE tenant_id = ? AND due_at BETWEEN ? AND ?`,
      [req.tenantId, dayStart, dayEnd]
    );
    const tasks = [];
    for (const t of templates) {
      const occurrences = computeOccurrences(t, dayStart, dayEnd);
      for (const due of occurrences) {
        if (due > now && due - now > 3600 * 1000) continue; // henüz saati gelmemiş (1 saat öncesinden görünsün)
        const existing = completions.find(c => c.task_template_id === t.id && new Date(c.due_at).getTime() === due.getTime());
        tasks.push({
          templateId: t.id, title: t.title, description: t.description,
          dueAt: due, requiresPhoto: !!t.requires_photo,
          completed: !!(existing && existing.completed_at),
          completedAt: existing?.completed_at || null,
          photoUrl: existing?.photo_url || null,
          missed: !existing?.completed_at && now > due,
        });
      }
    }
    tasks.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
    res.json(tasks);
  } catch (e) { res.status(500).json({ error: 'Görevler alınamadı', detail: e.message }); }
});

router.post('/complete', async (req, res) => {
  const { task_template_id, due_at, photo, note } = req.body;
  try {
    const [[template]] = await pool.query('SELECT * FROM task_templates WHERE id = ? AND tenant_id = ?', [task_template_id, req.tenantId]);
    if (!template) return res.status(404).json({ error: 'Görev bulunamadı' });
    if (template.requires_photo && !photo) return res.status(400).json({ error: 'Bu görev için fotoğraf zorunlu' });
    const [[staff]] = await pool.query('SELECT name FROM users WHERE id = ?', [req.userId]);
    const photoUrl = photo ? await saveBase64ImageIfNeeded(photo) : null;
    await pool.query(
      `INSERT INTO task_completions (tenant_id, task_template_id, due_at, completed_by, completed_at, photo_url, note)
       VALUES (?, ?, ?, ?, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE completed_by = VALUES(completed_by), completed_at = NOW(), photo_url = VALUES(photo_url), note = VALUES(note)`,
      [req.tenantId, task_template_id, due_at, staff?.name || 'Bilinmiyor', photoUrl, note || null]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Görev tamamlanamadı', detail: e.message }); }
});

// ---------------- PATRON TARAFI: Görev geçmişi/durumu ----------------
router.get('/history', requireOwner, async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start ve end gerekli' });
  try {
    const [templates] = await pool.query('SELECT * FROM task_templates WHERE tenant_id = ? AND active = 1', [req.tenantId]);
    const [completions] = await pool.query(
      'SELECT * FROM task_completions WHERE tenant_id = ? AND due_at BETWEEN ? AND ?',
      [req.tenantId, start, end]
    );
    const rows = [];
    let cursor = new Date(start);
    const endDate = new Date(end);
    while (cursor <= endDate) {
      const dayStart = new Date(cursor); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(cursor); dayEnd.setHours(23, 59, 59, 999);
      for (const t of templates) {
        const occurrences = computeOccurrences(t, dayStart, dayEnd);
        for (const due of occurrences) {
          if (due < new Date(start) || due > new Date(end)) continue;
          const existing = completions.find(c => c.task_template_id === t.id && new Date(c.due_at).getTime() === due.getTime());
          rows.push({
            title: t.title, dueAt: due, requiresPhoto: !!t.requires_photo,
            completed: !!(existing && existing.completed_at),
            completedBy: existing?.completed_by || null,
            completedAt: existing?.completed_at || null,
            photoUrl: existing?.photo_url || null,
          });
        }
      }
      cursor = new Date(cursor.getTime() + DAY_MS);
    }
    rows.sort((a, b) => new Date(b.dueAt) - new Date(a.dueAt));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Geçmiş alınamadı', detail: e.message }); }
});

// ---------------- PERSONEL TARAFI: Mola takibi ----------------
// Şu an açık (bitmemiş) bir molası var mı — Görevlerim açılışında buton
// doğru durumda (Molaya Çık / Geldim) görünsün diye kontrol edilir.
router.get('/break/status', async (req, res) => {
  const [[openBreak]] = await pool.query(
    'SELECT id, break_start FROM staff_breaks WHERE tenant_id = ? AND user_id = ? AND break_end IS NULL ORDER BY break_start DESC LIMIT 1',
    [req.tenantId, req.userId]
  );
  res.json({ onBreak: !!openBreak, breakStart: openBreak?.break_start || null });
});

router.post('/break/start', async (req, res) => {
  const [[existing]] = await pool.query(
    'SELECT id FROM staff_breaks WHERE tenant_id = ? AND user_id = ? AND break_end IS NULL',
    [req.tenantId, req.userId]
  );
  if (existing) return res.status(400).json({ error: 'Zaten moladasınız.' });
  await pool.query('INSERT INTO staff_breaks (tenant_id, user_id, break_start) VALUES (?, ?, NOW())', [req.tenantId, req.userId]);
  res.json({ ok: true });
});

router.post('/break/end', async (req, res) => {
  const [[openBreak]] = await pool.query(
    'SELECT id FROM staff_breaks WHERE tenant_id = ? AND user_id = ? AND break_end IS NULL ORDER BY break_start DESC LIMIT 1',
    [req.tenantId, req.userId]
  );
  if (!openBreak) return res.status(400).json({ error: 'Açık bir molanız yok.' });
  await pool.query('UPDATE staff_breaks SET break_end = NOW() WHERE id = ?', [openBreak.id]);
  res.json({ ok: true });
});

// ---------------- PATRON/PANEL TARAFI: Mola raporu ----------------
router.get('/break/report', requireOwner, async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start ve end gerekli' });
  const [rows] = await pool.query(
    `SELECT sb.user_id, u.name, sb.break_start, sb.break_end,
            TIMESTAMPDIFF(MINUTE, sb.break_start, COALESCE(sb.break_end, NOW())) as minutes
     FROM staff_breaks sb JOIN users u ON u.id = sb.user_id
     WHERE sb.tenant_id = ? AND sb.break_start BETWEEN ? AND ?
     ORDER BY sb.break_start DESC`,
    [req.tenantId, start, end]
  );
  const byStaff = {};
  for (const r of rows) {
    if (!byStaff[r.user_id]) byStaff[r.user_id] = { name: r.name, totalMinutes: 0, sessions: [] };
    byStaff[r.user_id].totalMinutes += Number(r.minutes);
    byStaff[r.user_id].sessions.push({ start: r.break_start, end: r.break_end, minutes: Number(r.minutes), stillOnBreak: !r.break_end });
  }
  res.json(Object.values(byStaff));
});

export default router;
