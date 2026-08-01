const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const productStore = require('./backend/utils/productStore');
const adminAuth = require('./backend/utils/adminAuth');
const kv = require('./backend/utils/kvStore');

const adminRoutes = require('./backend/routes/admin');
const orderRoutes = require('./backend/routes/orders');
const paymentRoutes = require('./backend/routes/payment');
const customerRoutes = require('./backend/routes/customer');
const adminProductRoutes = require('./backend/routes/adminProducts');
const rewardsRoutes = require('./backend/routes/rewards');
const siteContentRoutes = require('./backend/routes/siteContent');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1); // Hostinger reverse proxy arkasında doğru IP/protokol algılama için

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Paynet'in 3D geri dönüşü form-post olarak gelir
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/admin', adminRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/account', customerRoutes);
app.use('/api/admin/products', adminProductRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/site-content', siteContentRoutes);

// Tüm ürünleri getir (opsiyonel ?category= filtresi ile)
app.get('/api/products', async (req, res) => {
  const products = await productStore.loadProducts();
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
app.get('/api/categories', async (req, res) => {
  const products = await productStore.loadProducts();
  const cats = [...new Set(products.map((p) => p.subcategory || p.category))];
  res.json(cats);
});

// Tek ürün getir
app.get('/api/products/:id', async (req, res) => {
  const products = await productStore.loadProducts();
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });
  res.json(product);
});

// İlk çalıştırmada: MySQL boşsa, repo içindeki başlangıç verilerini (gerçek menü,
// admin kullanıcısı) bir kereliğine aktarır. Sonraki her deploy'da MySQL'deki
// gerçek veri korunur, bu tohumlama tekrar çalışmaz.
async function seedIfEmpty() {
  try {
    const existingProducts = await kv.getJSON('products', null);
    if (!existingProducts) {
      const seedPath = path.join(__dirname, 'data', 'products.json');
      if (fs.existsSync(seedPath)) {
        const seed = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
        await kv.setJSON('products', seed);
        console.log(`Başlangıç menüsü aktarıldı: ${seed.length} ürün`);
      }
    }

    const existingAdmins = await kv.getJSON('admin_users', null);
    if (!existingAdmins) {
      const seedPath = path.join(__dirname, 'data', 'admin-users.json');
      if (fs.existsSync(seedPath)) {
        const seed = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
        if (seed.length) {
          await kv.setJSON('admin_users', seed);
          console.log('Başlangıç admin kullanıcısı aktarıldı');
        }
      }
    }
  } catch (err) {
    console.error('Tohumlama sırasında hata (MySQL bağlantısını kontrol edin):', err.message);
  }
}

seedIfEmpty().then(() => {
  app.listen(PORT, () => {
    console.log(`Brokers Coffee sunucusu ${PORT} portunda çalışıyor`);
  });
});
