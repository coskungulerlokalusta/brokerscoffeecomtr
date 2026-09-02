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

async function loadProducts() {
  return kv.getJSON(KEY, []);
}

async function saveProducts(products) {
  return kv.setJSON(KEY, products);
}

async function createProduct({ name, category, subcategory, sizes, description, image }) {
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

module.exports = { loadProducts, saveProducts, createProduct, updateProduct, deleteProduct, reorderCategory };
