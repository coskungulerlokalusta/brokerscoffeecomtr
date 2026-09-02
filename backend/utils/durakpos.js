// DurakPOS Web Sitesi Sipariş API'si entegrasyonu.
// Menü artık burada değil DurakPOS'ta yönetiliyor — bu dosya menüyü DurakPOS'tan çekip
// bizim sitenin beklediği formata çeviriyor, siparişleri de DurakPOS'a gönderiyor.
const https = require('https');
const settings = require('./settings');

const BASE_URL = 'https://durakpos.com/api/public/store-api';

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', timeout: 15000 }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, json: JSON.parse(raw) });
        } catch (e) {
          reject(new Error(`DurakPOS yanıtı çözümlenemedi: ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('DurakPOS bağlantısı zaman aşımına uğradı')));
    req.on('error', reject);
    req.end();
  });
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: 15000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch (e) {}
          resolve({ statusCode: res.statusCode, raw, json: parsed });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('DurakPOS bağlantısı zaman aşımına uğradı')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// DurakPOS menüsünü çekip bizim sitenin kullandığı ürün formatına çevirir.
// DurakPOS: category.group_name + category.name  ->  bizde: category + subcategory
async function fetchMenu() {
  const s = await settings.loadSettings();
  if (!s.durakposApiKey) throw new Error('DurakPOS API anahtarı ayarlanmamış');

  const { statusCode, json } = await getJson(`${BASE_URL}/${s.durakposApiKey}/menu`);
  if (statusCode !== 200 || !json || !json.products) {
    throw new Error('DurakPOS menüsü alınamadı');
  }

  const categoryById = {};
  (json.categories || []).forEach((c) => { categoryById[c.id] = c; });

  const products = json.products.map((p) => {
    const cat = categoryById[p.category_id] || {};
    return {
      id: 'dp-' + p.id, // bizim id alanlarımızla çakışmasın diye önek
      name: p.name,
      category: cat.group_name || 'Diğer',
      subcategory: cat.name || cat.group_name || 'Diğer',
      image: p.image_url || null,
      basePrice: p.sizes && p.sizes.length ? Number(p.sizes[0].price) : 0,
      sizes: (p.sizes || []).map((s) => ({
        label: s.label || null,
        price: Number(s.price),
        staffPrice: null, // DurakPOS'ta personel özel fiyatı kavramı yok
      })),
    };
  });

  return { tenantName: json.tenant ? json.tenant.name : null, products };
}

// Siparişi DurakPOS'a gönderir. items: [{name, size, price, qty}]
async function submitOrder({ items, customerName, customerPhone, note }) {
  const s = await settings.loadSettings();
  if (!s.durakposApiKey) throw new Error('DurakPOS API anahtarı ayarlanmamış');

  const { statusCode, raw, json } = await postJson(`${BASE_URL}/${s.durakposApiKey}/order`, {
    items: items.map((i) => ({ name: i.name, size: i.size || undefined, price: i.price, qty: i.qty })),
    customerName,
    customerPhone,
    note: note || '',
  });

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`DurakPOS siparişi reddetti (HTTP ${statusCode}): ${raw.slice(0, 300)}`);
  }
  return json || { raw };
}

module.exports = { fetchMenu, submitOrder };
