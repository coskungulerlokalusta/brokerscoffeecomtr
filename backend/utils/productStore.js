const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRODUCTS_FILE = path.join(__dirname, '..', '..', 'data', 'products.json');

function slugify(name) {
  const trmap = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
  let s = name.toLowerCase();
  Object.keys(trmap).forEach((k) => { s = s.split(k).join(trmap[k]); });
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || crypto.randomUUID().slice(0, 8);
}

function loadProducts() {
  if (!fs.existsSync(PRODUCTS_FILE)) return [];
  return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
}

function saveProducts(products) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf-8');
}

function createProduct({ name, category, subcategory, sizes, description, image }) {
  const products = loadProducts();
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
  saveProducts(products);
  return product;
}

function updateProduct(id, updates) {
  const products = loadProducts();
  const product = products.find((p) => p.id === id);
  if (!product) return null;
  Object.assign(product, updates);
  if (updates.sizes && updates.sizes.length) {
    product.basePrice = updates.sizes[0].price;
  }
  saveProducts(products);
  return product;
}

function deleteProduct(id) {
  const products = loadProducts();
  const idx = products.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  products.splice(idx, 1);
  saveProducts(products);
  return true;
}

module.exports = { loadProducts, saveProducts, createProduct, updateProduct, deleteProduct };
