import pool from './db.js';
import { sendPushToTenant } from './pushNotify.js';

const TR_OFFSET_MS = 3 * 3600 * 1000;
function trFrame(realDate) { return new Date(realDate.getTime() + TR_OFFSET_MS); }

// task_templates ile aynı hesaplama mantığı (routes/tasks.js'deki
// computeOccurrences ile aynı) — bir görevin BUGÜN hangi saat(ler)de
// olması gerektiğini hesaplar.
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

// Şu anda "saati gelmiş" (son 5 dakika içinde) ve henüz bildirimi
// gönderilmemiş görevleri bulup, ilgili işletmenin Görevlerim uygulamasına
// push bildirimi gönderir. Her birkaç dakikada bir çağrılması yeterli.
export async function checkAndSendTaskReminders() {
  const now = new Date();
  const [templates] = await pool.query('SELECT * FROM task_templates WHERE active = 1');
  let sent = 0;
  const tenantOpeningCache = {};
  for (const t of templates) {
    if (!(t.tenant_id in tenantOpeningCache)) {
      const [[row]] = await pool.query('SELECT opening_time FROM tenants WHERE id = ?', [t.tenant_id]);
      tenantOpeningCache[t.tenant_id] = row?.opening_time || '00:00:00';
    }
    const [oh, om] = tenantOpeningCache[t.tenant_id].split(':').map(Number);
    let dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), oh, om, 0);
    if (now < dayStart) dayStart.setDate(dayStart.getDate() - 1);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
    const occurrences = computeOccurrences(t, dayStart, dayEnd);
    for (const due of occurrences) {
      const diffMs = now - due;
      if (diffMs < 0 || diffMs > 5 * 60 * 1000) continue; // sadece son 5 dakika içinde saati gelenler
      try {
        await pool.query(
          'INSERT INTO task_notifications_sent (task_template_id, due_at) VALUES (?, ?)',
          [t.id, due]
        );
      } catch (e) {
        continue; // zaten gönderilmiş (UNIQUE KEY çakışması) — tekrar gönderme
      }
      await sendPushToTenant(t.tenant_id, {
        app: 'gorevler',
        title: '📋 Görev Zamanı: ' + t.title,
        body: t.description || 'Görevi tamamlamak için uygulamayı açın.',
        data: { taskTemplateId: String(t.id) },
      });
      sent++;
    }
  }
  return sent;
}
