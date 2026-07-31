const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function loadProducts() {
  const raw = fs.readFileSync(path.join(__dirname, 'data', 'products.json'), 'utf-8');
  return JSON.parse(raw);
}

// Tüm ürünleri getir (opsiyonel ?category= filtresi ile)
app.get('/api/products', (req, res) => {
  const products = loadProducts();
  const { category } = req.query;
  if (category) {
    const filtered = products.filter(
      (p) => (p.subcategory || p.category).toLowerCase() === category.toLowerCase()
    );
    return res.json(filtered);
  }
  res.json(products);
});

// Kategori listesini getir
app.get('/api/categories', (req, res) => {
  const products = loadProducts();
  const cats = [...new Set(products.map((p) => p.subcategory || p.category))];
  res.json(cats);
});

// Tek ürün getir
app.get('/api/products/:id', (req, res) => {
  const products = loadProducts();
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });
  res.json(product);
});

app.listen(PORT, () => {
  console.log(`Brokers Coffee sunucusu ${PORT} portunda çalışıyor`);
});
