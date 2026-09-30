// Mobil uygulama görünümlü sitenin yönetim panelinden düzenlenen içeriği:
// mağaza durumu, slider, fırsatlar, kategori kartları, ürün rafları, Club metinleri,
// iletişim/sosyal medya, SSS ve duyuru bandı. Hepsi tek bir kv anahtarında tutulur.
const crypto = require('crypto');
const kv = require('./kvStore');

const KEY = 'app_config';
const AUDIENCES = ['both', 'customer', 'staff'];

// Anasayfa ve Sipariş Ver ekranındaki bölümler — panelden sırası değiştirilir, açılıp kapatılır
const LAYOUT_KEYS = {
  home: ['hello', 'slider', 'quick', 'club', 'offers', 'rails', 'categories', 'about', 'store'],
  siparis: ['store', 'slider', 'orders', 'categories'],
};

const DEFAULTS = {
  brand: {
    name: 'Brokers Coffee',
    tagline: 'Günün ritüeli, kapına kadar.',
  },
  store: {
    // open: her zaman sipariş alır (varsayılan, eski davranış), auto: çalışma saatlerine göre, closed: kapalı
    mode: 'open',
    openTime: '10:30',
    closeTime: '21:30',
    closedMessage: 'Yoğunluk nedeniyle şu an siparişe kapalıyız. Kısa süre sonra tekrar deneyin.',
    address: 'Turgut Özal Mah., E-5 Yanyolu No:50, Torium AVM 1. Kat, 34513 Esenyurt/İstanbul',
    mapsUrl: 'https://maps.google.com/?q=Torium+AVM+Esenyurt',
    deliveryNote: '750 TL üzeri siparişlerde kurye ücretsiz',
    prepMinutes: 15,
  },
  announcement: { active: false, text: '', tone: 'gold', audience: 'both' },
  slides: [
    {
      id: 's1', active: true, audience: 'both', theme: 'navy',
      eyebrow: 'Torium AVM · Esenyurt',
      title: 'Günün Ritüeli, Kapına Kadar.',
      subtitle: 'Taze demlenmiş kahveler, sipariş üzerine pişen kruvasanlar.',
      ctaText: 'Sipariş Ver', link: '/siparis.html',
      image: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?q=80&w=1400&auto=format&fit=crop',
    },
    {
      id: 's2', active: true, audience: 'both', theme: 'gold',
      eyebrow: 'Brokers Club',
      title: 'Her Siparişte Puan Kazan.',
      subtitle: 'Puanlarını ücretsiz kahveye ve sürprizlere dönüştür.',
      ctaText: 'Club\'a Katıl', link: '/club.html',
      image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?q=80&w=1400&auto=format&fit=crop',
    },
  ],
  offers: [
    {
      id: 'o1', active: true, audience: 'both', group: 'Fırsatlar', badge: 'HEDİYE',
      title: 'Kahvenin yanına kruvasan bizden!',
      description: '2 kahve alana tereyağlı kruvasan hediye.',
      image: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=900&auto=format&fit=crop',
      link: '/siparis.html', expiresAt: null,
    },
  ],
  categories: {}, // { "Kategori Adı": { image, badge, hidden } }
  rails: [
    { id: 'r1', active: true, audience: 'both', title: 'Cazip Teklifler', subtitle: 'Bugün en çok tercih edilenler', productIds: [] },
    { id: 'r2', active: true, audience: 'both', title: 'En Sevilenler', subtitle: 'Müdavimlerin favorileri', productIds: [] },
  ],
  club: {
    title: 'Brokers Club',
    headline: 'Sipariş ver, puanları topla',
    text: 'Siparişlerinde puan biriktir, ödülleri al ve sana özel fırsatları kaçırma. Üyelik ücretsiz.',
  },
  about: {
    title: 'Sipariş Üzerine, O An Pişer.',
    text: 'Kruvasanlarımızı önceden pişirip vitrinde bekletmiyoruz. Siz sipariş verdiğiniz anda fırına giriyor; sıcacık, çıtır ve tam kıvamında elinize ulaşıyor.',
    image: 'https://images.unsplash.com/photo-1521017432531-fbd92d768814?q=80&w=1000&auto=format&fit=crop',
  },
  contact: {
    phone: '0532 642 47 38',
    whatsapp: '905326424738',
    email: '',
    instagram: '', facebook: '', tiktok: '', youtube: '', x: '',
  },
  layout: {
    home: LAYOUT_KEYS.home.map((key) => ({ key, on: true })),
    siparis: LAYOUT_KEYS.siparis.map((key) => ({ key, on: true })),
  },
  quick: [
    { id: 'q1', active: true, icon: '🛵', label: 'Sipariş Ver', link: '/siparis.html' },
    { id: 'q2', active: true, icon: '🎁', label: 'Fırsatlar', link: '/club.html#firsatlar' },
    { id: 'q3', active: true, icon: '☕', label: 'Menü', link: '/menu.html' },
    { id: 'q4', active: true, icon: '⭐', label: 'Club', link: '/club.html' },
  ],
  moreLinks: [], // Diğer menüsüne eklenen özel bağlantılar
  pages: [], // Panelden oluşturulan bilgi sayfaları (/sayfa.html?s=slug)
  faq: [
    { q: 'Siparişim ne kadar sürede hazırlanır?', a: 'Siparişler ortalama 10-15 dakikada hazırlanır. Kurye siparişlerinde teslim süresi mesafeye göre değişir.' },
    { q: 'Kurye ücreti var mı?', a: '750 TL ve üzeri siparişlerde kurye ücretsizdir.' },
    { q: 'Puanlarımı nasıl kullanırım?', a: 'Brokers Club sayfasından yeterli puanın olan ödülü seçip "Kullan"a bas; kasada göstereceğin kodu alırsın.' },
    { q: 'Siparişimi iptal edebilir miyim?', a: 'Hazırlanmaya başlamamış siparişler için WhatsApp hattımızdan bize ulaşabilirsin.' },
  ],
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function str(v, max = 500) {
  if (v === null || v === undefined) return '';
  return String(v).slice(0, max);
}
function audience(v) { return AUDIENCES.includes(v) ? v : 'both'; }
function id(v) { return v && /^[a-zA-Z0-9_-]{1,40}$/.test(v) ? v : crypto.randomUUID().slice(0, 8); }
function time(v, fallback) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(v || '') ? v : fallback; }
// Görsel alanları: sadece http(s) veya kendi /api/images/ adreslerimiz kabul edilir
function imageUrl(v) {
  const s = str(v, 1000).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s) || s.startsWith('/api/images/') || s.startsWith('/icons/')) return s;
  return '';
}
// Bağlantılar: site içi yol veya http(s). javascript: gibi şeyler kabul edilmez
function link(v) {
  const s = str(v, 500).trim();
  if (!s) return '';
  if (s.startsWith('/') || /^https?:\/\//i.test(s)) return s;
  return '';
}

// Panelden gelen veriyi temizleyip beklenen şekle sokar — bilinmeyen alanlar atılır
function sanitize(input) {
  const d = clone(DEFAULTS);
  const src = input || {};
  const b = src.brand || {};
  d.brand = { name: str(b.name, 60) || d.brand.name, tagline: str(b.tagline, 120) };

  const s = src.store || {};
  d.store = {
    mode: ['open', 'auto', 'closed'].includes(s.mode) ? s.mode : 'open',
    openTime: time(s.openTime, d.store.openTime),
    closeTime: time(s.closeTime, d.store.closeTime),
    closedMessage: str(s.closedMessage, 200) || d.store.closedMessage,
    address: str(s.address, 250),
    mapsUrl: link(s.mapsUrl),
    deliveryNote: str(s.deliveryNote, 120),
    prepMinutes: Math.max(0, Math.min(180, Number(s.prepMinutes) || 0)),
  };

  const a = src.announcement || {};
  d.announcement = {
    active: !!a.active, text: str(a.text, 200),
    tone: ['gold', 'navy', 'red', 'green'].includes(a.tone) ? a.tone : 'gold',
    audience: audience(a.audience),
  };

  d.slides = (Array.isArray(src.slides) ? src.slides : []).slice(0, 12).map((x) => ({
    id: id(x.id), active: x.active !== false, audience: audience(x.audience),
    theme: ['navy', 'gold', 'cream', 'dark'].includes(x.theme) ? x.theme : 'navy',
    eyebrow: str(x.eyebrow, 60), title: str(x.title, 90), subtitle: str(x.subtitle, 160),
    ctaText: str(x.ctaText, 30), link: link(x.link), image: imageUrl(x.image),
  }));

  d.offers = (Array.isArray(src.offers) ? src.offers : []).slice(0, 40).map((x) => ({
    id: id(x.id), active: x.active !== false, audience: audience(x.audience),
    group: str(x.group, 30) || 'Fırsatlar', badge: str(x.badge, 20),
    title: str(x.title, 100), description: str(x.description, 240),
    image: imageUrl(x.image), link: link(x.link),
    expiresAt: x.expiresAt && !isNaN(new Date(x.expiresAt)) ? new Date(x.expiresAt).toISOString() : null,
  }));

  d.categories = {};
  const cats = src.categories && typeof src.categories === 'object' ? src.categories : {};
  Object.keys(cats).slice(0, 100).forEach((name) => {
    const c = cats[name] || {};
    d.categories[str(name, 80)] = { image: imageUrl(c.image), badge: str(c.badge, 16), hidden: !!c.hidden };
  });

  d.rails = (Array.isArray(src.rails) ? src.rails : []).slice(0, 10).map((x) => ({
    id: id(x.id), active: x.active !== false, audience: audience(x.audience),
    title: str(x.title, 60), subtitle: str(x.subtitle, 120),
    productIds: (Array.isArray(x.productIds) ? x.productIds : []).slice(0, 30).map((p) => str(p, 120)),
  }));

  const c = src.club || {};
  d.club = { title: str(c.title, 40) || d.club.title, headline: str(c.headline, 80), text: str(c.text, 300) };
  const ab = src.about || {};
  d.about = { title: str(ab.title, 80), text: str(ab.text, 1000), image: imageUrl(ab.image) };

  const ct = src.contact || {};
  d.contact = {
    phone: str(ct.phone, 30), whatsapp: str(ct.whatsapp, 20).replace(/\D/g, ''), email: str(ct.email, 80),
    instagram: link(ct.instagram), facebook: link(ct.facebook), tiktok: link(ct.tiktok),
    youtube: link(ct.youtube), x: link(ct.x),
  };

  const lay = src.layout || {};
  d.layout = {};
  Object.keys(LAYOUT_KEYS).forEach((pageKey) => {
    const known = LAYOUT_KEYS[pageKey];
    const seen = new Set();
    const list = (Array.isArray(lay[pageKey]) ? lay[pageKey] : [])
      .filter((x) => x && known.includes(x.key) && !seen.has(x.key) && seen.add(x.key))
      .map((x) => ({ key: x.key, on: x.on !== false }));
    known.forEach((key) => { if (!seen.has(key)) list.push({ key, on: true }); });
    d.layout[pageKey] = list;
  });

  d.quick = (Array.isArray(src.quick) ? src.quick : []).slice(0, 8).map((x) => ({
    id: id(x.id), active: x.active !== false, icon: str(x.icon, 8), label: str(x.label, 24), link: link(x.link),
  }));
  d.moreLinks = (Array.isArray(src.moreLinks) ? src.moreLinks : []).slice(0, 12).map((x) => ({
    id: id(x.id), active: x.active !== false, icon: str(x.icon, 8), title: str(x.title, 50), link: link(x.link),
  }));
  const slugs = new Set();
  d.pages = (Array.isArray(src.pages) ? src.pages : []).slice(0, 20).map((x) => {
    let slug = str(x.slug || x.title, 60).toLocaleLowerCase('tr')
      .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sayfa';
    let n = 2; const base = slug;
    while (slugs.has(slug)) slug = `${base}-${n++}`;
    slugs.add(slug);
    return {
      id: id(x.id), active: x.active !== false, inMore: x.inMore !== false, icon: str(x.icon, 8),
      slug, title: str(x.title, 80), subtitle: str(x.subtitle, 160), image: imageUrl(x.image), body: str(x.body, 8000),
    };
  });

  d.faq = (Array.isArray(src.faq) ? src.faq : []).slice(0, 30)
    .map((x) => ({ q: str(x.q, 160), a: str(x.a, 800) }))
    .filter((x) => x.q);
  return d;
}

async function load() {
  const stored = await kv.getJSON(KEY, null);
  if (!stored) return clone(DEFAULTS);
  return sanitize({ ...clone(DEFAULTS), ...stored });
}

async function save(input) {
  const clean = sanitize(input);
  await kv.setJSON(KEY, clean);
  return clean;
}

// İstanbul saatine göre "HH:MM"
function istanbulNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const h = parts.find((p) => p.type === 'hour').value;
  const m = parts.find((p) => p.type === 'minute').value;
  return `${h === '24' ? '00' : h}:${m}`;
}

// Sipariş alınabilir mi? { open, message, mode }
function orderingStatus(config, date = new Date()) {
  const s = config.store;
  if (s.mode === 'closed') return { open: false, mode: s.mode, message: s.closedMessage };
  if (s.mode === 'auto') {
    const now = istanbulNow(date);
    const inHours = s.openTime <= s.closeTime
      ? now >= s.openTime && now < s.closeTime
      : now >= s.openTime || now < s.closeTime; // gece yarısını geçen çalışma saati
    if (!inHours) {
      return { open: false, mode: s.mode, message: `Şu an kapalıyız. Sipariş saatlerimiz ${s.openTime} - ${s.closeTime}.` };
    }
  }
  return { open: true, mode: s.mode, message: '' };
}

// Müşteri/personel için görünür olmayan öğeleri çıkarır (herkese açık uç nokta için)
function forAudience(config, isStaff) {
  const who = isStaff ? 'staff' : 'customer';
  const visible = (x) => x.active !== false && (x.audience === 'both' || x.audience === who);
  const out = clone(config);
  out.slides = out.slides.filter(visible);
  out.offers = out.offers.filter((o) => visible(o) && (!o.expiresAt || new Date(o.expiresAt) > new Date()));
  out.rails = out.rails.filter(visible);
  out.quick = out.quick.filter((x) => x.active !== false);
  out.moreLinks = out.moreLinks.filter((x) => x.active !== false);
  out.pages = out.pages.filter((x) => x.active !== false);
  if (!visible(out.announcement) || !out.announcement.text) out.announcement = { active: false, text: '' };
  return out;
}

// Express ara katmanı: mağaza siparişe kapalıyken yeni sipariş/ödeme başlatılmasını engeller
async function requireOrderingOpen(req, res, next) {
  try {
    const status = orderingStatus(await load());
    if (!status.open) return res.status(409).json({ error: status.message, closed: true });
  } catch (e) {
    // Ayar okunamazsa sipariş almayı engellemeyelim — eski davranış korunur
  }
  next();
}

module.exports = { load, save, sanitize, orderingStatus, forAudience, requireOrderingOpen, DEFAULTS };
