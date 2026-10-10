const crypto = require('crypto');
const kv = require('./kvStore');

const KEY = 'products';

function slugify(name) {
  const trmap = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
  let s = name.toLowerCase();
  Object.keys(trmap).forEach((k) => { s = s.split(k).join(trmap[k]); });
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || crypto.randomUUID().slice(0, 8);
}

// Boy adı girilmemiş çok boylu ürünlere (ekranda hepsi "Tek Boy" görünüyordu) türüne göre ad verir:
// Türk kahvesi: Tek / Double, espresso: Single / Double, diğerleri: Küçük / Orta / Büyük.
// Yönetimden girilmiş adlara dokunulmaz.
const lower = (s) => String(s || '').toLocaleLowerCase('tr');
function defaultSizeLabels(product, n) {
  const name = lower(product.name);
  if (n === 2 && name.includes('türk kahve')) return ['Tek', 'Double'];
  if (n === 2 && /espresso|ristretto|doppio/.test(name)) return ['Single', 'Double'];
  if (n === 3) return ['Küçük', 'Orta', 'Büyük'];
  if (n === 2) return ['Küçük', 'Büyük'];
  return null;
}
function normalizeSizes(product) {
  const sizes = Array.isArray(product.sizes) ? product.sizes : [];
  if (sizes.length < 2) return product;
  const labels = sizes.map((s) => String((s && s.label) || '').trim());
  // ad boşsa ya da tüm boylar aynı adı taşıyorsa (ör. hepsi "Tek Boy") ayırt edilemez
  const unusable = labels.some((l) => !l) || new Set(labels.map(lower)).size < labels.length;
  if (!unusable) return product;
  const defaults = defaultSizeLabels(product, sizes.length);
  if (!defaults) return product;
  return { ...product, sizes: sizes.map((s, i) => ({ ...s, label: labels[i] && new Set(labels.map(lower)).size === labels.length ? labels[i] : defaults[i] })) };
}

async function loadProducts() {
  const list = await kv.getJSON(KEY, []);
  return Array.isArray(list) ? list.map(normalizeSizes) : list;
}

async function saveProducts(products) {
  return kv.setJSON(KEY, products);
}

async function createProduct({ name, category, subcategory, sizes, description, image, hiddenFor }) {
  const products = await loadProducts();
  let id = slugify(name);
  let suffix = 1;
  while (products.find((p) => p.id === id)) {
    id = `${slugify(name)}-${suffix++}`;
  }
  const product = {
    id,
    name,
    category,
    subcategory: subcategory || null,
    sizes: sizes && sizes.length ? sizes : [{ label: null, price: 0 }],
    basePrice: sizes && sizes.length ? sizes[0].price : 0,
    description: description || '',
    image: image || null,
    hiddenFor: hiddenFor || { customer: false, staff: false }, // bu ürün müşteriden/personelden gizlensin mi
  };
  products.push(product);
  await saveProducts(products);
  return product;
}

async function updateProduct(id, updates) {
  const products = await loadProducts();
  const product = products.find((p) => p.id === id);
  if (!product) return null;
  Object.assign(product, updates);
  if (updates.sizes && updates.sizes.length) {
    product.basePrice = updates.sizes[0].price;
  }
  await saveProducts(products);
  return product;
}

async function deleteProduct(id) {
  const products = await loadProducts();
  const idx = products.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  products.splice(idx, 1);
  await saveProducts(products);
  return true;
}

// Bir kategori içindeki ürünleri, admin panelde sürükle-bırakla belirlenen yeni sıraya göre dizer.
// Diğer kategorilerin sırası/konumu değişmez.
async function reorderCategory(orderedIds) {
  const products = await loadProducts();
  const idSet = new Set(orderedIds);
  const reordered = orderedIds.map((id) => products.find((p) => p.id === id)).filter(Boolean);
  let i = 0;
  const result = products.map((p) => (idSet.has(p.id) ? reordered[i++] : p));
  await saveProducts(result);
  return result;
}

module.exports = { normalizeSizes, loadProducts, saveProducts, createProduct, updateProduct, deleteProduct, reorderCategory };
