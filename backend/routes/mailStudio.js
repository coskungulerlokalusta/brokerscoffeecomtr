// E-posta Stüdyosu uç noktaları: yönetim (şablon, görev, kayıt) + herkese açık izleme ve abonelikten çıkma
const express = require('express');
const crypto = require('crypto');
const adminAuth = require('../utils/adminAuth');
const customerAuth = require('../utils/customerAuth');
const mailer = require('../utils/mailer');
const M = require('../utils/mailStudio');

const admin = express.Router();
const pub = express.Router();

const idParam = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) { const e = new Error('Geçersiz kimlik'); e.status = 400; throw e; }
  return n;
};
const fail = (res, err) => res.status(err.status || 400).json({ error: err.message || 'İşlem başarısız' });
const outTpl = (t) => ({ id: t.id, name: t.name, subject: t.subject, preheader: t.preheader, kind: t.kind, blocks: safe(t.blocks, []), theme: safe(t.theme, {}), updatedAt: Number(t.updated_at) });
const safe = (v, d) => { try { return typeof v === 'string' ? JSON.parse(v) : v || d; } catch { return d; } };
const outRule = (r) => ({ id: r.id, name: r.name, templateId: r.template_id, trigger: r.trigger_key, audience: r.audience, delayMin: r.delay_min, sendAt: r.send_at ? Number(r.send_at) : null,
  quietHours: !!r.quiet_hours, subjectB: r.subject_b, active: !!r.active, firedAt: r.fired_at ? Number(r.fired_at) : null,
  days: String(r.days || '').split(',').filter((x) => x !== '').map(Number), atTime: r.at_time || '' });
// önizleme ve deneme için yöneticiye ait örnek kişi
const sampleVars = () => M.varsOf({ name: 'Ayşe Yılmaz', email: 'ornek@brokerscoffee.com.tr', loyaltyPoints: 120 });

admin.use(adminAuth.requireAuth);

admin.get('/', async (req, res) => {
  const templates = await M.q('SELECT * FROM mail_templates ORDER BY updated_at DESC');
  const rules = await M.q('SELECT * FROM mail_rules ORDER BY created_at');
  const stats = await M.q(`SELECT rule_id, variant,
      SUM(status = 'queued') AS queued, SUM(status = 'sent') AS sent, SUM(status = 'skipped') AS skipped, SUM(status = 'failed') AS failed,
      SUM(opened_at IS NOT NULL) AS opened, SUM(clicked_at IS NOT NULL) AS clicked
    FROM mail_sends WHERE rule_id IS NOT NULL GROUP BY rule_id, variant`);
  const st = (rid) => {
    const rs = stats.filter((s) => s.rule_id === rid);
    const sum = (k, v) => rs.filter((s) => !v || s.variant === v).reduce((a, s) => a + Number(s[k] || 0), 0);
    return { queued: sum('queued'), sent: sum('sent'), skipped: sum('skipped'), failed: sum('failed'), opened: sum('opened'), clicked: sum('clicked'),
      ab: { A: { sent: sum('sent', 'A'), opened: sum('opened', 'A') }, B: { sent: sum('sent', 'B'), opened: sum('opened', 'B') } } };
  };
  const [week] = await M.q(`SELECT SUM(status = 'sent') AS sent, SUM(opened_at IS NOT NULL) AS opened, SUM(clicked_at IS NOT NULL) AS clicked, SUM(status = 'queued') AS queued
    FROM mail_sends WHERE created_at > ? AND status != 'test'`, [Date.now() - 30 * 86400e3]);
  const customers = (await customerAuth.loadCustomers()).filter((c) => c.active !== false);
  const cfg = await mailer.getConfig();
  res.json({
    ready: cfg.ready, from: cfg.from,
    totals: { sent: Number(week.sent || 0), opened: Number(week.opened || 0), clicked: Number(week.clicked || 0), queued: Number(week.queued || 0),
      users: customers.length, withEmail: customers.filter((c) => M.validEmail(c.email)).length, optin: customers.filter((c) => M.validEmail(c.email) && c.marketingConsentAt).length },
    templates: templates.map((t) => ({ ...outTpl(t), uses: rules.filter((r) => r.template_id === t.id).length })),
    rules: rules.map((r) => ({ ...outRule(r), stats: st(r.id) })),
    starters: M.STARTERS.map((s) => ({ key: s.key, icon: s.icon, name: s.tpl().name, desc: s.desc, trigger: s.trigger })),
    lists: await listSummaries(),
  });
});

admin.get('/templates/:id', async (req, res) => {
  const [t] = await M.q('SELECT * FROM mail_templates WHERE id = ?', [idParam(req)]);
  if (!t) return res.status(404).json({ error: 'Şablon bulunamadı' });
  res.json({ template: outTpl(t) });
});

admin.post('/templates', async (req, res) => {
  try {
    const b = req.body || {};
    let tpl;
    if (b.starter) {
      const s = M.STARTERS.find((x) => x.key === b.starter);
      if (!s) return res.status(400).json({ error: 'Hazır şablon bulunamadı' });
      tpl = s.tpl();
    } else if (b.copyOf) {
      const [t] = await M.q('SELECT * FROM mail_templates WHERE id = ?', [Number(b.copyOf)]);
      if (!t) return res.status(404).json({ error: 'Şablon bulunamadı' });
      tpl = M.cleanTemplate({ ...t, name: (t.name + ' (kopya)').slice(0, 80) });
    } else {
      tpl = M.cleanTemplate({ name: String(b.name || 'Yeni e-posta'), subject: '', blocks: [M.B('heading', { text: 'Merhaba {ad},' }), M.B('text', { text: 'Buraya mesajını yaz.' }), M.B('button', { text: 'Siteye git', url: '/' })] });
    }
    const now = Date.now();
    const r = await M.q('INSERT INTO mail_templates (name, subject, preheader, kind, blocks, theme, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [tpl.name, tpl.subject, tpl.preheader, tpl.kind, JSON.stringify(tpl.blocks), JSON.stringify(tpl.theme), now, now]);
    res.status(201).json({ id: r.insertId });
  } catch (err) { fail(res, err); }
});

admin.put('/templates/:id', async (req, res) => {
  try {
    const t = M.cleanTemplate(req.body);
    const id = idParam(req);
    const r = await M.q('UPDATE mail_templates SET name = ?, subject = ?, preheader = ?, kind = ?, blocks = ?, theme = ?, updated_at = ? WHERE id = ?',
      [t.name, t.subject, t.preheader, t.kind, JSON.stringify(t.blocks), JSON.stringify(t.theme), Date.now(), id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Şablon bulunamadı' });
    const [row] = await M.q('SELECT * FROM mail_templates WHERE id = ?', [id]);
    res.json({ template: outTpl(row) });
  } catch (err) { fail(res, err); }
});

admin.delete('/templates/:id', async (req, res) => {
  const id = idParam(req);
  const r = await M.q('DELETE FROM mail_templates WHERE id = ?', [id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Şablon bulunamadı' });
  // şablonu kullanan görevler de silinir, sıradaki gönderimleri iptal olur
  await M.q("UPDATE mail_sends SET status = 'skipped', note = 'Şablon silindi' WHERE template_id = ? AND status = 'queued'", [id]);
  await M.q('DELETE FROM mail_rules WHERE template_id = ?', [id]);
  res.json({ ok: true });
});

// canlı önizleme: kaydedilmemiş şablonu örnek kişi bilgileriyle çizer (gönderimle aynı çizici)
admin.post('/render', async (req, res) => {
  try {
    const t = M.cleanTemplate({ ...req.body, name: (req.body && req.body.name) || 'Önizleme' });
    const o = M.origin();
    const r = M.renderMail(t, { origin: o, kind: t.kind, vars: sampleVars(), products: await M.loadProducts(t.blocks), unsub: t.kind === 'marketing' ? o + '/api/m/u/ornek' : undefined, mark: !!req.body.mark });
    res.json({ subject: r.subject, html: r.html });
  } catch (err) { fail(res, err); }
});

admin.post('/templates/:id/test', async (req, res) => {
  try {
    const to = String((req.body && req.body.to) || '').trim();
    if (!M.validEmail(to)) return res.status(400).json({ error: 'Deneme için geçerli bir e-posta adresi gir' });
    const [row] = await M.q('SELECT * FROM mail_templates WHERE id = ?', [idParam(req)]);
    if (!row) return res.status(404).json({ error: 'Şablon bulunamadı' });
    const tpl = M.cleanTemplate(row);
    const r = M.renderMail(tpl, { origin: M.origin(), kind: tpl.kind, vars: sampleVars(), products: await M.loadProducts(tpl.blocks) });
    const cfg = await mailer.getConfig();
    if (!cfg.ready) return res.status(400).json({ error: 'E-posta servisi bağlı değil. Önce Entegrasyonlar > E-posta (SMTP) bölümüne Hostinger e-posta adresini ve şifresini gir.' });
    const ok = await mailer.sendMail({ to, subject: '[Deneme] ' + (r.subject || tpl.name), text: r.text, html: r.html });
    const now = Date.now();
    await M.q("INSERT INTO mail_sends (template_id, email, subject, status, note, token, due_at, sent_at, created_at) VALUES (?,?,?,'test',?,?,?,?,?)",
      [row.id, to, (r.subject || '').slice(0, 190), ok ? `Deneme (${cfg.via === 'smtp' ? 'SMTP' : 'Resend'})` : ('Gönderilemedi: ' + mailer.state.lastError).slice(0, 190), M.token(), now, now, now]);
    if (!ok) return res.status(502).json({ error: 'E-posta gönderilemedi. Sebep: ' + (mailer.state.lastError || 'bilinmiyor') });
    res.json({ ok: true, to, via: cfg.via, from: cfg.from });
  } catch (err) { fail(res, err); }
});

admin.get('/audience', async (req, res) => {
  const audience = M.isAudience(req.query.audience) ? req.query.audience : 'all';
  const marketing = req.query.kind === 'marketing';
  const [a, all] = await Promise.all([M.audienceList(audience, marketing), M.audienceList(audience, false)]);
  res.json({ count: a.length, total: all.length });
});

// görev doğrulama
async function cleanRule(b, cur) {
  const v = { ...(cur || {}), ...(b || {}) };
  const out = {
    name: String(v.name || '').trim().slice(0, 80),
    templateId: Number(v.templateId),
    trigger: M.TRIGGERS.includes(v.trigger) ? v.trigger : null,
    audience: M.isAudience(v.audience) ? v.audience : 'all',
    delayMin: Math.min(129600, Math.max(0, Math.round(Number(v.delayMin) || 0))),
    sendAt: v.sendAt ? Number(new Date(v.sendAt)) : null,
    quietHours: v.quietHours !== false,
    subjectB: v.subjectB ? String(v.subjectB).trim().slice(0, 150) || null : null,
    active: !!v.active,
    days: [...new Set((Array.isArray(v.days) ? v.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(),
    atTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v.atTime || '')) ? String(v.atTime) : '',
  };
  const err = (m) => { const e = new Error(m); e.status = 400; throw e; };
  if (!out.trigger) err('Ne zaman gideceğini seç');
  if (!out.name) err('Görevin adı boş olamaz');
  if (out.trigger === 'once' && !(out.sendAt > 0)) err('Tek seferlik gönderim için tarih ve saat seç');
  if (out.trigger !== 'once') out.sendAt = null;
  if (out.trigger === 'inactive') out.delayMin = Math.max(7 * 1440, out.delayMin);
  if (out.trigger === 'schedule') {
    if (!out.days.length) err('Planın hangi günlerde çalışacağını seç');
    if (!out.atTime) err('Planın saatini seç');
    out.quietHours = false; // saat zaten seçildi
    out.delayMin = 0;
  } else { out.days = []; out.atTime = ''; }
  const lm = /^list:(\d+)$/.exec(out.audience);
  if (lm && !(await M.q('SELECT id FROM mail_lists WHERE id = ?', [Number(lm[1])])).length) err('Kişi listesi bulunamadı');
  const [t] = await M.q('SELECT id FROM mail_templates WHERE id = ?', [out.templateId]);
  if (!t) err('Şablon bulunamadı');
  return out;
}

admin.post('/rules', async (req, res) => {
  try {
    const b = await cleanRule(req.body);
    const r = await M.q('INSERT INTO mail_rules (name, template_id, trigger_key, audience, delay_min, send_at, quiet_hours, subject_b, active, created_at, days, at_time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [b.name, b.templateId, b.trigger, b.audience, b.delayMin, b.sendAt, b.quietHours ? 1 : 0, b.subjectB, b.active ? 1 : 0, Date.now(), b.days.join(',') || null, b.atTime || null]);
    // "hemen gönder" ise bir dakika beklemeden kuyruğu çalıştır
    if (b.active && b.trigger === 'once' && b.sendAt <= Date.now() + 60e3) setImmediate(() => M.mailTick().catch(() => null));
    res.status(201).json({ id: r.insertId });
  } catch (err) { fail(res, err); }
});

admin.patch('/rules/:id', async (req, res) => {
  try {
    const id = idParam(req);
    const [cur] = await M.q('SELECT * FROM mail_rules WHERE id = ?', [id]);
    if (!cur) return res.status(404).json({ error: 'Görev bulunamadı' });
    const p = req.body || {};
    const b = await cleanRule(p, outRule(cur));
    if (cur.fired_at && b.trigger === 'once' && (p.sendAt !== undefined || p.audience !== undefined || p.templateId !== undefined) &&
      (Number(new Date(p.sendAt || cur.send_at)) !== Number(cur.send_at) || (p.audience || cur.audience) !== cur.audience || Number(p.templateId || cur.template_id) !== cur.template_id)) {
      return res.status(409).json({ error: 'Bu kampanya gönderildi; değiştirmek yerine yeni bir görev oluştur' });
    }
    await M.q('UPDATE mail_rules SET name = ?, template_id = ?, trigger_key = ?, audience = ?, delay_min = ?, send_at = ?, quiet_hours = ?, subject_b = ?, active = ?, days = ?, at_time = ? WHERE id = ?',
      [b.name, b.templateId, b.trigger, b.audience, b.delayMin, b.sendAt, b.quietHours ? 1 : 0, b.subjectB, b.active ? 1 : 0, b.days.join(',') || null, b.atTime || null, id]);
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

admin.delete('/rules/:id', async (req, res) => {
  const id = idParam(req);
  const r = await M.q('DELETE FROM mail_rules WHERE id = ?', [id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Görev bulunamadı' });
  await M.q("UPDATE mail_sends SET status = 'skipped', note = 'Görev silindi' WHERE rule_id = ? AND status = 'queued'", [id]);
  res.json({ ok: true });
});

/* ---- kişi listeleri (Excel'den yüklenen e-postalar) ---- */
async function listSummaries() {
  const rows = await M.q(`SELECT l.id, l.name, l.created_at, COUNT(c.id) AS total, SUM(c.id IS NOT NULL AND c.unsubscribed_at IS NULL) AS active
    FROM mail_lists l LEFT JOIN mail_list_members lm ON lm.list_id = l.id LEFT JOIN mail_contacts c ON c.id = lm.contact_id
    GROUP BY l.id ORDER BY l.created_at DESC`);
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: Number(r.created_at), total: Number(r.total || 0), active: Number(r.active || 0) }));
}
admin.get('/lists', async (req, res) => res.json({ lists: await listSummaries() }));

// yeni liste oluştur ya da var olana ekle: { name, listId?, contacts: [{ email, name }] }
admin.post('/lists', async (req, res) => {
  try {
    const b = req.body || {};
    const seen = new Set(); const contacts = [];
    for (const c of Array.isArray(b.contacts) ? b.contacts.slice(0, 20000) : []) {
      const email = String((c && c.email) || '').trim().toLowerCase();
      if (!M.validEmail(email) || seen.has(email)) continue;
      seen.add(email); contacts.push([email, String((c && c.name) || '').trim().slice(0, 120)]);
    }
    if (!contacts.length) return res.status(400).json({ error: 'Seçili geçerli e-posta adresi yok' });
    let listId = Number(b.listId) || 0;
    if (listId) {
      if (!(await M.q('SELECT id FROM mail_lists WHERE id = ?', [listId])).length) return res.status(404).json({ error: 'Liste bulunamadı' });
    } else {
      const name = String(b.name || '').trim().slice(0, 120) || 'Excel listesi';
      listId = (await M.q('INSERT INTO mail_lists (name, created_at) VALUES (?, ?)', [name, Date.now()])).insertId;
    }
    const now = Date.now();
    for (let i = 0; i < contacts.length; i += 500) {
      const part = contacts.slice(i, i + 500);
      await M.q("INSERT INTO mail_contacts (email, name, created_at) VALUES ? ON DUPLICATE KEY UPDATE name = IF(VALUES(name) <> '', VALUES(name), name)", [part.map(([e, n]) => [e, n, now])]);
      const ids = await M.q('SELECT id FROM mail_contacts WHERE email IN (?)', [part.map(([e]) => e)]);
      if (ids.length) await M.q('INSERT IGNORE INTO mail_list_members (list_id, contact_id) VALUES ?', [ids.map((r) => [listId, r.id])]);
    }
    const [u] = await M.q(`SELECT COUNT(*) AS n FROM mail_contacts WHERE unsubscribed_at IS NOT NULL AND email IN (?)`, [contacts.map(([e]) => e)]);
    res.status(201).json({ id: listId, added: contacts.length, unsubscribed: Number(u.n || 0) });
  } catch (err) { fail(res, err); }
});

admin.get('/lists/:id', async (req, res) => {
  const id = idParam(req);
  const [l] = await M.q('SELECT id, name, created_at FROM mail_lists WHERE id = ?', [id]);
  if (!l) return res.status(404).json({ error: 'Liste bulunamadı' });
  const rows = await M.q(`SELECT c.id, c.email, c.name, c.unsubscribed_at FROM mail_list_members lm JOIN mail_contacts c ON c.id = lm.contact_id
    WHERE lm.list_id = ? ORDER BY c.email LIMIT 20000`, [id]);
  res.json({ list: { id: l.id, name: l.name, createdAt: Number(l.created_at) }, contacts: rows.map((r) => ({ id: r.id, email: r.email, name: r.name, unsubscribed: !!r.unsubscribed_at })) });
});
admin.put('/lists/:id', async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: 'Liste adı boş olamaz' });
  await M.q('UPDATE mail_lists SET name = ? WHERE id = ?', [name, idParam(req)]);
  res.json({ ok: true });
});
// listeden kişi çıkar: { contactIds: [] }
admin.post('/lists/:id/remove', async (req, res) => {
  const ids = (Array.isArray(req.body && req.body.contactIds) ? req.body.contactIds : []).map(Number).filter((n) => n > 0);
  if (ids.length) await M.q('DELETE FROM mail_list_members WHERE list_id = ? AND contact_id IN (?)', [idParam(req), ids]);
  res.json({ ok: true, removed: ids.length });
});
admin.delete('/lists/:id', async (req, res) => {
  const id = idParam(req);
  const used = await M.q('SELECT name FROM mail_rules WHERE audience = ?', ['list:' + id]);
  if (used.length) return res.status(409).json({ error: `Bu liste şu görevlerde kullanılıyor: ${used.map((u) => u.name).join(', ')}. Önce görevleri sil ya da kitlesini değiştir.` });
  await M.q('DELETE FROM mail_list_members WHERE list_id = ?', [id]);
  await M.q('DELETE FROM mail_lists WHERE id = ?', [id]);
  res.json({ ok: true });
});

admin.get('/sends', async (req, res) => {
  const where = []; const params = [];
  if (Number(req.query.rule) > 0) { where.push('s.rule_id = ?'); params.push(Number(req.query.rule)); }
  if (['queued', 'sent', 'failed', 'skipped', 'test'].includes(req.query.status)) { where.push('s.status = ?'); params.push(req.query.status); }
  const rows = await M.q(`SELECT s.id, s.email, s.customer_id, s.status, s.note, s.subject, s.variant, s.due_at, s.sent_at, s.opened_at, s.clicked_at, t.name AS template, r.name AS rule
    FROM mail_sends s JOIN mail_templates t ON t.id = s.template_id LEFT JOIN mail_rules r ON r.id = s.rule_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.id DESC LIMIT 150`, params);
  const customers = await customerAuth.loadCustomers();
  const kIds = [...new Set(rows.filter((r) => String(r.customer_id || '').startsWith('k:')).map((r) => Number(r.customer_id.slice(2))))];
  const ks = new Map((kIds.length ? await M.q('SELECT id, name FROM mail_contacts WHERE id IN (?)', [kIds]) : []).map((k) => [k.id, k.name]));
  const nameOf = (id) => {
    if (String(id || '').startsWith('k:')) return ks.get(Number(id.slice(2))) || '📋 Listeden';
    const c = id && customers.find((x) => x.id === id); return c ? c.name : null;
  };
  const n = (v) => (v ? Number(v) : null);
  res.json({ sends: rows.map((r) => ({ id: r.id, email: r.email, user: nameOf(r.customer_id), status: r.status, note: r.note, subject: r.subject, variant: r.variant, template: r.template, rule: r.rule,
    dueAt: n(r.due_at), sentAt: n(r.sent_at), openedAt: n(r.opened_at), clickedAt: n(r.clicked_at) })) });
});

// sıradaki bir gönderimi iptal et
admin.delete('/sends/:id', async (req, res) => {
  await M.q("UPDATE mail_sends SET status = 'skipped', note = 'Yönetici iptal etti' WHERE id = ? AND status = 'queued'", [idParam(req)]);
  res.json({ ok: true });
});

/* ---- izleme ve abonelik (herkese açık, jetonla) ---- */
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const tokOk = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(t);
const page = (title, body) => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;background:#f1ece0;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#15171c"><div style="max-width:440px;margin:12vh auto;background:#fff;border-radius:18px;padding:32px;text-align:center"><div style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:#0d1b3d;margin-bottom:12px">Brokers Coffee</div>${body}</div></body></html>`;
const escH = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

pub.get('/o/:t', async (req, res) => {
  if (tokOk(req.params.t)) await M.q('UPDATE mail_sends SET opened_at = ? WHERE token = ? AND opened_at IS NULL', [Date.now(), req.params.t]).catch(() => null);
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, max-age=0' }).send(GIF);
});

pub.get('/c/:t', async (req, res) => {
  const t = req.params.t; const u = String(req.query.u || ''); const s = String(req.query.s || '');
  const want = tokOk(t) ? M.sign(t, u) : '';
  const valid = !!want && /^https?:\/\//i.test(u) && s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want));
  if (!valid) return res.redirect(302, M.origin() + '/');
  const now = Date.now();
  await M.q('UPDATE mail_sends SET clicked_at = COALESCE(clicked_at, ?), opened_at = COALESCE(opened_at, ?) WHERE token = ?', [now, now, t]).catch(() => null);
  res.redirect(302, u);
});

async function findByTok(t) {
  if (!tokOk(t)) return null;
  const [s] = await M.q('SELECT id, customer_id, email FROM mail_sends WHERE token = ?', [t]);
  return s || null;
}
pub.get('/u/:t', async (req, res) => {
  const s = await findByTok(req.params.t);
  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  if (!s || !s.customer_id || s.customer_id === 'k:') return res.send(page('Bağlantı geçersiz', '<p>Bu bağlantı geçersiz ya da süresi dolmuş.</p>'));
  // bağlantı e-posta tarayıcıları tarafından önceden açılabilir; çıkış ancak düğmeyle olur
  res.send(page('Abonelikten çık', `<p style="line-height:1.6">${escH(s.email)} adresine kampanya e-postası gönderilmesin mi?</p><form method="post"><button style="margin-top:12px;background:#0d1b3d;color:#fff;border:0;border-radius:999px;padding:12px 24px;font-size:16px;font-weight:700;cursor:pointer">Abonelikten çık</button></form><p style="font-size:13px;color:#7a7e89;margin-top:18px">Sipariş ve üyelik bilgilendirmeleri gelmeye devam eder.</p>`));
});
pub.post('/u/:t', async (req, res) => {
  const s = await findByTok(req.params.t);
  if (s && String(s.customer_id || '').startsWith('k:')) {
    await M.q('UPDATE mail_contacts SET unsubscribed_at = ? WHERE id = ? AND unsubscribed_at IS NULL', [Date.now(), Number(s.customer_id.slice(2))]);
    await M.q(`UPDATE mail_sends x JOIN mail_templates y ON y.id = x.template_id SET x.status = 'skipped', x.note = 'Abonelikten çıktı'
      WHERE x.customer_id = ? AND x.status = 'queued' AND y.kind = 'marketing'`, [s.customer_id]);
  } else if (s && s.customer_id) {
    const all = await customerAuth.loadCustomers();
    const c = all.find((x) => x.id === s.customer_id);
    if (c && c.marketingConsentAt) { c.marketingConsentAt = null; await customerAuth.saveCustomers(all); }
    await M.q(`UPDATE mail_sends x JOIN mail_templates y ON y.id = x.template_id SET x.status = 'skipped', x.note = 'Abonelikten çıktı'
      WHERE x.customer_id = ? AND x.status = 'queued' AND y.kind = 'marketing'`, [s.customer_id]);
  }
  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.send(page('Abonelikten çıktın', '<p style="line-height:1.6">Tamam, artık kampanya e-postası göndermeyeceğiz. ☕</p><p style="font-size:13px;color:#7a7e89">Fikrini değiştirirsen hesabım sayfasından yeniden izin verebilirsin.</p>'));
});

module.exports = { admin, pub };
