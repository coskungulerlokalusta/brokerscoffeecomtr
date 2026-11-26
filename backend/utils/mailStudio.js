// =========================================================
//  E-posta Stüdyosu (Marka Bahçem'deki stüdyonun Brokers Coffee uyarlaması)
//  - Şablon: yönetimin bloklarla (afiş, başlık, metin, düğme, görsel, ürün, kupon…) tasarladığı e-posta.
//  - Görev: şablonun kime ve ne zaman gideceği. Olaya bağlı (üye olunca, sipariş teslim edilince,
//    bir süredir sipariş vermeyince) ya da belirli bir tarihte bir kitleye.
//  - Kuyruk: her gönderim bir satır; sunucu dakikada bir vakti gelenleri gönderir.
//  - Kampanya e-postası yalnızca izin verene gider, abonelikten çıkma bağlantısı taşır,
//    aynı kişiye 20 saat içinde en fazla bir kampanya e-postası gider; gece 21:00–09:00 arası bekletilir.
//  Veriler MySQL'de üç tabloda tutulur: mail_templates, mail_rules, mail_sends (zamanlar epoch ms).
// =========================================================
const crypto = require('crypto');
const { getPool } = require('./db');
const customerAuth = require('./customerAuth');
const orderStore = require('./orderStore');
const productStore = require('./productStore');
const { sendMail } = require('./mailer');

const origin = () => (process.env.PUBLIC_ORIGIN || 'https://brokerscoffee.com.tr').replace(/\/$/, '');
const SECRET = () => process.env.MAIL_LINK_SECRET || process.env.SESSION_SECRET || process.env.DB_PASSWORD || 'brokers-mail';

/* ---------------- tablolar ---------------- */
let schemaReady = null;
function ensureMailSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = getPool();
      await db.query(`CREATE TABLE IF NOT EXISTS mail_templates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        subject VARCHAR(150) NOT NULL DEFAULT '',
        preheader VARCHAR(150) NOT NULL DEFAULT '',
        kind VARCHAR(12) NOT NULL DEFAULT 'info',
        blocks LONGTEXT,
        theme TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await db.query(`CREATE TABLE IF NOT EXISTS mail_rules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        template_id INT NOT NULL,
        trigger_key VARCHAR(30) NOT NULL,
        audience VARCHAR(20) NOT NULL DEFAULT 'all',
        delay_min INT NOT NULL DEFAULT 0,
        send_at BIGINT NULL,
        quiet_hours TINYINT NOT NULL DEFAULT 1,
        subject_b VARCHAR(150) NULL,
        active TINYINT NOT NULL DEFAULT 0,
        fired_at BIGINT NULL,
        created_at BIGINT NOT NULL,
        INDEX (trigger_key, active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await db.query(`CREATE TABLE IF NOT EXISTS mail_sends (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rule_id INT NULL,
        template_id INT NOT NULL,
        customer_id VARCHAR(64) NULL,
        ref VARCHAR(64) NOT NULL DEFAULT '',
        email VARCHAR(190) NOT NULL,
        variant CHAR(1) NOT NULL DEFAULT 'A',
        subject VARCHAR(190) NULL,
        status VARCHAR(10) NOT NULL DEFAULT 'queued',
        note VARCHAR(190) NULL,
        token VARCHAR(64) NOT NULL,
        due_at BIGINT NOT NULL,
        sent_at BIGINT NULL,
        opened_at BIGINT NULL,
        clicked_at BIGINT NULL,
        created_at BIGINT NOT NULL,
        UNIQUE KEY uniq_token (token),
        UNIQUE KEY uniq_once (rule_id, customer_id, ref),
        INDEX (status, due_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      // Excel'den yüklenen kişiler ve listeleri (üye olmayan e-posta adresleri)
      await db.query(`CREATE TABLE IF NOT EXISTS mail_contacts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(190) NOT NULL,
        name VARCHAR(120) NOT NULL DEFAULT '',
        unsubscribed_at BIGINT NULL,
        created_at BIGINT NOT NULL,
        UNIQUE KEY uniq_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await db.query(`CREATE TABLE IF NOT EXISTS mail_lists (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        created_at BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await db.query(`CREATE TABLE IF NOT EXISTS mail_list_members (
        list_id INT NOT NULL,
        contact_id INT NOT NULL,
        PRIMARY KEY (list_id, contact_id),
        INDEX (contact_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      // düzenli plan için sonradan eklenen sütunlar (eski kurulumlarda tablo zaten var)
      const [cols] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mail_rules'");
      const have = new Set(cols.map((c) => c.COLUMN_NAME));
      if (!have.has('days')) await db.query('ALTER TABLE mail_rules ADD COLUMN days VARCHAR(20) NULL');
      if (!have.has('at_time')) await db.query('ALTER TABLE mail_rules ADD COLUMN at_time VARCHAR(5) NULL');
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}
async function q(sql, params) {
  await ensureMailSchema();
  const [rows] = await getPool().query(sql, params);
  return rows;
}

/* ---------------- şablon doğrulama ---------------- */
const id8 = () => Math.random().toString(36).slice(2, 10);
const COLOR = /^#[0-9a-f]{6}$/i;
const str = (v, max, def = '') => (typeof v === 'string' ? v : def).slice(0, max);
const url = (v, def = '') => { const s = str(v, 500, def).trim(); return !s || s.startsWith('/') || /^https?:\/\//i.test(s) ? s : def; };
const color = (v, def) => (typeof v === 'string' && COLOR.test(v) ? v : def);
const colorOrEmpty = (v, def = '') => (v === '' ? '' : color(v, def));
const oneOf = (v, list, def) => (list.includes(v) ? v : def);
const int = (v, min, max, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const bool = (v, def) => (typeof v === 'boolean' ? v : def);
const ALIGN = ['left', 'center', 'right'];
const FONT = ['serif', 'sans'];
const sec = (b, pt) => ({ bg: colorOrEmpty(b.bg), pt: int(b.pt, 0, 64, pt) });
const cardItem = (i) => ({ image: url(i && i.image), title: str(i && i.title, 80), text: str(i && i.text, 300), link: url(i && i.link) });

const BLOCKS = {
  hero: (b) => ({ title: str(b.title, 120, 'Başlık'), text: str(b.text, 400), image: url(b.image), bg: color(b.bg, '#0d1b3d'), fg: color(b.fg, '#ffffff'),
    align: oneOf(b.align, ALIGN, 'center'), size: oneOf(b.size, ['md', 'lg', 'xl'], 'lg'), pad: oneOf(b.pad, ['sm', 'md', 'lg'], 'md'), btnText: str(b.btnText, 60), btnUrl: url(b.btnUrl) }),
  heading: (b) => ({ text: str(b.text, 160, 'Başlık'), size: oneOf(b.size, ['xl', 'lg', 'md', 'sm'], 'lg'), align: oneOf(b.align, ALIGN, 'left'),
    font: oneOf(b.font, FONT, 'serif'), color: color(b.color, '#0d1b3d'), bold: bool(b.bold, true), italic: bool(b.italic, false), upper: bool(b.upper, false), ...sec(b, 24) }),
  text: (b) => ({ text: str(b.text, 3000), align: oneOf(b.align, ALIGN, 'left'), font: oneOf(b.font, FONT, 'sans'), size: oneOf(b.size, ['sm', 'md', 'lg'], 'md'), color: color(b.color, '#3b3f4a'), ...sec(b, 14) }),
  button: (b) => ({ text: str(b.text, 60, 'Düğme'), url: url(b.url, '/'), align: oneOf(b.align, ALIGN, 'center'), color: colorOrEmpty(b.color), fg: color(b.fg, '#15171c'),
    size: oneOf(b.size, ['sm', 'md', 'lg'], 'md'), shape: oneOf(b.shape, ['pill', 'rounded', 'square'], 'pill'), style: oneOf(b.style, ['solid', 'outline'], 'solid'), full: bool(b.full, false), ...sec(b, 24) }),
  image: (b) => ({ url: url(b.url), alt: str(b.alt, 140), link: url(b.link), width: int(b.width, 20, 100, 100), align: oneOf(b.align, ALIGN, 'center'),
    radius: oneOf(b.radius, ['none', 'sm', 'lg'], 'lg'), caption: str(b.caption, 200), edge: bool(b.edge, false), ...sec(b, 20) }),
  imagetext: (b) => ({ image: url(b.image), alt: str(b.alt, 140), link: url(b.link), side: oneOf(b.side, ['left', 'right'], 'left'), ratio: oneOf(Number(b.ratio), [33, 40, 50], 40),
    valign: oneOf(b.valign, ['top', 'middle'], 'middle'), title: str(b.title, 120), text: str(b.text, 1200), btnText: str(b.btnText, 60), btnUrl: url(b.btnUrl), ...sec(b, 24) }),
  cards: (b) => ({ cols: oneOf(Number(b.cols), [2, 3], 2), items: (Array.isArray(b.items) ? b.items : []).slice(0, 6).map(cardItem), ...sec(b, 20) }),
  products: (b) => ({ title: str(b.title, 100), ids: (Array.isArray(b.ids) ? b.ids : []).filter((x) => typeof x === 'string' && x.length <= 120).slice(0, 6), cols: oneOf(Number(b.cols), [2, 3], 2), ...sec(b, 16) }),
  coupon: (b) => ({ code: str(b.code, 30, 'KOD10'), note: str(b.note, 160), ...sec(b, 24) }),
  divider: (b) => ({ color: color(b.color, '#e7e3da'), thick: int(b.thick, 1, 4, 1), width: int(b.width, 10, 100, 100), ...sec(b, 24) }),
  spacer: (b) => ({ h: int(b.h, 8, 80, 24) }),
  social: (b) => ({ instagram: url(b.instagram), tiktok: url(b.tiktok), whatsapp: url(b.whatsapp), ...sec(b, 24) }),
};

function cleanBlock(b) {
  if (!b || typeof b !== 'object' || !BLOCKS[b.type]) return null;
  return { id: str(b.id, 20) || id8(), type: b.type, ...BLOCKS[b.type](b) };
}
const THEME_DEF = { accent: '#f5c542', accentFg: '#15171c', bg: '#f1ece0', card: '#ffffff', headFont: 'serif', logo: true };
function cleanTheme(t) {
  t = t && typeof t === 'object' ? t : {};
  return { accent: color(t.accent, THEME_DEF.accent), accentFg: color(t.accentFg, THEME_DEF.accentFg), bg: color(t.bg, THEME_DEF.bg), card: color(t.card, THEME_DEF.card),
    headFont: oneOf(t.headFont, FONT, 'serif'), logo: bool(t.logo, true) };
}
const parseJSON = (v, def) => { if (v == null) return def; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return def; } };
function cleanTemplate(t) {
  t = t && typeof t === 'object' ? t : {};
  const name = str(t.name, 80).trim();
  if (!name) { const e = new Error('Şablona bir ad ver'); e.status = 400; throw e; }
  return {
    name, subject: str(t.subject, 150), preheader: str(t.preheader, 150), kind: oneOf(t.kind, ['info', 'marketing'], 'info'),
    blocks: (Array.isArray(parseJSON(t.blocks, [])) ? parseJSON(t.blocks, []) : []).slice(0, 40).map(cleanBlock).filter(Boolean),
    theme: cleanTheme(parseJSON(t.theme, {})),
  };
}

const TRIGGERS = ['signup', 'order_delivered', 'inactive', 'once', 'schedule'];
const AUDIENCES = ['all', 'customers', 'staff'];
// kitle: üye grupları ya da "list:<id>" (Excel'den yüklenen kişi listesi)
const isAudience = (a) => AUDIENCES.includes(a) || /^list:\d{1,9}$/.test(String(a));

/* ---------------- çizim ---------------- */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// {ad}, {adsoyad}, {eposta}, {puan}, {site} değişkenlerini kişinin bilgisiyle doldurur
const fill = (s, v) => String(s || '').replace(/\{(ad|adsoyad|eposta|puan|site)\}/g, (_, k) => (v[k] != null ? String(v[k]) : ''));
const rich = (s, v) => esc(fill(s, v)).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
const abs = (u, o) => (!u ? '' : u.startsWith('/') ? o + u : /^https?:\/\//i.test(u) ? u : '');
const tl = (n) => '₺' + Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// ctx: { origin, vars, products: Map, link?, pixel?, unsub?, kind, mark? }
function renderMail(t, c) {
  const th = { ...THEME_DEF, ...t.theme };
  const href = (u) => { const a = abs(fill(u, c.vars), c.origin); return a ? esc(c.link ? c.link(a) : a) : '#'; };
  const font = "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const serif = "font-family:'Playfair Display',Georgia,'Times New Roman',serif";
  const fam = (f) => (f === 'serif' ? serif : font);
  const headFam = fam(th.headFont);
  const richL = (s) => rich(s, c.vars)
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, tx, u) => `<a href="${href(u.replace(/&amp;/g, '&'))}" style="color:#0d1b3d;text-decoration:underline">${tx}</a>`);
  const plain = (s) => fill(s, c.vars).replace(/\*\*?/g, '').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)');
  const row = (bl, inner, o = {}) => {
    const pt = bl.pt != null ? bl.pt : 20; const bg = bl.bg || '';
    return `<tr><td class="${o.edge ? '' : 'bc-pad'}" style="${bg ? `background:${bg};` : ''}padding:${pt}px ${o.edge ? '0' : '32px'} ${bg ? Math.max(pt, 16) : 0}px;${o.align ? `text-align:${o.align};` : ''}">${inner}</td></tr>`;
  };
  const btnHtml = (text, u, o = {}) => {
    const bg = o.bg || th.accent; const fg = o.fg || (o.bg ? '#ffffff' : th.accentFg);
    const sz = { sm: [10, 20, 14], md: [14, 28, 16], lg: [18, 36, 18] }[o.size || 'md'];
    const rad = { pill: '999px', rounded: '10px', square: '0' }[o.shape || 'pill'];
    const solid = (o.style || 'solid') === 'solid';
    return `<a href="${href(u)}" style="display:${o.full ? 'block' : 'inline-block'};${o.full ? 'text-align:center;' : ''}background:${solid ? bg : 'transparent'};color:${solid ? fg : bg};border:2px solid ${bg};${font};font-size:${sz[2]}px;font-weight:700;text-decoration:none;padding:${sz[0]}px ${sz[1]}px;border-radius:${rad}">${esc(fill(text, c.vars))}</a>`;
  };
  const imgTag = (u, alt, w, radius = '12px', link = '') => {
    const tag = `<img src="${esc(abs(u, c.origin))}" alt="${esc(alt)}" width="${w}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;border-radius:${radius}">`;
    return link ? `<a href="${href(link)}">${tag}</a>` : tag;
  };
  const rows = []; const text = [];
  for (const b of t.blocks) {
    const n0 = rows.length;
    switch (b.type) {
      case 'hero': {
        const pad = { sm: 36, md: 56, lg: 84 }[b.pad]; const ts = { md: 26, lg: 34, xl: 44 }[b.size];
        rows.push(`<tr><td style="background:${b.bg};${b.image ? `background-image:url('${esc(abs(b.image, c.origin))}');background-size:cover;background-position:center;` : ''}padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="bc-pad" style="padding:${pad}px 32px;${b.image ? 'background:rgba(0,0,0,.4);' : ''}text-align:${b.align}"><div style="${headFam};font-size:${ts}px;line-height:1.15;font-weight:700;color:${b.fg}">${richL(b.title)}</div>${b.text ? `<div style="${font};font-size:16px;line-height:1.6;color:${b.fg};opacity:.9;margin-top:14px">${richL(b.text)}</div>` : ''}${b.btnText ? `<div style="margin-top:22px">${btnHtml(b.btnText, b.btnUrl || '/', {})}</div>` : ''}</td></tr></table></td></tr>`);
        text.push(plain(b.title), plain(b.text), b.btnText ? `${fill(b.btnText, c.vars)}: ${abs(fill(b.btnUrl || '/', c.vars), c.origin)}` : '');
        break;
      }
      case 'heading': {
        const sz = { xl: 38, lg: 30, md: 22, sm: 18 }[b.size];
        rows.push(row(b, `<div style="${fam(b.font)};font-size:${sz}px;line-height:1.2;font-weight:${b.bold ? 700 : 400};${b.italic ? 'font-style:italic;' : ''}${b.upper ? 'text-transform:uppercase;letter-spacing:2px;' : ''}color:${b.color}">${richL(b.text)}</div>`, { align: b.align }));
        text.push(plain(b.text));
        break;
      }
      case 'text': {
        const sz = { sm: 14, md: 16, lg: 18 }[b.size];
        rows.push(row(b, `<div style="${fam(b.font)};font-size:${sz}px;line-height:1.65;color:${b.color}">${richL(b.text)}</div>`, { align: b.align }));
        text.push(plain(b.text));
        break;
      }
      case 'button':
        rows.push(row(b, btnHtml(b.text, b.url, { bg: b.color, fg: b.color ? b.fg : '', size: b.size, shape: b.shape, style: b.style, full: b.full }), { align: b.align }));
        text.push(`${fill(b.text, c.vars)}: ${abs(fill(b.url, c.vars), c.origin)}`);
        break;
      case 'image': {
        if (!b.url) break;
        const full = b.edge ? 600 : 536; const w = Math.round(full * b.width / 100);
        const rad = b.edge ? '0' : { none: '0', sm: '6px', lg: '14px' }[b.radius];
        const cap = b.caption ? `<div style="${font};font-size:13px;line-height:1.5;color:#7a7e89;margin-top:8px;text-align:${b.align}">${richL(b.caption)}</div>` : '';
        const margin = b.align === 'center' ? 'margin:0 auto' : b.align === 'right' ? 'margin-left:auto' : '';
        rows.push(row(b, `<table role="presentation" cellpadding="0" cellspacing="0" width="${w}" style="width:${b.width}%;max-width:${w}px;${margin}"><tr><td>${imgTag(b.url, b.alt, w, rad, b.link)}</td></tr></table>${cap}`, { edge: b.edge }));
        if (b.caption) text.push(plain(b.caption));
        break;
      }
      case 'imagetext': {
        const iw = Math.round(536 * b.ratio / 100); const tw = 536 - iw - 20;
        const img = `<td class="bc-col" width="${iw}" valign="${b.valign}" style="width:${iw}px">${b.image ? imgTag(b.image, b.alt, iw, '12px', b.link) : `<div style="height:${Math.round(iw * 0.8)}px;border-radius:12px;background:${th.bg}"></div>`}</td>`;
        const body = `<td class="bc-col" width="${tw}" valign="${b.valign}" style="width:${tw}px;${font}">${b.title ? `<div style="${headFam};font-size:22px;line-height:1.25;font-weight:700;color:#0d1b3d">${richL(b.title)}</div>` : ''}${b.text ? `<div style="font-size:15px;line-height:1.6;color:#3b3f4a;margin-top:8px">${richL(b.text)}</div>` : ''}${b.btnText ? `<div style="margin-top:14px">${btnHtml(b.btnText, b.btnUrl || '/', { size: 'sm' })}</div>` : ''}</td>`;
        const gap = '<td class="bc-gap" width="20" style="width:20px;font-size:0">&nbsp;</td>';
        rows.push(row(b, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${b.side === 'left' ? img + gap + body : body + gap + img}</tr></table>`));
        text.push(plain(b.title), plain(b.text), b.btnText ? `${fill(b.btnText, c.vars)}: ${abs(fill(b.btnUrl || '/', c.vars), c.origin)}` : '');
        break;
      }
      case 'cards': {
        const its = b.items.filter((i) => i.image || i.title || i.text); if (!its.length) break;
        const cw = Math.floor((536 - (b.cols - 1) * 16) / b.cols);
        const cell = (i) => `<td class="bc-col" width="${cw}" valign="top" style="width:${cw}px;${font}">${i.image ? imgTag(i.image, i.title, cw, '10px', i.link) : ''}${i.title ? `<div style="${headFam};font-size:17px;line-height:1.3;font-weight:700;color:#0d1b3d;margin-top:10px">${i.link ? `<a href="${href(i.link)}" style="color:#0d1b3d;text-decoration:none">${richL(i.title)}</a>` : richL(i.title)}</div>` : ''}${i.text ? `<div style="font-size:14px;line-height:1.55;color:#5b5f6a;margin-top:4px">${richL(i.text)}</div>` : ''}</td>`;
        const trs = [];
        for (let k = 0; k < its.length; k += b.cols) {
          const part = its.slice(k, k + b.cols).map(cell);
          while (part.length < b.cols) part.push(`<td class="bc-col" width="${cw}"></td>`);
          trs.push(`<tr>${part.join('<td class="bc-gap" width="16" style="width:16px;font-size:0">&nbsp;</td>')}</tr>${k + b.cols < its.length ? '<tr><td style="height:18px;font-size:0">&nbsp;</td></tr>' : ''}`);
        }
        rows.push(row(b, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${trs.join('')}</table>`));
        its.forEach((i) => text.push([plain(i.title), plain(i.text), i.link ? abs(fill(i.link, c.vars), c.origin) : ''].filter(Boolean).join(' — ')));
        break;
      }
      case 'products': {
        const ps = b.ids.map((i) => c.products.get(i)).filter(Boolean);
        if (!ps.length) break;
        const n = b.cols; const w = n === 3 ? '33%' : '50%';
        const cells = [];
        for (let i = 0; i < ps.length; i += n) {
          const part = ps.slice(i, i + n).map((p) => `<td class="bc-col" width="${w}" valign="top" style="padding:8px"><a href="${href(p.url)}" style="text-decoration:none;color:#0d1b3d;${font}">${p.image ? `<img src="${esc(abs(p.image, c.origin))}" alt="" width="${n === 3 ? 160 : 250}" style="display:block;width:100%;height:auto;border-radius:12px;border:0">` : `<div style="height:160px;border-radius:12px;background:${th.bg}"></div>`}<div style="font-size:12px;color:#7a7e89;margin-top:8px">${esc(p.category)}</div><div style="font-size:15px;line-height:1.35;font-weight:600;margin-top:2px">${esc(p.name)}</div><div style="font-size:15px;font-weight:800;margin-top:4px;color:#0d1b3d">${esc(p.price)}</div></a></td>`);
          while (part.length < n) part.push(`<td class="bc-col" width="${w}"></td>`);
          cells.push(`<tr>${part.join('')}</tr>`);
        }
        rows.push(`<tr><td style="${b.bg ? `background:${b.bg};` : ''}padding:${b.pt}px 24px ${b.bg ? 16 : 0}px">${b.title ? `<div style="${font};font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#0d1b3d;font-weight:800;padding:0 8px 4px">${esc(fill(b.title, c.vars))}</div>` : ''}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cells.join('')}</table></td></tr>`);
        ps.forEach((p) => text.push(`${p.name} — ${p.price}: ${abs(p.url, c.origin)}`));
        break;
      }
      case 'coupon':
        rows.push(row(b, `<div style="border:2px dashed ${th.accent};background:#fffbea;border-radius:14px;padding:18px;${font}"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#7a7e89">Kod</div><div style="font-size:28px;font-weight:800;letter-spacing:3px;color:#0d1b3d;margin-top:4px">${esc(b.code)}</div>${b.note ? `<div style="font-size:14px;color:#5b5f6a;margin-top:6px">${richL(b.note)}</div>` : ''}</div>`, { align: 'center' }));
        text.push(`Kod: ${b.code} ${plain(b.note)}`);
        break;
      case 'divider':
        rows.push(row(b, `<div style="width:${b.width}%;margin:0 auto;border-top:${b.thick}px solid ${b.color};font-size:0;line-height:0">&nbsp;</div>`));
        break;
      case 'spacer':
        rows.push(`<tr><td style="height:${b.h}px;font-size:0;line-height:0">&nbsp;</td></tr>`);
        break;
      case 'social': {
        const ls = [['Instagram', b.instagram], ['TikTok', b.tiktok], ['WhatsApp', b.whatsapp]].filter(([, u]) => u);
        if (ls.length) rows.push(row(b, `<div style="${font};font-size:14px">${ls.map(([n, u]) => `<a href="${href(u)}" style="color:#0d1b3d;font-weight:800;text-decoration:none;margin:0 10px">${n}</a>`).join('·')}</div>`, { align: 'center' }));
        break;
      }
      default: break;
    }
    // düzenleyici önizlemesi: bloğa tıklayınca seçilsin diye satır işaretlenir (gönderilen e-postada yok)
    if (c.mark) for (let i = n0; i < rows.length; i++) rows[i] = rows[i].replace('<tr', `<tr data-b="${esc(b.id)}"`);
  }
  const foot = c.kind === 'marketing'
    ? `Bu e-postayı kampanya bildirimlerine izin verdiğin için aldın.${c.unsub ? ` <a href="${esc(c.unsub)}" style="color:#7a7e89">Abonelikten çık</a>` : ''}`
    : 'Bu e-posta Brokers Coffee üyeliğinle ilgili bilgilendirme amacıyla gönderildi.';
  const pre = fill(t.preheader, c.vars);
  const home = esc(c.link ? c.link(c.origin + '/') : c.origin + '/');
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><style>@media only screen and (max-width:540px){.bc-col{display:block!important;width:100%!important;max-width:100%!important;padding-bottom:14px!important}.bc-gap{display:none!important}.bc-pad{padding-left:20px!important;padding-right:20px!important}}</style><title>${esc(fill(t.subject, c.vars))}</title></head>
<body style="margin:0;padding:0;background:${th.bg}">${pre ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(pre)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${th.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${th.card};border-radius:18px;overflow:hidden">
${th.logo ? `<tr><td style="background:#0d1b3d;padding:18px 32px;text-align:center"><a href="${home}" style="text-decoration:none"><img src="${esc(c.origin + '/icons/icon-192.png')}" width="44" height="44" alt="" style="display:inline-block;vertical-align:middle;width:44px;height:44px;border:0;border-radius:10px"><span style="${serif};font-size:22px;font-weight:700;color:#ffffff;vertical-align:middle;margin-left:10px">Brokers Coffee</span></a></td></tr>` : ''}
${rows.join('\n')}
<tr><td style="padding:32px 32px 28px;${font};font-size:12px;line-height:1.6;color:#7a7e89;text-align:center">${foot}<br>Brokers Coffee · <a href="${esc(c.origin)}" style="color:#7a7e89">${esc(c.origin.replace(/^https?:\/\//, ''))}</a></td></tr>
</table></td></tr></table>${c.pixel ? `<img src="${esc(c.pixel)}" width="1" height="1" alt="" style="display:block;border:0">` : ''}</body></html>`;
  return {
    subject: fill(t.subject, c.vars),
    html,
    text: [...text.filter(Boolean), '', c.kind === 'marketing' && c.unsub ? `Abonelikten çık: ${c.unsub}` : ''].join('\n\n').trim(),
  };
}

async function loadProducts(blocks) {
  const ids = [...new Set(blocks.flatMap((b) => (b.type === 'products' ? b.ids : [])))];
  const m = new Map();
  if (!ids.length) return m;
  const all = await productStore.loadProducts();
  for (const p of all) {
    if (!ids.includes(p.id)) continue;
    const prices = (p.sizes || []).map((s) => Number(s.price) || 0).filter((x) => x > 0);
    const min = prices.length ? Math.min(...prices) : Number(p.basePrice) || 0;
    m.set(p.id, { name: p.name, category: p.subcategory || p.category || '', price: (prices.length > 1 ? tl(min) + "'den" : tl(min)), image: p.image || null, url: `/product.html?id=${encodeURIComponent(p.id)}` });
  }
  return m;
}
const varsOf = (u) => ({ ad: String(u.name || '').trim().split(/\s+/)[0] || '', adsoyad: u.name || '', eposta: u.email || '', puan: u.loyaltyPoints || 0, site: origin().replace(/^https?:\/\//, '') });

/* ---------------- zaman ---------------- */
// Sessiz saatler (İstanbul 21:00–09:00) içine düşen gönderim sabah 09:00'a kayar. İstanbul UTC+3.
function quietShift(ms) {
  const local = new Date(ms + 3 * 3600e3);
  const h = local.getUTCHours();
  if (h >= 9 && h < 21) return ms;
  if (h >= 21) local.setUTCDate(local.getUTCDate() + 1);
  local.setUTCHours(9, 0, 0, 0);
  return local.getTime() - 3 * 3600e3;
}
const token = () => crypto.randomBytes(18).toString('base64url');
// İstanbul (UTC+3) takvim günü ve dakikası
const istDay = (ms) => new Date(ms + 3 * 3600e3).toISOString().slice(0, 10);
function planDue(r, now) {
  const days = String(r.days || '').split(',').filter((x) => x !== '').map(Number);
  const m = /^(\d{2}):(\d{2})$/.exec(r.at_time || '');
  if (!days.length || !m) return false;
  const local = new Date(now + 3 * 3600e3);
  if (!days.includes(local.getUTCDay())) return false;
  const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
  const at = Number(m[1]) * 60 + Number(m[2]);
  if (mins < at || mins > at + 60) return false; // saatinden sonraki 1 saat içinde (sunucu kısa süre kapalı kaldıysa)
  return !r.fired_at || istDay(Number(r.fired_at)) !== istDay(now);
}
const sign = (tok, u) => crypto.createHmac('sha256', SECRET()).update(tok + '\n' + u).digest('base64url').slice(0, 22);
const validEmail = (e) => typeof e === 'string' && e.length <= 190 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

async function enqueue({ ruleId, templateId, customerId, email, ref = '', dueAt }) {
  await q('INSERT IGNORE INTO mail_sends (rule_id, template_id, customer_id, ref, email, token, due_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [ruleId, templateId, customerId, ref, email, token(), dueAt, Date.now()]);
}
// bir kitleyi topluca sıraya alır (binlerce kişi için tek tek sorgu yerine 500'lük paketler)
async function enqueueMany(ruleId, templateId, people, ref, dueAt) {
  const now = Date.now();
  for (let i = 0; i < people.length; i += 500) {
    const rows = people.slice(i, i + 500).map((p) => [ruleId, templateId, String(p.id), ref || '', p.email, token(), dueAt, now]);
    await q('INSERT IGNORE INTO mail_sends (rule_id, template_id, customer_id, ref, email, token, due_at, created_at) VALUES ?', [rows]);
  }
}

// Olay olunca (üye oldu, sipariş teslim edildi) o olaya bağlı etkin görevler için gönderim sıraya girer.
// Asıl işlemi asla bozmaz: hata olursa sessizce geçer.
async function mailEvent(trigger, customerId, ref = '') {
  try {
    if (!customerId) return;
    const rules = await q('SELECT id, template_id, delay_min, quiet_hours FROM mail_rules WHERE trigger_key = ? AND active = 1', [trigger]);
    if (!rules.length) return;
    const c = await customerAuth.findById(customerId);
    if (!c || !validEmail(c.email) || c.active === false) return;
    for (const r of rules) {
      let due = Date.now() + r.delay_min * 60e3;
      if (r.quiet_hours) due = quietShift(due);
      await enqueue({ ruleId: r.id, templateId: r.template_id, customerId: c.id, email: c.email, ref: String(ref || ''), dueAt: due });
    }
  } catch (err) {
    console.error('E-posta olayı sıraya alınamadı:', err.message);
  }
}

// Bir kitlenin üyeleri (kampanya şablonu yalnızca izin verenlere).
// Kişi listesindekiler "k:<id>" kimliğiyle döner; abonelikten çıkanlar hariç.
async function audienceList(audience, marketing) {
  const m = /^list:(\d+)$/.exec(String(audience));
  if (m) {
    const rows = await q(`SELECT c.id, c.email, c.name FROM mail_list_members lm JOIN mail_contacts c ON c.id = lm.contact_id
      WHERE lm.list_id = ? AND c.unsubscribed_at IS NULL`, [Number(m[1])]);
    return rows.filter((r) => validEmail(r.email)).map((r) => ({ id: 'k:' + r.id, email: r.email, name: r.name }));
  }
  const all = await customerAuth.loadCustomers();
  return all.filter((c) => c.active !== false && validEmail(c.email)
    && (!marketing || !!c.marketingConsentAt)
    && (audience === 'customers' ? !c.isStaff : audience === 'staff' ? !!c.isStaff : true));
}

/* ---------------- gönderim işi (dakikada bir) ---------------- */
let ticking = false;
async function mailTick() {
  if (ticking) return { busy: true };
  ticking = true;
  try {
    const o = origin();
    const now = Date.now();
    // 1) tarihi gelen tek seferlik kampanyalar kitleye açılır
    const once = await q(`SELECT r.id, r.template_id, r.audience, r.quiet_hours, t.kind FROM mail_rules r JOIN mail_templates t ON t.id = r.template_id
      WHERE r.trigger_key = 'once' AND r.active = 1 AND r.fired_at IS NULL AND r.send_at <= ?`, [now]);
    for (const r of once) {
      const upd = await q('UPDATE mail_rules SET fired_at = ? WHERE id = ? AND fired_at IS NULL', [now, r.id]);
      if (!upd.affectedRows) continue;
      const due = r.quiet_hours ? quietShift(now) : now;
      const people = await audienceList(r.audience, r.kind === 'marketing');
      await enqueueMany(r.id, r.template_id, people, '', due);
    }
    // 1b) düzenli plan: seçili günlerde, seçili saatte (İstanbul) kitleye; her gün için bir kez
    const plans = await q(`SELECT r.id, r.template_id, r.audience, r.days, r.at_time, r.fired_at, t.kind FROM mail_rules r JOIN mail_templates t ON t.id = r.template_id
      WHERE r.trigger_key = 'schedule' AND r.active = 1`);
    for (const r of plans) {
      if (!planDue(r, now)) continue;
      const upd = await q('UPDATE mail_rules SET fired_at = ? WHERE id = ? AND (fired_at <=> ?)', [now, r.id, r.fired_at]);
      if (!upd.affectedRows) continue;
      const people = await audienceList(r.audience, r.kind === 'marketing');
      await enqueueMany(r.id, r.template_id, people, istDay(now), now);
    }
    // 2) bir süredir sipariş vermeyenler: son siparişten bu yana görevdeki süre geçti (her "ara" için bir kez)
    const idle = await q("SELECT id, template_id, delay_min, quiet_hours FROM mail_rules WHERE trigger_key = 'inactive' AND active = 1");
    if (idle.length) {
      const [customers, orders] = await Promise.all([customerAuth.loadCustomers(), orderStore.loadOrders()]);
      const last = new Map();
      for (const ord of orders) {
        if (ord.orderStatus === 'iptal') continue;
        const c = customers.find((x) => x.id === ord.customerId || x.phone === ord.phone);
        if (!c) continue;
        const t = Date.parse(ord.createdAt) || 0;
        if (!last.has(c.id) || last.get(c.id).t < t) last.set(c.id, { t, id: ord.id });
      }
      for (const r of idle) {
        const gap = Math.max(7 * 1440, r.delay_min) * 60e3;
        const due = r.quiet_hours ? quietShift(now) : now;
        for (const c of customers) {
          const l = last.get(c.id);
          if (!l || c.active === false || !validEmail(c.email)) continue;
          if (l.t > now - gap || l.t < now - gap - 60 * 86400e3) continue; // çok eski müşterilere gitmez
          await enqueue({ ruleId: r.id, templateId: r.template_id, customerId: c.id, email: c.email, ref: l.id, dueAt: due });
        }
      }
    }
    // 3) vakti gelenler gönderilir
    const due = await q(`SELECT s.id, s.token, s.email, s.customer_id, s.rule_id, t.name AS tname, t.subject, t.preheader, t.kind, t.blocks, t.theme, r.subject_b, r.active AS ractive, r.id AS rid
      FROM mail_sends s JOIN mail_templates t ON t.id = s.template_id LEFT JOIN mail_rules r ON r.id = s.rule_id
      WHERE s.status = 'queued' AND s.due_at <= ? ORDER BY s.due_at LIMIT 100`, [now]);
    let sent = 0, skipped = 0, failed = 0, later = 0;
    if (!due.length) return { sent, skipped, failed, later };
    const customers = await customerAuth.loadCustomers();
    const kIds = [...new Set(due.filter((s) => String(s.customer_id || '').startsWith('k:')).map((s) => Number(s.customer_id.slice(2))))];
    const contacts = new Map((kIds.length ? await q('SELECT id, email, name, unsubscribed_at FROM mail_contacts WHERE id IN (?)', [kIds]) : []).map((c) => [c.id, c]));
    const prodCache = new Map();
    let lastSend = 0;
    for (const s of due) {
      const skip = async (note) => { skipped++; await q("UPDATE mail_sends SET status = 'skipped', note = ? WHERE id = ?", [note, s.id]); };
      if (String(s.customer_id || '').startsWith('k:')) {
        // Excel listesinden gelen kişi: üye değil; abonelikten çıkmadıysa kampanya alabilir
        const k = contacts.get(Number(s.customer_id.slice(2)));
        if (s.rule_id && (s.rid == null || !s.ractive)) { await skip('Görev durduruldu'); continue; }
        if (!k) { await skip('Kişi silinmiş'); continue; }
        if (k.unsubscribed_at) { await skip('Abonelikten çıktı'); continue; }
        if (s.kind === 'marketing') {
          const recent = await q(`SELECT x.id FROM mail_sends x JOIN mail_templates y ON y.id = x.template_id
            WHERE x.customer_id = ? AND x.status = 'sent' AND y.kind = 'marketing' AND x.sent_at > ? LIMIT 1`, [s.customer_id, now - 20 * 3600e3]);
          if (recent.length) { later++; await q('UPDATE mail_sends SET due_at = ? WHERE id = ?', [now + 20 * 3600e3, s.id]); continue; }
        }
        s.person = { name: k.name, email: k.email, loyaltyPoints: '' };
      }
      const cust = s.customer_id && !s.person ? customers.find((c) => c.id === s.customer_id) : null;
      if (s.rule_id && (s.rid == null || !s.ractive)) { await skip('Görev durduruldu'); continue; }
      if (s.customer_id && !cust && !s.person) { await skip('Üye silinmiş'); continue; }
      if (cust && cust.active === false) { await skip('Üye pasif'); continue; }
      if (cust && cust.email !== s.email) { await skip('E-posta adresi değişti'); continue; }
      if (s.kind === 'marketing' && !s.person && (!cust || !cust.marketingConsentAt)) { await skip('Kampanya izni yok'); continue; }
      if (s.kind === 'marketing' && cust) {
        // yorgunluk koruması: aynı kişiye 20 saat içinde ikinci kampanya e-postası gitmez, sonraya kayar
        const recent = await q(`SELECT x.id FROM mail_sends x JOIN mail_templates y ON y.id = x.template_id
          WHERE x.customer_id = ? AND x.status = 'sent' AND y.kind = 'marketing' AND x.sent_at > ? LIMIT 1`, [cust.id, now - 20 * 3600e3]);
        if (recent.length) { later++; await q('UPDATE mail_sends SET due_at = ? WHERE id = ?', [quietShift(now + 20 * 3600e3), s.id]); continue; }
      }
      const tpl = cleanTemplate({ name: s.tname, subject: s.subject, preheader: s.preheader, kind: s.kind, blocks: s.blocks, theme: s.theme });
      const variant = s.subject_b && s.id % 2 === 1 ? 'B' : 'A';
      if (variant === 'B') tpl.subject = s.subject_b;
      const pk = JSON.stringify(tpl.blocks.filter((b) => b.type === 'products'));
      if (!prodCache.has(pk)) prodCache.set(pk, await loadProducts(tpl.blocks));
      const unsub = `${o}/api/m/u/${s.token}`;
      const r = renderMail(tpl, {
        origin: o, kind: tpl.kind, products: prodCache.get(pk),
        vars: varsOf(s.person || cust || { name: '', email: s.email }),
        link: (u) => `${o}/api/m/c/${s.token}?u=${encodeURIComponent(u)}&s=${sign(s.token, u)}`,
        pixel: `${o}/api/m/o/${s.token}`,
        unsub,
      });
      // Resend saniyede en fazla 2 isteğe izin verir: gönderimler arasında en az 0,55 sn
      const wait = lastSend + 550 - Date.now(); if (wait > 0) await new Promise((res) => setTimeout(res, wait));
      lastSend = Date.now();
      const ok = await sendMail({ to: s.email, subject: r.subject || tpl.name, text: r.text, html: r.html, ...(tpl.kind === 'marketing' ? { headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}) });
      if (ok) { sent++; await q("UPDATE mail_sends SET status = 'sent', sent_at = ?, subject = ?, variant = ? WHERE id = ?", [Date.now(), r.subject.slice(0, 190), variant, s.id]); }
      else { failed++; await q("UPDATE mail_sends SET status = 'failed', note = ?, subject = ?, variant = ? WHERE id = ?", ['E-posta servisi kabul etmedi ya da bağlı değil', r.subject.slice(0, 190), variant, s.id]); }
    }
    return { sent, skipped, failed, later };
  } finally {
    ticking = false;
  }
}

/* ---------------- hazır şablonlar ---------------- */
const B = (type, rest) => cleanBlock({ id: id8(), type, ...rest });
const T = (o) => cleanTemplate(o);
const STARTERS = [
  { key: 'welcome', icon: '🎉', desc: 'Yeni üyeye ilk merhaba', trigger: 'signup', tpl: () => T({ name: 'Hoş geldin', subject: 'Brokers ailesine hoş geldin {ad} ☕', preheader: 'Her siparişte puan kazanmaya hemen başla', kind: 'info', blocks: [
    B('hero', { title: 'Hoş geldin, {ad}!', text: 'Artık Brokers Coffee üyesisin. Her siparişte puan kazan, puanlarını ödüllere çevir.' }),
    B('text', { text: 'Siparişini uygulamadan ver, **sıra beklemeden** al. Brokers Club\'daki fırsatları ve sadakat ödüllerini kaçırma.' }),
    B('button', { text: 'Sipariş ver', url: '/siparis.html' }),
    B('spacer', { h: 16 })] }) },
  { key: 'review', icon: '⭐', desc: 'Sipariş teslim edildikten sonra teşekkür', trigger: 'order_delivered', tpl: () => T({ name: 'Afiyet olsun', subject: 'Afiyet olsun {ad} ☕', preheader: 'Siparişin nasıldı?', kind: 'info', blocks: [
    B('heading', { text: 'Afiyet olsun, {ad}!', align: 'center' }),
    B('text', { text: 'Bizi tercih ettiğin için teşekkürler. Bu siparişle kazandığın puanlar hesabına eklendi; toplam puanın: **{puan}**.', align: 'center' }),
    B('button', { text: 'Puanlarımı gör', url: '/loyalty.html' })] }) },
  { key: 'missyou', icon: '💛', desc: 'Bir süredir gelmeyene "seni özledik"', trigger: 'inactive', tpl: () => T({ name: 'Seni özledik', subject: '{ad}, kahven soğumasın ☕', preheader: 'Bir süredir görüşemedik', kind: 'marketing', blocks: [
    B('hero', { title: 'Seni özledik!', text: 'Bir süredir uğramadın. Favori kahven seni bekliyor.' }),
    B('coupon', { code: 'TEKRAR10', note: 'Bir sonraki siparişinde geçerli.' }),
    B('button', { text: 'Sipariş ver', url: '/siparis.html' })] }) },
  { key: 'campaign', icon: '📣', desc: 'Kampanya duyurusu (ürünler ve kod)', trigger: 'once', tpl: () => T({ name: 'Kampanya duyurusu', subject: 'Bu hafta Brokers\'ta 🎁', preheader: 'Seçili içeceklerde fırsat', kind: 'marketing', blocks: [
    B('hero', { title: 'Bu haftaya özel', text: 'Seçili içeceklerde fırsatlar başladı.', bg: '#0d1b3d' }),
    B('products', { title: 'Öne çıkanlar', ids: [] }),
    B('coupon', { code: 'BROKERS10', note: 'Pazar gece yarısına kadar geçerli.' }),
    B('button', { text: 'Menüye göz at', url: '/menu.html' })] }) },
  { key: 'newmenu', icon: '🍂', desc: 'Görsel + yazı ve kartlarla yeni menü bülteni', trigger: 'once', tpl: () => T({ name: 'Yeni sezon menüsü', subject: '{ad}, yeni sezon lezzetleri geldi 🍂', preheader: 'Menümüze yeni eklenenler', kind: 'marketing', blocks: [
    B('hero', { title: 'Yeni sezon menüsü', text: 'Mevsimin tatlarıyla hazırlanan yeni içecekler ve tatlılar.', size: 'xl', btnText: 'Menüyü gör', btnUrl: '/menu.html' }),
    B('heading', { text: 'Merhaba {ad},', size: 'md', font: 'sans', pt: 28 }),
    B('text', { text: 'Bu sezon menümüze **yeni lezzetler** ekledik. Beğendiklerini sipariş ederken puan kazanmayı unutma.' }),
    B('imagetext', { title: 'Haftanın içeceği', text: 'Barista önerisi; sıcak ya da buzlu.', btnText: 'Sipariş ver', btnUrl: '/siparis.html', side: 'left', ratio: 40 }),
    B('cards', { cols: 3, items: [{ title: 'Sıcak kahveler', text: 'Klasikler', link: '/menu.html' }, { title: 'Soğuk içecekler', text: 'Ferahlatan', link: '/menu.html' }, { title: 'Tatlılar', text: 'Yanına', link: '/menu.html' }] }),
    B('divider', { width: 40, pt: 28 }),
    B('button', { text: 'Tüm menü', url: '/menu.html', size: 'lg' })] }) },
];

module.exports = {
  ensureMailSchema, q, cleanTemplate, cleanBlock, renderMail, loadProducts, varsOf, quietShift, token, sign,
  mailEvent, mailTick, audienceList, validEmail, origin, STARTERS, TRIGGERS, AUDIENCES, isAudience, B, planDue, istDay,
};
